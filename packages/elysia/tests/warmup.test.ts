import { Elysia } from "elysia";
import { describe, expect, test, vi } from "vite-plus/test";

import { pebble, Pond, PondError, ripple, warmup } from "cyrenex";
import type { Ripple } from "cyrenex";

import { inject, pondi } from "../src/index.ts";

function tracked(log: string[], name: string, deps: readonly Ripple<unknown>[] = []) {
  return ripple(name, deps, () => {
    log.push(`create ${name}`);
    return { [Symbol.asyncDispose]: async () => void log.push(`dispose ${name}`) };
  });
}

describe("warmup", () => {
  test("creates eager singletons before the first request, once", async () => {
    const log: string[] = [];
    const Db = tracked(log, "db");
    const Cache = tracked(log, "cache", [Db]);
    const app = new Elysia()
      .use(pondi(new Pond(), { eager: [Cache] }))
      .use(inject({ db: Db }))
      .get("/", () => "ok");

    await warmup(app);
    expect(log).toEqual(["create db", "create cache"]);

    // Requests and repeated warm-ups reuse the instances.
    await app.handle(new Request("http://localhost/"));
    await warmup(app);
    expect(log).toEqual(["create db", "create cache"]);
  });

  test("fails with the dependency path and disposes what was already created", async () => {
    const log: string[] = [];
    const Db = tracked(log, "db");
    const Config = pebble<string>("app:config");
    const Mailer = ripple("mailer", [Config], (url) => url);
    const app = new Elysia().use(pondi(new Pond(), { eager: [Db, Mailer] }));

    const error = await warmup(app).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PondError);
    expect(error).toMatchObject({ code: "MISSING_PROVIDER", path: ["mailer", "app:config"] });
    expect(log).toEqual(["create db", "dispose db"]);
  });

  test("propagates factory errors", async () => {
    const Db = ripple("db", async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:5432");
    });
    const app = new Elysia().use(pondi(new Pond(), { eager: [Db] }));
    await expect(warmup(app)).rejects.toThrow("ECONNREFUSED");
  });

  test("only accepts singletons", () => {
    const Session = ripple("session", () => ({}), { mode: "scoped" });
    expect(() => pondi(new Pond(), { eager: [Session] })).toThrow(
      'eager "session" is scoped; only singletons',
    );
  });

  test("is a no-op without pondi or eager tokens", async () => {
    await expect(warmup(new Elysia())).resolves.toBeUndefined();
    await expect(warmup(new Elysia().use(pondi(new Pond())))).resolves.toBeUndefined();
  });

  test("runs on start when the app listens by itself", async () => {
    const log: string[] = [];
    const app = new Elysia()
      .use(pondi(new Pond(), { eager: [tracked(log, "db")] }))
      .get("/", () => "ok");

    // onStart is a fallback for custom listeners: not awaited, failures only logged.
    const start = app.event.start?.map((hook) => hook.fn) ?? [];
    expect(start).toHaveLength(1);
    await start[0]!(app);
    await vi.waitFor(() => expect(log).toEqual(["create db"]));
  });
});
