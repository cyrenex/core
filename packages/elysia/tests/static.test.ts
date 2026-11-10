import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { staticPlugin } from "../src/static.ts";

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "cyrenex-static-"));
  await mkdir(join(dist, "assets"));
  await writeFile(join(dist, "index.html"), "<!doctype html><title>app</title>");
  await writeFile(join(dist, "assets", "app.js"), "console.log(1)");
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

const html = { accept: "text/html,application/xhtml+xml" };

async function get(
  app: { handle(request: Request): Promise<Response> },
  path: string,
  headers = {},
) {
  const response = await app.handle(new Request(`http://localhost${path}`, { headers }));
  return { status: response.status, body: await response.text() };
}

// alwaysStatic: true registers one route per file; false serves through a wildcard route.
describe.each([true, false])("staticPlugin (alwaysStatic: %s)", (alwaysStatic) => {
  async function app(options = {}) {
    return new Elysia()
      .get("/api/hello", () => "hi")
      .use(await staticPlugin({ assets: dist, alwaysStatic, ...options }));
  }

  test("serves the build and keeps API routes", async () => {
    const server = await app();
    expect(await get(server, "/", html)).toMatchObject({
      status: 200,
      body: expect.stringContaining("<title>app"),
    });
    expect(await get(server, "/assets/app.js")).toEqual({ status: 200, body: "console.log(1)" });
    expect(await get(server, "/api/hello")).toEqual({ status: 200, body: "hi" });
  });

  test("falls back to index.html for page navigations only", async () => {
    const server = await app();
    expect(await get(server, "/users/42", html)).toMatchObject({
      status: 200,
      body: expect.stringContaining("<title>app"),
    });
    // Fetch calls and missing assets must not receive HTML with a 200.
    expect((await get(server, "/api/missing")).status).toBe(404);
    expect((await get(server, "/assets/missing.js")).status).toBe(404);
  });

  test("can disable the fallback", async () => {
    const server = await app({ spa: false });
    expect((await get(server, "/users/42", html)).status).toBe(404);
  });

  test("only falls back under the prefix", async () => {
    const server = await app({ prefix: "/app" });
    expect((await get(server, "/app/users/42", html)).status).toBe(200);
    expect((await get(server, "/app", html)).status).toBe(200);
    expect((await get(server, "/other", html)).status).toBe(404);
  });
});
