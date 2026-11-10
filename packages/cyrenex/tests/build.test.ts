// The server build end to end: `vp build` a fixture, then run the output like a deployment, on
// Node.js and Bun.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createBuilder, preview } from "vite";
import type { Logger, PreviewServer, UserConfig } from "vite";
import { afterEach, describe, expect, test } from "vite-plus/test";

import cyrenex from "../src/vite/index.ts";
import type { CyrenexOptions, Runtime } from "../src/vite/index.ts";
import { executableOf, runtimes } from "./runtimes.ts";

// Inside the package, so the output resolves elysia and @elysia/* from its node_modules.
const TMP = join(import.meta.dirname, "../.tmp/build");
const elysia = (file: string) =>
  JSON.stringify(join(import.meta.dirname, "../../elysia/src", file).replaceAll("\\", "/"));
/** For code Node.js runs as is: it only imports absolute paths as file URLs. */
const sourceUrl = (file: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dirname, "../src", file)).href);

const files = {
  "index.html": "<p>web</p>",
  "server/app.ts": `
import { Elysia } from "elysia";
import { node } from ${elysia("node.ts")};

const bun = "Bun" in globalThis;

export default new Elysia({ adapter: bun ? undefined : node() })
  .get("/api/env", () => ({
    greeting: process.env.GREETING,
    mode: process.env.NODE_ENV,
    runtime: bun ? "bun" : "node",
  }))
  .ws("/ws", { message(ws, message) { ws.send(message); } });
`,
  "server/main.ts": `
import { start } from ${elysia("index.ts")};
import app from "./app.ts";

await start(app);
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

/** Collects what the plugin logs. */
function capture(lines: string[]): Logger {
  const ignore = () => {};
  return {
    info: (message) => void lines.push(message),
    warn: ignore,
    warnOnce: ignore,
    error: ignore,
    clearScreen: ignore,
    hasErrorLogged: () => false,
    hasWarned: false,
  };
}

async function build(
  fixture: Record<string, string>,
  options: CyrenexOptions = {},
  config: UserConfig = {},
  dir = "",
) {
  const base = join(TMP, Math.random().toString(36).slice(2));
  for (const [file, content] of Object.entries(fixture)) {
    mkdirSync(join(base, file, ".."), { recursive: true });
    writeFileSync(join(base, file), content);
  }
  const root = join(base, dir);
  const builder = await createBuilder(
    {
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [cyrenex({ runtime: "node", ...options })],
      // Workspace packages imported by fixtures are bundled from their source.
      environments: { server: { resolve: { conditions: ["cyrenex-source"] } } },
      ...config,
    },
    null,
  );
  await builder.buildApp();
  return root;
}

/** Run the built server from `cwd`, as `node dist/server/main.mjs` would in a deployment. */
async function run(runtime: Runtime, cwd: string, main: string) {
  // A clean deployment environment: no NODE_ENV (vitest sets "test"), no GREETING.
  const { NODE_ENV: _, GREETING: __, ...env } = process.env;
  const child = spawn(executableOf(runtime), [main], {
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

describe.each(runtimes)("server build on %s", { timeout: 60_000 }, (runtime) => {
  test("builds client and server, runnable from any working directory", async () => {
    const root = await build({ ...files, ".env.production": "GREETING=from file" }, { runtime });
    expect(existsSync(join(root, "dist/client/index.html"))).toBe(true);
    expect(existsSync(join(root, "dist/server/main.mjs"))).toBe(true);

    const url = await run(runtime, root, "dist/server/main.mjs");
    // .env files of the mode load before the app; NODE_ENV defaults to production.
    expect(await fetch(`${url}/api/env`).then((r) => r.json())).toEqual({
      greeting: "from file",
      mode: "production",
      runtime,
    });
    const page = await fetch(`${url}/some/page`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>web</p>");

    // The client directory is found next to the server output, not from the cwd.
    const elsewhere = await run(runtime, TMP, join(root, "dist/server/main.mjs"));
    expect(await fetch(`${elsewhere}/`).then((r) => r.text())).toBe("<p>web</p>");
  });

  test("vp preview runs the built server", async () => {
    const root = await build(files, { runtime });
    const server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { port: 0, host: "127.0.0.1" },
      plugins: [cyrenex({ runtime })],
    });
    previews.push(server);
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, "");

    // Answered by the built server, on the configured runtime.
    expect(await fetch(`${url}/api/env`).then((r) => r.json())).toMatchObject({ runtime });
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
});

describe.each(runtimes)("server shipped as source on %s", { timeout: 60_000 }, (runtime) => {
  test("vp preview runs the entry, serving the client copied into its package", async () => {
    const root = await build(
      {
        "web/package.json": JSON.stringify({ name: "web" }),
        "web/index.html": "<p>web</p>",
        "api/package.json": JSON.stringify({ name: "api" }),
        // Run by Node.js as is: no workspace packages, which would resolve to their builds.
        "api/app.ts": `
export default {
  fetch: (request) =>
    new URL(request.url).pathname === "/api/env"
      ? Response.json({ runtime: "Bun" in globalThis ? "bun" : "node" })
      : new Response(null, { status: 404 }),
};
`,
        "api/main.ts": `
import { start } from ${sourceUrl("start.ts")};
import app from "./app.ts";

await start(app, { static: new URL("./public", import.meta.url) });
`,
      },
      { runtime, server: "../api/main.ts", build: { server: false, client: "../api/public" } },
      {},
      "web",
    );
    expect(existsSync(join(root, "../api/public/index.html"))).toBe(true);
    expect(existsSync(join(root, "dist"))).toBe(false);

    const server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { port: 0, host: "127.0.0.1" },
      plugins: [cyrenex({ runtime, server: "../api/main.ts", build: { server: false } })],
    });
    previews.push(server);
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
    expect(await fetch(`${url}/api/env`).then((r) => r.json())).toMatchObject({ runtime });
    const page = await fetch(`${url}/deep/link`, { headers: { accept: "text/html" } });
    expect(await page.text()).toBe("<p>web</p>");
  });
});

describe("server build", { timeout: 60_000 }, () => {
  test("copies the client build and says how to start the server's package", async () => {
    const fixture = {
      "web/package.json": JSON.stringify({ name: "web" }),
      "web/index.html": "<p>web</p>",
      "api/package.json": JSON.stringify({ name: "@acme/api" }),
      "api/main.ts": "",
    };
    const options = { server: "../api/main.ts" };
    const client = { outDir: "dist", copyTo: "../api/public" };

    const lines: string[] = [];
    const root = await build(
      fixture,
      { ...options, build: { server: false, client } },
      { customLogger: capture(lines) },
      "web",
    );
    expect(existsSync(join(root, "dist/index.html"))).toBe(true);
    expect(existsSync(join(root, "../api/public/index.html"))).toBe(true);
    expect(lines).toContain("cyrenex: client → ../api/public (copy)");
    // The runtime on the entry, from its package.
    expect(lines.at(-1)).toBe("cyrenex: start it with: cd ../api && node main.ts");

    // Or the command the user starts it with, as given.
    const custom: string[] = [];
    await build(
      fixture,
      { ...options, build: { server: false, client, start: "pnpm --filter @acme/api start" } },
      { customLogger: capture(custom) },
      "web",
    );
    expect(custom.at(-1)).toBe("cyrenex: start it with: pnpm --filter @acme/api start");
  });

  test("says how to start the bundled server", async () => {
    const lines: string[] = [];
    await build(files, {}, { customLogger: capture(lines) });
    expect(lines).toContain("cyrenex: start it with: node dist/server/main.mjs");
  });

  test("refuses to empty a package root", async () => {
    await expect(
      build(
        {
          "web/package.json": "{}",
          "web/index.html": "<p>web</p>",
          "api/package.json": "{}",
        },
        { build: { server: false, client: "../api" } },
        {},
        "web",
      ),
    ).rejects.toThrow("is a package root and would be emptied");
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
