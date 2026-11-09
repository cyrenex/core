// serve() on Bun: warm-up, static files, and a stop that waits for the Pond.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";

import { Pond, pondi, ripple } from "../../src/index.ts";
import { serve } from "../../src/serve.ts";
import type { Serving } from "../../src/serve.ts";

const running: Serving[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const serving of running.splice(0)) await serving.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("serve", () => {
  test("warms up, serves the API and the client build, and disposes on stop", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const assets = mkdtempSync(join(tmpdir(), "cyrenex-bun-serve-"));
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

    const serving = await serve(app, { port: 0, static: { assets }, signals: false });
    running.push(serving);
    expect(log).toEqual(["open"]);

    expect(await fetch(`${serving.url}/api/hello`).then((r) => r.text())).toBe("hi");
    expect(await fetch(`${serving.url}/`).then((r) => r.text())).toBe("<p>spa</p>");
    const page = await fetch(`${serving.url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>spa</p>");

    await serving.stop();
    expect(log).toEqual(["open", "close"]);
  });
});
