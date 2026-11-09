// The dev plugin end to end: a real Vite dev server running a fixture app in a Node.js child.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, test } from "vite-plus/test";

import cyrenex from "../src/vite/index.ts";
import type { CyrenexOptions } from "../src/vite/index.ts";

// Inside the package, so the fixture resolves elysia from its node_modules.
const TMP = join(import.meta.dirname, "../.tmp");

const app = (message: string, extra = "") => `
import { Elysia } from "elysia";
import { node } from "@elysia/node";

export default new Elysia({ adapter: node() })
  .get("/api/hello", () => ({ message: ${JSON.stringify(message)}, pid: process.pid }))
  .ws("/ws", { message(ws, message) { ws.send(message); } })
  ${extra};
`;

interface Fixture {
  root: string;
  url: string;
  server: ViteDevServer;
  write: (file: string, content: string) => void;
}

const servers: ViteDevServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  rmSync(TMP, { recursive: true, force: true });
});

async function start(
  files: Record<string, string>,
  options: CyrenexOptions = {},
  config: { mode?: string; envDir?: string } = {},
): Promise<Fixture> {
  const root = join(TMP, Math.random().toString(36).slice(2));
  const write = (file: string, content: string) => {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  for (const [file, content] of Object.entries({ "index.html": "<p>web</p>", ...files })) {
    write(file, content);
  }
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [cyrenex({ runtime: "node", ...options })],
    ...config,
  });
  servers.push(server);
  await server.listen();
  const { port } = server.httpServer!.address() as AddressInfo;
  return { root, url: `http://127.0.0.1:${port}`, server, write };
}

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await probe().catch(() => undefined as T);
    if (value !== undefined && accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out, last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A browser's HMR connection: collects what Vite sends to the page. */
async function hmr(fixture: Fixture) {
  const token = fixture.server.config.webSocketToken;
  const ws = new WebSocket(`${fixture.url.replace("http", "ws")}/?token=${token}`, "vite-hmr");
  const messages: { type: string; event?: string; data?: unknown; err?: { message: string } }[] =
    [];
  ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return { messages, close: () => ws.close() };
}

const json = (url: string) => fetch(url).then((r) => r.json() as Promise<Record<string, unknown>>);

describe("cyrenex/vite", { timeout: 30_000 }, () => {
  test("forwards matching routes and leaves the rest to Vite", async () => {
    const { url, root } = await start({ "server/app.ts": app("hi") });

    expect(await json(`${url}/api/hello`)).toMatchObject({ message: "hi" });
    expect((await fetch(`${url}/api/missing`)).status).toBe(404);
    expect(await fetch(`${url}/`).then((r) => r.text())).toContain("<p>web</p>");
    // `/apix` does not match the `/api` prefix.
    expect((await fetch(`${url}/apix`)).headers.get("content-type")).toContain("text/html");

    expect(readFileSync(join(root, "cyrenex-env.d.ts"), "utf8")).toContain(
      'typeof import("./server/app.ts").default',
    );
  });

  test("restarts the process on change and recovers from startup errors", async () => {
    const { url, write } = await start({ "server/app.ts": app("one") });
    const first = await json(`${url}/api/hello`);

    write("server/app.ts", app("two"));
    const second = await until(
      () => json(`${url}/api/hello`),
      (body) => body.message === "two",
    );
    expect(second.pid).not.toBe(first.pid);

    write("server/app.ts", `throw new Error("broken");`);
    await until(
      () => fetch(`${url}/api/hello`).then((r) => r.status),
      (status) => status === 503,
    );

    write("server/app.ts", app("three"));
    await until(
      () => json(`${url}/api/hello`),
      (body) => body.message === "three",
    );
  });

  test("loads every .env variable into the app process", async () => {
    const { url } = await start({
      "server/app.ts": app("env", `.get("/api/env", () => [process.env.A, process.env.B])`),
      ".env": "A=base\nB=base",
      ".env.development": "B=mode",
    });
    expect(await json(`${url}/api/env`)).toEqual(["base", "mode"]);
  });

  test("passes env, runtime flags and the inspector to the app process", async () => {
    const { url } = await start(
      {
        "server/app.ts": app(
          "flags",
          `.get("/api/flags", () => ({ argv: process.execArgv, a: process.env.A }))`,
        ),
        ".env": "A=file",
      },
      { env: { A: "option" }, execArgv: ["--no-warnings"], inspect: "127.0.0.1:0" },
    );
    expect(await json(`${url}/api/flags`)).toEqual({
      argv: ["--inspect=127.0.0.1:0", "--no-warnings"],
      a: "option",
    });
  });

  test("waits shutdownTimeout for app.stop() before killing the process", async () => {
    const marker = join(TMP, `stopped-${Math.random().toString(36).slice(2)}`);
    const slowStop = (message: string) =>
      app(
        message,
        `.onStop(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          (await import("node:fs")).writeFileSync(process.env.MARKER, "stopped");
        })`,
      );
    const { url, write } = await start(
      { "server/app.ts": slowStop("one") },
      { shutdownTimeout: 5000, env: { MARKER: marker } },
    );

    write("server/app.ts", slowStop("two"));
    await until(
      () => json(`${url}/api/hello`),
      (body) => body.message === "two",
    );
    expect(readFileSync(marker, "utf8")).toBe("stopped");
  });

  test("tells pages about restarts", async () => {
    const fixture = await start({ "server/app.ts": app("one") });
    const page = await hmr(fixture);
    fixture.write("server/app.ts", app("two"));
    const event = await until(async () => page.messages.find((m) => m.type === "custom"), Boolean);
    expect(event).toEqual({ type: "custom", event: "cyrenex:restart", data: { runtime: "node" } });
    page.close();
  });

  test("shows startup failures in Vite's error overlay", async () => {
    const fixture = await start({ "server/app.ts": app("ok") });
    const page = await hmr(fixture);

    fixture.write("server/app.ts", `throw new Error("broken app");`);
    const error = await until(async () => page.messages.find((m) => m.type === "error"), Boolean);
    expect(error?.err?.message).toBe("Error: broken app");

    // A page opened while the app is broken gets the overlay too.
    const late = await hmr(fixture);
    await until(async () => late.messages.find((m) => m.type === "error"), Boolean);

    fixture.write("server/app.ts", app("fixed"));
    await until(async () => page.messages.find((m) => m.type === "full-reload"), Boolean);
    page.close();
    late.close();
  });

  test("forwards WebSocket upgrades", async () => {
    const { url } = await start({ "server/app.ts": app("ws") });
    const ws = new WebSocket(`${url.replace("http", "ws")}/ws`);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const reply = new Promise((resolve) => (ws.onmessage = (event) => resolve(event.data)));
    ws.send("ping");
    expect(await reply).toBe("ping");
    ws.close();
  });
});
