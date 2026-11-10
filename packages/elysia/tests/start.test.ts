// start() of @cyrenex/elysia on Node.js (Elysia's own adapter), and cyrenex's plain-fetch start().
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pond, ripple } from "cyrenex";
import { start as startFetch } from "cyrenex/start";
import type { Server } from "cyrenex/start";
import { Elysia } from "elysia";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { pondi, start } from "../src/index.ts";
import { node } from "../src/node.ts";

const running: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function client() {
  const dir = mkdtempSync(join(tmpdir(), "cyrenex-listen-"));
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

describe("start", () => {
  test("listens with Elysia's adapter and serves the client build", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log: string[] = [];
    const app = new Elysia({ adapter: node() })
      .use(pondi(new Pond(), { eager: [tracked(log)] }))
      .get("/api/hello", () => "hi");

    const server = await start(app, { port: 0, static: client(), signals: false });
    running.push(server);
    expect(app.server).not.toBeNull();

    expect(await fetch(`${server.url}/api/hello`).then((r) => r.text())).toBe("hi");
    expect(await fetch(`${server.url}/assets/app.js`).then((r) => r.text())).toBe("console.log(1)");
    const page = await fetch(`${server.url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>spa</p>");
    expect((await fetch(`${server.url}/api/missing`)).status).toBe(404);

    await server.stop();
    running.length = 0;
    expect(app.server).toBeNull();
    expect(log).toEqual(["open", "close"]);
  });

  test("an Elysia app also starts through fetch, disposing the Pond on stop", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log: string[] = [];
    const app = new Elysia().use(pondi(new Pond(), { eager: [tracked(log)] })).get("/", () => "ok");

    const server = await startFetch(app, { port: 0, static: false, signals: false });
    expect(await fetch(`${server.url}/`).then((r) => r.text())).toBe("ok");
    await server.stop();
    expect(log).toEqual(["open", "close"]);
  });

  test("fails before listening when an eager singleton fails", async () => {
    const Db = ripple("db", () => {
      throw new Error("refused");
    });
    const app = new Elysia({ adapter: node() }).use(pondi(new Pond(), { eager: [Db] }));
    await expect(start(app, { port: 0, signals: false })).rejects.toThrow("refused");
    expect(app.server).toBeNull();
  });
});
