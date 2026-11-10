// start() of @cyrenex/elysia on Bun (Bun.serve): warm-up, static files, and a stop that
// waits for the Pond.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pond, ripple } from "cyrenex";
import type { Server } from "cyrenex/start";
import { Elysia } from "elysia";

import { pondi, start } from "../../src/index.ts";

const running: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of running.splice(0)) await server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("start", () => {
  test("warms up, serves the API and the client build, and disposes on stop", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const assets = mkdtempSync(join(tmpdir(), "cyrenex-bun-listen-"));
    dirs.push(assets);
    writeFileSync(join(assets, "index.html"), "<p>spa</p>");

    const log: string[] = [];
    const Db = ripple("db", () => {
      log.push("open");
      return {
        async [Symbol.asyncDispose]() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          log.push("close");
        },
      };
    });
    const app = new Elysia().use(pondi(new Pond(), { eager: [Db] })).get("/api/hello", () => "hi");

    const server = await start(app, { port: 0, static: assets, signals: false });
    running.push(server);
    expect(log).toEqual(["open"]);

    expect(await fetch(`${server.url}/api/hello`).then((r) => r.text())).toBe("hi");
    expect(await fetch(`${server.url}/`).then((r) => r.text())).toBe("<p>spa</p>");
    const page = await fetch(`${server.url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>spa</p>");

    await server.stop();
    expect(log).toEqual(["open", "close"]);
  });
});
