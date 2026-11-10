import { treaty } from "@elysia/eden";
import { Elysia, t } from "elysia";
import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";

import { pebble, Pond, ripple } from "cyrenex";

import { inject, pondi, RequestContext } from "../src/index.ts";

interface User {
  id: string;
  name: string;
}

function setup() {
  const log: string[] = [];

  const Db = ripple("db", () => {
    log.push("db:open");
    const users = new Map<string, User>([["1", { id: "1", name: "Ada" }]]);
    return {
      users,
      async [Symbol.asyncDispose]() {
        log.push("db:close");
      },
    };
  });

  const UserService = ripple("user:service", [Db], (db) => ({
    find: (id: string) => db.users.get(id),
    list: () => [...db.users.values()],
  }));

  let seq = 0;
  const RequestId = ripple(
    "request:id",
    [RequestContext],
    (ctx) => {
      const id = `${ctx.request.headers.get("x-request-id") ?? "anon"}#${++seq}`;
      return {
        id,
        [Symbol.dispose]() {
          log.push(`request:dispose ${id}`);
        },
      };
    },
    { mode: "scoped" },
  );

  const routes = new Elysia({ prefix: "/api" })
    .use(inject({ users: UserService, rid: RequestId }))
    .get("/users", ({ users }) => users.list())
    .get("/users/:id", ({ users, params, status }) => users.find(params.id) ?? status(404), {
      params: t.Object({ id: t.String() }),
    })
    .get("/rid", ({ rid }) => ({ rid: rid.id }));

  const pond = new Pond();
  const app = new Elysia()
    .use(pondi(pond))
    .use(routes)
    .get("/plain", () => "no injection");

  return { app, pond, log, Db };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("inject", () => {
  test("resolves typed services through Eden", async () => {
    const { app } = setup();
    const api = treaty(app);

    const { data } = await api.api.users.get();
    expect(data).toEqual([{ id: "1", name: "Ada" }]);
    expectTypeOf(data).toEqualTypeOf<User[] | null>();

    const one = await api.api.users({ id: "1" }).get();
    expect(one.data).toEqual({ id: "1", name: "Ada" });
    const missing = await api.api.users({ id: "2" }).get();
    expect(missing.status).toBe(404);
  });

  test("keeps the pond decorator typed", () => {
    const { app } = setup();
    app.get("/typed", ({ pond }) => {
      expectTypeOf(pond).toEqualTypeOf<Pond>();
      return null;
    });
  });

  test("shares singletons across requests and creates scoped values per request", async () => {
    const { app, log } = setup();
    const api = treaty(app);

    const a = await api.api.rid.get({ headers: { "x-request-id": "a" } });
    const b = await api.api.rid.get({ headers: { "x-request-id": "b" } });
    expect(a.data?.rid).toBe("a#1");
    expect(b.data?.rid).toBe("b#2");

    await settle();
    expect(log.filter((l) => l === "db:open")).toHaveLength(1);
    expect(log).toContain("request:dispose a#1");
    expect(log).toContain("request:dispose b#2");
    expect(log).not.toContain("db:close");
  });

  test("does not fork for routes without injection", async () => {
    const { app, pond } = setup();
    const fork = vi.spyOn(pond, "fork");
    await app.handle(new Request("http://localhost/plain"));
    expect(fork).not.toHaveBeenCalled();
    await app.handle(new Request("http://localhost/api/users"));
    expect(fork).toHaveBeenCalledOnce();
  });

  test("disposes the request scope when the handler fails", async () => {
    const { log } = setup();
    const Scoped = ripple(
      "scoped",
      () => ({
        [Symbol.dispose]() {
          log.push("scoped:dispose");
        },
      }),
      { mode: "scoped" },
    );
    const app = new Elysia()
      .use(pondi(new Pond()))
      .use(inject({ s: Scoped }))
      .get("/boom", () => {
        throw new Error("boom");
      });

    const response = await app.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    await settle();
    expect(log).toContain("scoped:dispose");
  });

  test("swaps implementations with a forked pond", async () => {
    const { pond, Db } = setup();
    const Names = ripple("names", [Db], (db) => [...db.users.values()].map((u) => u.name));
    const fake = ripple(Db, () => ({
      users: new Map([["9", { id: "9", name: "Mock" }]]),
      async [Symbol.asyncDispose]() {},
    }));
    const app = new Elysia()
      .use(pondi(pond.fork().use(fake)))
      .use(inject({ names: Names }))
      .get("/names", ({ names }) => names);

    expect(
      await treaty(app)
        .names.get()
        .then((r) => r.data),
    ).toEqual(["Mock"]);
  });

  test("explains a missing pond", async () => {
    const app = new Elysia().use(inject({ x: pebble<number>("x") })).get("/", ({ x }) => x);
    const response = await app.handle(new Request("http://localhost/"));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("app.use(pondi(pond))");
  });
});

describe("PondError responses", () => {
  const Config = pebble<{ url: string }>("app:config");
  const Db = ripple("db", [Config], (config) => config.url);
  const Leaky = ripple("leaky", [RequestContext], (ctx) => ctx.path);

  function app(exposeErrors?: boolean) {
    return new Elysia()
      .use(pondi(new Pond(), { exposeErrors }))
      .use(inject({ db: Db }))
      .get("/db", ({ db }) => db);
  }

  test("describe the failing dependency path in development", async () => {
    const response = await app(true).handle(new Request("http://localhost/db"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "PondError",
      code: "MISSING_PROVIDER",
      message: 'No provider for "app:config" (db -> app:config)',
      path: ["db", "app:config"],
    });
  });

  test("hide details in production but log them", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app(false).handle(new Request("http://localhost/db"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal Server Error" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  test("reject singletons capturing the request context", async () => {
    const leaky = new Elysia()
      .use(pondi(new Pond(), { exposeErrors: true }))
      .use(inject({ leaky: Leaky }))
      .get("/leaky", ({ leaky }) => leaky);

    const response = await leaky.handle(new Request("http://localhost/leaky"));
    expect(await response.json()).toMatchObject({ code: "CAPTIVE_DEPENDENCY" });
  });

  test("leave other errors to Elysia", async () => {
    const plain = new Elysia().use(pondi(new Pond())).get("/", () => {
      throw new Error("plain");
    });
    const response = await plain.handle(new Request("http://localhost/"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("plain");
  });
});
