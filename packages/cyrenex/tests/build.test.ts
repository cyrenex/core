// The server build end to end: `vp build` a fixture, then run the output like a deployment.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createBuilder, preview } from "vite";
import type { PreviewServer } from "vite";
import type { UserConfig } from "vite";
import { afterEach, describe, expect, test } from "vite-plus/test";

import cyrenex from "../src/vite/index.ts";
import type { CyrenexOptions } from "../src/vite/index.ts";

// Inside the package, so the output resolves elysia and @elysia/* from its node_modules.
const TMP = join(import.meta.dirname, "../.tmp/build");
const source = (file: string) =>
  JSON.stringify(join(import.meta.dirname, "../src", file).replaceAll("\\", "/"));

const files = {
  "index.html": "<p>web</p>",
  "server/app.ts": `
import { Elysia } from "elysia";
import { node } from ${source("node.ts")};

export default new Elysia({ adapter: node() })
  .get("/api/env", () => ({ greeting: process.env.GREETING, mode: process.env.NODE_ENV }))
  .ws("/ws", { message(ws, message) { ws.send(message); } });
`,
  "server/main.ts": `
import { serve } from ${source("serve.ts")};
import app from "./app.ts";

await serve(app);
`,
};

const children: ChildProcess[] = [];
const previews: PreviewServer[] = [];

afterEach(async () => {
  for (const server of previews.splice(0)) await server.close();
  // The children run inside TMP; wait for them to exit before removing it.
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  rmSync(TMP, { recursive: true, force: true });
});

async function build(
  fixture: Record<string, string>,
  options: CyrenexOptions = {},
  config: UserConfig = {},
) {
  const root = join(TMP, Math.random().toString(36).slice(2));
  for (const [file, content] of Object.entries(fixture)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const builder = await createBuilder(
    {
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [cyrenex({ runtime: "node", ...options })],
      ...config,
    },
    null,
  );
  await builder.buildApp();
  return root;
}

/** Run the built server from `cwd`, as `node dist/server/main.mjs` would in a deployment. */
async function run(cwd: string, main: string) {
  // A clean deployment environment: no NODE_ENV (vitest sets "test"), no GREETING.
  const { NODE_ENV: _, GREETING: __, ...env } = process.env;
  const child = spawn(process.execPath, [main], {
    cwd,
    // PORT=0: the server picks a free port and logs it; no race with other tests' servers.
    env: { ...env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk));
  const deadline = Date.now() + 15_000;
  let listening: RegExpMatchArray | null;
  while (!(listening = output.match(/listening on http:\/\/localhost:(\d+)/))) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(output || "no output");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return `http://127.0.0.1:${listening[1]}`;
}

describe("server build", { timeout: 60_000 }, () => {
  test("builds client and server, runnable from any working directory", async () => {
    const root = await build({ ...files, ".env.production": "GREETING=from file" });
    expect(existsSync(join(root, "dist/client/index.html"))).toBe(true);
    expect(existsSync(join(root, "dist/server/main.mjs"))).toBe(true);

    const url = await run(root, "dist/server/main.mjs");
    // .env files of the mode load before the app; NODE_ENV defaults to production.
    expect(await fetch(`${url}/api/env`).then((r) => r.json())).toEqual({
      greeting: "from file",
      mode: "production",
    });
    const page = await fetch(`${url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>web</p>");

    // The client directory is found next to the server output, not from the cwd.
    const elsewhere = await run(TMP, join(root, "dist/server/main.mjs"));
    expect(await fetch(`${elsewhere}/`).then((r) => r.text())).toBe("<p>web</p>");
  });

  test("vp preview runs the built server", async () => {
    const root = await build(files);
    const server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { port: 0, host: "127.0.0.1" },
      plugins: [cyrenex({ runtime: "node" })],
    });
    previews.push(server);
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, "");

    // Answered by the built server (the preview inherits NODE_ENV from vitest here).
    expect(await fetch(`${url}/api/env`).then((r) => r.json())).toHaveProperty("mode");
    const page = await fetch(`${url}/deep/link`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>web</p>");

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

  test("builds only the client without a server entry", async () => {
    const { "server/main.ts": _, ...rest } = files;
    const root = await build(rest);
    expect(existsSync(join(root, "dist/index.html"))).toBe(true);
    expect(existsSync(join(root, "dist/server"))).toBe(false);
  });

  test("refuses a server build inside the client build", async () => {
    await expect(build(files, {}, { build: { outDir: "dist" } })).rejects.toThrow(
      "must not be inside the client build",
    );
  });
});
