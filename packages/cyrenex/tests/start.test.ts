import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { attach } from "../src/adapter.ts";
import { Pond, ripple } from "../src/index.ts";
import { clientDir, start } from "../src/start.ts";
import type { Server } from "../src/start.ts";

const running: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function client() {
  const dir = mkdtempSync(join(tmpdir(), "cyrenex-start-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<p>spa</p>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/app.js"), "console.log(1)");
  return dir;
}

function tracked(log: string[]) {
  return ripple("db", () => {
    log.push("open");
    return { [Symbol.dispose]: () => log.push("close") };
  });
}

const html = { headers: { accept: "text/html" } };

describe("start", () => {
  test("serves a fetch app with the client build after it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = {
      fetch: (request: Request) =>
        new URL(request.url).pathname === "/api/hello"
          ? new Response("hi")
          : new Response("not found", { status: 404 }),
    };
    const server = await start(app, { port: 0, static: client(), signals: false });
    running.push(server);

    expect(await fetch(`${server.url}/api/hello`).then((r) => r.text())).toBe("hi");
    expect(await fetch(`${server.url}/assets/app.js`).then((r) => r.text())).toBe("console.log(1)");
    expect(await fetch(`${server.url}/`).then((r) => r.text())).toBe("<p>spa</p>");
    expect(await fetch(`${server.url}/some/page`, html).then((r) => r.text())).toBe("<p>spa</p>");
    // API calls and missing assets keep the app's 404.
    const missing = await fetch(`${server.url}/api/missing`);
    expect([missing.status, await missing.text()]).toEqual([404, "not found"]);
    expect((await fetch(`${server.url}/assets/missing.js`)).status).toBe(404);
  });

  test("serves the client build under a prefix", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = { fetch: () => new Response(null, { status: 404 }) };
    const server = await start(app, {
      port: 0,
      static: { dir: client(), prefix: "/app" },
      signals: false,
    });
    running.push(server);

    expect(await fetch(`${server.url}/app/assets/app.js`).then((r) => r.status)).toBe(200);
    expect(await fetch(`${server.url}/app/page`, html).then((r) => r.text())).toBe("<p>spa</p>");
    expect((await fetch(`${server.url}/assets/app.js`)).status).toBe(404);
  });

  test("warms up before listening, and disposes the Pond on stop", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log: string[] = [];
    const app = { fetch: () => new Response("ok") };
    attach(app, new Pond(), { eager: [tracked(log)] });

    const server = await start(app, { port: 0, static: false, signals: false });
    expect(log).toEqual(["open"]);
    expect(await fetch(`${server.url}/`).then((r) => r.text())).toBe("ok");

    await server.stop();
    expect(log).toEqual(["open", "close"]);
  });

  test("fails before listening when an eager singleton fails", async () => {
    const Db = ripple("db", () => {
      throw new Error("refused");
    });
    const app = { fetch: () => new Response("ok") };
    attach(app, new Pond(), { eager: [Db] });
    const listen = vi.fn();
    await expect(start(app, { port: 0, listen, signals: false })).rejects.toThrow("refused");
    expect(listen).not.toHaveBeenCalled();
  });

  test("needs fetch() or a listen option", async () => {
    await expect(start({}, { port: 0 })).rejects.toThrow("needs an app with fetch()");
  });

  test("finds the client build", () => {
    vi.stubEnv("CYRENEX_CLIENT_DIR", "/srv/client");
    expect(clientDir()).toBe("/srv/client");
    vi.stubEnv("CYRENEX_CLIENT_DIR", "");

    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "cyrenex-cwd-"));
    dirs.push(root);
    try {
      process.chdir(root);
      expect(clientDir()).toBeUndefined();
      mkdirSync("dist/client", { recursive: true });
      writeFileSync("dist/index.html", "");
      expect(clientDir()).toBe("dist");
      writeFileSync("dist/client/index.html", "");
      expect(clientDir()).toBe("dist/client");
    } finally {
      process.chdir(cwd);
    }
  });
});
