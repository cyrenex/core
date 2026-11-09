import { treaty } from "@elysia/eden";
import { Elysia } from "elysia";
import { describe, expect, test } from "vite-plus/test";

import { inject, Pond, pondi, ripple } from "../src/index.ts";
import { override } from "../src/testing.ts";

function setup() {
  const log: string[] = [];
  const Db = ripple("db", () => ({
    name: "real",
    [Symbol.dispose]: () => log.push("real:dispose"),
  }));
  const Names = ripple("names", [Db], (db) => ({ get: () => db.name }));
  // The app as a module would export it: pondi() and routes already applied.
  const app = new Elysia()
    .use(pondi(new Pond()))
    .use(inject({ names: Names }))
    .get("/name", ({ names }) => names.get())
    .get("/same", ({ pond }) => pond.resolve(Db).then((db) => db.name));
  return { app, log, Db };
}

const fake = (name: string, log: string[]) => ({
  name,
  [Symbol.dispose]: () => log.push(`${name}:dispose`),
});

describe("override", () => {
  test("swaps providers until restored, even after the real ones were created", async () => {
    const { app, log, Db } = setup();
    const api = treaty(app);
    expect((await api.name.get()).data).toBe("real");

    {
      await using _ = override(
        app,
        ripple(Db, () => fake("fake", log)),
      );
      expect((await api.name.get()).data).toBe("fake");
      // The `pond` decorator follows the override too.
      expect((await api.same.get()).data).toBe("fake");
    }

    expect(log).toEqual(["fake:dispose"]);
    expect((await api.name.get()).data).toBe("real");
  });

  test("nests and restores in reverse order", async () => {
    const { app, log, Db } = setup();
    const api = treaty(app);

    const outer = override(
      app,
      ripple(Db, () => fake("outer", log)),
    );
    const inner = override(
      app,
      ripple(Db, () => fake("inner", log)),
    );
    expect((await api.name.get()).data).toBe("inner");

    await expect(outer.restore()).rejects.toThrow("reverse order");
    await inner.restore();
    expect((await api.name.get()).data).toBe("outer");
    await outer.restore();
    expect((await api.name.get()).data).toBe("real");
    expect(log).toEqual(["inner:dispose", "outer:dispose"]);
  });

  test("requires pondi", () => {
    expect(() => override(new Elysia())).toThrow("pondi(pond)");
  });
});
