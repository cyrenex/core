// Bun's own adapter (Bun.serve): stop/dispose and WebSocket scopes, as server.test.ts checks
// for Node.js.
import { afterEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { AnyElysia } from "elysia";

import { inject, Pond, pondi, ripple } from "../../src/index.ts";
import { stopApp } from "../../src/stop.ts";

const running: AnyElysia[] = [];

afterEach(async () => {
  for (const app of running.splice(0)) if (app.server) await app.stop(true);
});

function listen(app: AnyElysia): number {
  app.listen({ port: 0, hostname: "127.0.0.1" });
  running.push(app);
  return app.server!.port!;
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("stopApp", () => {
  test("resolves after async onStop hooks, so the process can exit right after", async () => {
    const log: string[] = [];
    const Db = ripple("db", () => ({
      async [Symbol.asyncDispose]() {
        await settle(10);
        log.push("db:close");
      },
    }));
    const app = new Elysia()
      .use(pondi(new Pond()))
      .use(inject({ db: Db }))
      .get("/", () => "ok");

    const port = listen(app);
    expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())).toBe("ok");

    // Bun's own app.stop() calls the hooks without awaiting them.
    await stopApp(app, undefined);
    expect(log).toEqual(["db:close"]);
    expect(app.server).toBeNull();
  });
});

describe("WebSocket scopes", () => {
  function setup() {
    const log: string[] = [];
    let seq = 0;
    const Session = ripple(
      "session",
      () => {
        const id = ++seq;
        log.push(`open ${id}`);
        return { id, [Symbol.dispose]: () => log.push(`dispose ${id}`) };
      },
      { mode: "scoped" },
    );
    const app = new Elysia()
      .use(pondi(new Pond()))
      .use(inject({ session: Session }))
      .ws("/ws", {
        message(ws) {
          ws.send(String(ws.data.session.id));
        },
        close() {
          log.push("close handler");
        },
      });
    return { app, log };
  }

  async function connect(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const ask = async () => {
      const reply = new Promise<string>((resolve) => {
        ws.onmessage = (event) => resolve(String(event.data));
      });
      ws.send("?");
      return reply;
    };
    return { ws, ask };
  }

  test("live as long as the connection, one per connection", async () => {
    const { app, log } = setup();
    const port = listen(app);

    const a = await connect(port);
    const b = await connect(port);
    expect(await a.ask()).toBe("1");
    expect(await b.ask()).toBe("2");
    await settle();
    expect(await a.ask()).toBe("1");
    expect(log).toEqual(["open 1", "open 2"]);

    a.ws.close();
    await settle();
    expect(log).toEqual(["open 1", "open 2", "close handler", "dispose 1"]);

    b.ws.close();
    await settle();
    expect(log).toContain("dispose 2");
  });

  test("are disposed when the upgrade is rejected", async () => {
    const log: string[] = [];
    const Session = ripple(
      "session",
      () => (log.push("create"), { [Symbol.dispose]: () => log.push("dispose") }),
      { mode: "scoped" },
    );
    const app = new Elysia()
      .use(pondi(new Pond()))
      .use(inject({ session: Session }))
      .ws("/ws", {
        beforeHandle: ({ status }) => status(401),
        message() {},
      });
    const port = listen(app);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => {
      ws.onerror = resolve;
      ws.onclose = resolve;
    });
    await settle();
    expect(log).toEqual(["create", "dispose"]);
  });
});
