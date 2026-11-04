// Real listeners on Node.js through `cyrenex/node`: stop/dispose and WebSocket scopes.
import { node as elysiaNode } from "@elysia/node";
import { Elysia } from "elysia";
import type { AnyElysia } from "elysia";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { inject, Pond, pondi, ripple } from "../src/index.ts";
import { node } from "../src/node.ts";
import { stopApp } from "../src/stop.ts";
import type { StoppableServer } from "../src/stop.ts";

interface Listening {
  port: number;
  server: StoppableServer;
}

const running: { app: AnyElysia; server: StoppableServer }[] = [];

afterEach(async () => {
  for (const { app, server } of running.splice(0)) {
    await stopApp(app, server).catch(() => {});
  }
});

async function listen(app: AnyElysia): Promise<Listening> {
  const server = await new Promise<any>((resolve) =>
    app.listen({ port: 0, hostname: "127.0.0.1" }, resolve),
  );
  await server.raw?.ready?.();
  running.push({ app, server });
  return { server, port: server.raw.node.server.address().port };
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cyrenex/node", () => {
  test("app.stop() works and awaits onStop, disposing the pond", async () => {
    const log: string[] = [];
    const Db = ripple("db", () => ({
      async [Symbol.asyncDispose]() {
        await settle(10);
        log.push("db:close");
      },
    }));
    const app = new Elysia({ adapter: node() })
      .use(pondi(new Pond()))
      .use(inject({ db: Db }))
      .get("/", () => "ok");

    const { port } = await listen(app);
    expect(await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())).toBe("ok");
    expect(app.server).not.toBeNull();

    await app.stop();
    running.length = 0;
    expect(app.server).toBeNull();
    expect(log).toEqual(["db:close"]);
  });

  test("stopApp falls back for plain @elysia/node", async () => {
    const log: string[] = [];
    const Db = ripple("db", () => ({
      [Symbol.dispose]: () => log.push("db:close"),
    }));
    const app = new Elysia({ adapter: elysiaNode() })
      .use(pondi(new Pond()))
      .use(inject({ db: Db }))
      .get("/", () => "ok");

    const { port, server } = await listen(app);
    await fetch(`http://127.0.0.1:${port}/`);
    expect(app.server).toBeNull();

    await stopApp(app, server);
    running.length = 0;
    expect(log).toEqual(["db:close"]);
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
    const app = new Elysia({ adapter: node() })
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
    const { port } = await listen(app);

    const a = await connect(port);
    const b = await connect(port);
    expect(await a.ask()).toBe("1");
    expect(await b.ask()).toBe("2");
    // Still the same session on later messages: not disposed after the upgrade response.
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
});
