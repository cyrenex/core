import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { Pond, pondi, ripple } from "../src/index.ts";
import { node } from "../src/node.ts";
import { clientDir, serve } from "../src/serve.ts";
import type { Serving } from "../src/serve.ts";

const running: Serving[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const serving of running.splice(0)) await serving.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function client() {
  const dir = mkdtempSync(join(tmpdir(), "cyrenex-serve-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<p>spa</p>");
  return dir;
}

describe("serve", () => {
  test("warms up, serves the API and the client build, and stops", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log: string[] = [];
    const Db = ripple("db", () => {
      log.push("open");
      return { [Symbol.dispose]: () => log.push("close") };
    });
    const app = new Elysia({ adapter: node() })
      .use(pondi(new Pond(), { eager: [Db] }))
      .get("/api/hello", () => "hi");

    const serving = await serve(app, { port: 0, static: { assets: client() }, signals: false });
    running.push(serving);
    expect(log).toEqual(["open"]);

    expect(await fetch(`${serving.url}/api/hello`).then((r) => r.text())).toBe("hi");
    const page = await fetch(`${serving.url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>spa</p>");

    await serving.stop();
    expect(log).toEqual(["open", "close"]);
  });

  test("fails before listening when an eager singleton fails", async () => {
    const Db = ripple("db", () => {
      throw new Error("refused");
    });
    const app = new Elysia({ adapter: node() }).use(pondi(new Pond(), { eager: [Db] }));
    await expect(serve(app, { port: 0, static: false, signals: false })).rejects.toThrow("refused");
    expect(app.server).toBeNull();
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
