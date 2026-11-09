// cyrenex/testing as an app's own `bun test` suite would use it.
import { describe, expect, test } from "bun:test";

import { treaty } from "@elysia/eden";
import { Elysia } from "elysia";

import { inject, Pond, pondi, RequestContext, ripple } from "../../src/index.ts";
import { override } from "../../src/testing.ts";

// What server/app.ts would export: pondi() and the routes already applied.
const Db = ripple("db", () => ({ users: ["Ada"] }));
const Users = ripple("users", [Db], (db) => ({ list: () => db.users }));
const Caller = ripple(
  "caller",
  [RequestContext],
  (ctx) => ({ name: ctx.request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
const app = new Elysia()
  .use(pondi(new Pond()))
  .use(inject({ users: Users, caller: Caller }))
  .get("/api/users", ({ users }) => users.list())
  .get("/api/me", ({ caller }) => caller.name);

const api = treaty(app);

describe("override in bun test", () => {
  test("swaps providers for the block, through Eden", async () => {
    expect((await api.api.users.get()).data).toEqual(["Ada"]);
    {
      await using _ = override(
        app,
        ripple(Db, () => ({ users: [] })),
      );
      expect((await api.api.users.get()).data).toEqual([]);
    }
    expect((await api.api.users.get()).data).toEqual(["Ada"]);
  });

  test("keeps request scopes working under an override", async () => {
    await using _ = override(
      app,
      ripple(Db, () => ({ users: ["Mock"] })),
    );
    const me = await api.api.me.get({ headers: { "x-user": "grace" } });
    expect(me.data).toBe("grace");
  });
});
