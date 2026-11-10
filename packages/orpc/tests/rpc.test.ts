import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient, os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { pebble, Pond, ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";

import { inject, RequestContext, rpc, start } from "../src/index.ts";
import type { PondiContext, RpcApp } from "../src/index.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A typed client calling `app` in process. */
function clientOf<T extends RpcApp<any>>(app: T, prefix: `/${string}` = "/rpc") {
  const link = new RPCLink({
    origin: "http://localhost",
    url: prefix,
    fetch: (url, init) => app.fetch(new Request(url, init)),
  });
  return createORPCClient<RouterClient<T["router"]>>(link);
}

function setup() {
  const log: string[] = [];
  let seq = 0;
  const Db = ripple("db", () => ({ name: "real" }));
  const Session = ripple(
    "session",
    [RequestContext],
    ({ request }) => {
      const id = ++seq;
      log.push(`open ${id}`);
      return {
        id,
        user: request.headers.get("x-user"),
        [Symbol.dispose]: () => log.push(`close ${id}`),
      };
    },
    { mode: "scoped" },
  );

  const base = os.$context<PondiContext>();
  const router = {
    me: base.use(inject({ session: Session, db: Db })).handler(({ context }) => ({
      id: context.session.id,
      user: context.session.user,
      db: context.db.name,
    })),
    twice: base
      .use(inject({ a: Session }))
      .use(inject({ b: Session }))
      .handler(({ context }) => context.a === context.b),
    ticks: base.use(inject({ session: Session })).handler(async function* ({ context }) {
      for (let i = 0; i < 3; i++) {
        await settle(5);
        yield `${context.session.id}:${i}`;
      }
    }),
    broken: base.use(inject({ missing: pebble<string>("app:missing") })).handler(() => "never"),
  };
  return { log, Db, router, app: rpc(router, new Pond().use(Db)) };
}

describe("rpc", () => {
  test("injects typed services from a fork per request, disposed after the response", async () => {
    const { log, app } = setup();
    const client = clientOf(app);

    const first = await client.me(undefined, { context: {} });
    expect(first).toEqual({ id: 1, user: null, db: "real" });
    const second = await client.me();
    expect(second.id).toBe(2);
    await settle();
    expect(log).toEqual(["open 1", "close 1", "open 2", "close 2"]);

    // Middlewares of one request share its fork.
    expect(await client.twice()).toBe(true);
  });

  test("passes the request to scoped services", async () => {
    const { app } = setup();
    const link = new RPCLink({
      origin: "http://localhost",
      url: "/rpc",
      headers: { "x-user": "ada" },
      fetch: (url, init) => app.fetch(new Request(url, init)),
    });
    const client = createORPCClient<RouterClient<typeof app.router>>(link);
    expect((await client.me()).user).toBe("ada");
  });

  test("keeps the scope of a streamed output until the stream ends", async () => {
    const { log, app } = setup();
    const client = clientOf(app);

    const values: string[] = [];
    for await (const value of await client.ticks()) {
      values.push(value);
      // Still open while the stream runs.
      expect(log).toEqual(["open 1"]);
    }
    expect(values).toEqual(["1:0", "1:1", "1:2"]);
    await settle();
    expect(log).toEqual(["open 1", "close 1"]);
  });

  test("turns a PondError into an error with its code and path", async () => {
    const { app } = setup();
    const error = await clientOf(app)
      .broken()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      data: { code: "MISSING_PROVIDER", path: ["app:missing"] },
    });
  });

  test("hides PondError details when asked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { router } = setup();
    const app = rpc(router, new Pond(), { exposeErrors: false });
    const error = await clientOf(app)
      .broken()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect((error as ORPCError<string, unknown>).data).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  test("answers 404 outside its prefix, and mounts with handle()", async () => {
    const { log, app } = setup();
    expect((await app.fetch(new Request("http://localhost/api/other"))).status).toBe(404);
    expect(await app.handle(new Request("http://localhost/rpc/nope", { method: "POST" }))).toBe(
      undefined,
    );
    expect(log).toEqual([]);
    expect(app.routes).toEqual([{ path: "/rpc" }]);
  });

  test("serves under another prefix", async () => {
    const { router } = setup();
    const app = rpc(router, new Pond(), { prefix: "/api/rpc" });
    expect((await clientOf(app, "/api/rpc").me()).id).toBe(1);
  });

  test("swaps providers with override", async () => {
    const { Db, app } = setup();
    const client = clientOf(app);
    {
      await using _ = override(
        app,
        ripple(Db, () => ({ name: "fake" })),
      );
      expect((await client.me()).db).toBe("fake");
    }
    expect((await client.me()).db).toBe("real");
  });

  test("calls procedures without HTTP, given a fork", async () => {
    const { router, Db } = setup();
    const pond = new Pond().use(Db);
    const fork = pond
      .fork()
      .use(ripple(RequestContext, () => ({ request: new Request("http://x") })));
    const client = createRouterClient(router, { context: { pond: fork } });
    expect((await client.me()).db).toBe("real");
    await fork.dispose();
  });

  test("types injected services, not just the context's index signature", () => {
    const Count = pebble<number>("count");
    os.$context<PondiContext>()
      .use(inject({ count: Count, db: ripple("typed:db", () => ({ name: "x" })) }))
      .handler(({ context }) => {
        expectTypeOf(context.count).toEqualTypeOf<number>();
        expectTypeOf(context.db).toEqualTypeOf<{ name: string }>();
        expectTypeOf(context.pond).toEqualTypeOf<Pond>();
      });
  });

  test("starts, warming up eager singletons and disposing them on stop", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log: string[] = [];
    const Cache = ripple("cache", () => {
      log.push("open");
      return { [Symbol.dispose]: () => log.push("close") };
    });
    const router = { ping: os.$context<PondiContext>().handler(() => "pong") };
    const app = rpc(router, new Pond().use(Cache), { eager: [Cache] });

    const server = await start(app, { port: 0, static: false, signals: false });
    expect(log).toEqual(["open"]);
    const client = createORPCClient<RouterClient<typeof router>>(
      new RPCLink({ origin: server.url, url: "/rpc" }),
    );
    expect(await client.ping()).toBe("pong");
    await server.stop();
    expect(log).toEqual(["open", "close"]);
  });
});
