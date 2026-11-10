<h1 align="center">cyrenex</h1>

<p align="center">Full-stack server apps inside Vite. Dependency injection by <a href="https://github.com/cyrenex/pondi">pondi</a>, one server entry from dev to production.</p>

<p align="center">
  English · <a href="https://github.com/cyrenex/core/blob/master/README.zh-CN.md">简体中文</a> · <a href="https://www.npmjs.com/package/cyrenex">npm</a> · <a href="https://github.com/cyrenex/core/tree/master/playground">Playground</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/dm/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> One `vp dev` serves your frontend and your API from the same origin. The API runs in its own Bun or Node.js process, restarts on change, and disposes every resource on the way out.

Building a full-stack TypeScript app usually means two dev servers, a proxy, a hand-rolled container and a client you keep in sync by hand. cyrenex folds that into a framework-free core, plus an adapter for your server framework:

- **Elysia**: [`@cyrenex/elysia`](https://github.com/cyrenex/core/tree/master/packages/elysia), with Eden types and WebSockets.
- **oRPC**: [`@cyrenex/orpc`](https://github.com/cyrenex/core/tree/master/packages/orpc), injection as oRPC middleware, streaming-safe request scopes.

## What's Special

- **One origin in dev**: Vite serves the frontend and HMR; matching HTTP requests and WebSocket upgrades go to the app.
- **Real runtime, real restarts**: the app runs in a separate Bun or Node.js process, loaded through Vite's ModuleRunner and replaced on file changes.
- **One entry everywhere**: `server/main.ts` starts the app under `vp dev`, `vp preview` and in production; the dev server only proxies to it.
- **Clean restarts**: every restart stops the server and disposes the Pond, closing connections in reverse dependency order.
- **Request scopes**: services resolved for a request come from its own `pond.fork()`, disposed after the response.
- **Fail at startup, not on the first request**: `eager` singletons are created before the app listens, in dev and in production.
- **Typed clients without paths**: a generated `cyrenex-env.d.ts` registers your app type, so the browser imports it from `cyrenex/client`.
- **Same source in production**: the same entry runs on Bun and Node.js, built or from source, and hosts the client build with SPA fallback.
- **Monorepo friendly**: the server entry may live in another package, and the client build can go to (or be copied into) it.

## Installation

```bash
pnpm add cyrenex
pnpm add -D vite-plus
```

Then add the adapter of your framework, e.g. [`@cyrenex/elysia`](https://github.com/cyrenex/core/tree/master/packages/elysia#installation). Requires Node.js 22.18+ and Vite 8 (or Vite+). The default runtime is Bun, which must be on `PATH`.

## Quick Start

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()], // server: "server/main.ts", app: "server/app.ts", runtime: "bun"
});
```

Describe your services with pondi; `cyrenex` re-exports all of it:

```ts
// server/services.ts
import { pebble, ripple } from "cyrenex";

export const Config = pebble<{ greeting: string }>("app:config");

export const Db = ripple("db", async () => {
  const pool = await connect(process.env.DATABASE_URL);
  return { pool, [Symbol.asyncDispose]: () => pool.end() };
});

export const UserService = ripple("user:service", [Db], (db) => ({
  list: () => db.pool.query("select * from users"),
}));
```

Build the app in `server/app.ts` with your framework's adapter (see [Elysia](https://github.com/cyrenex/core/tree/master/packages/elysia#quick-start)), and start it from the server entry. `vp dev` runs this file and forwards `/api` and `/ws` to it; `vp build` bundles it for production:

```ts
// server/main.ts
import { start } from "@cyrenex/elysia"; // or "cyrenex/start" for any app with a `fetch`
import app from "./app.ts";

await start(app);
```

```bash
vp dev
```

## Services

Services are pondi ripples; adapters resolve them for each request. Their mode decides how long they live:

| mode        | Lives in                     | Disposed                                                  |
| ----------- | ---------------------------- | --------------------------------------------------------- |
| `singleton` | the root Pond                | when the server stops (`stop()`, a signal, a dev restart) |
| `scoped`    | the request's `pond.fork()`  | after the response, even on error                         |
| `transient` | nowhere, new on each resolve | with the request scope                                    |

The fork is created lazily: requests that resolve nothing never touch the container. `warmup(app)` creates the `eager` singletons of an app, and `dispose(app)` disposes its Pond; `start` calls both for you.

## Client Types

`cyrenex/vite` writes `cyrenex-env.d.ts` next to your Vite root on every `dev` and `build`, and only touches it when the content changes:

```ts
// Generated by cyrenex/vite. Do not edit.
declare module "cyrenex/client" {
  interface Register {
    app: typeof import("./server/app.ts").default;
  }
}

declare module "vite/types/customEvent.d.ts" {
  interface CustomEventMap {
    /** The app process restarted after a server change. */
    "cyrenex:restart": { runtime: "bun" | "node" };
  }
}

export {};
```

`App` from `cyrenex/client` is then the type of your app, for your framework's typed client (`treaty<App>()` with Eden). It is `unknown` until the declaration exists, so commit it and include it in your `tsconfig.json`: a fresh clone type-checks before the dev server ever runs. Change the location with `dts`, or disable it with `dts: false` and write the declaration yourself.

> [!TIP]
> The browser only imports a type. The server code is erased at build time and never ends up in your bundle, but your frontend `tsconfig.json` still needs the types the server uses (e.g. `@types/node`).

## Testing

Test the app your module exports, without a network. `override` from `cyrenex/testing` swaps providers until it is disposed, the same way in Vitest and `bun test`:

```ts
import { ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import app from "../server/app.ts";
import { Db } from "../server/services.ts";

test("lists users", async () => {
  await using _ = override(
    app,
    ripple(Db, () => fakeDb),
  );
  const response = await app.fetch(new Request("http://localhost/api/users"));
  expect(await response.json()).toEqual([]);
});
```

Requests resolve from a fork of the app's Pond that shadows the given ripples: singletons depending on them (`UserService` on `Db`) are created again in the fork, the real ones are left alone, and the fork is disposed on restore. Overrides nest and are restored in reverse order. They apply to every request of that app, so don't run overriding tests of one app concurrently.

## Vite Plugin

```ts
cyrenex({
  server: "server/main.ts",
  app: "server/app.ts",
  runtime: "bun",
  routes: ["/api", "/ws"],
  watch: ["templates/**"],
  dts: "cyrenex-env.d.ts",
  inspect: false,
  execArgv: [],
  env: {},
  shutdownTimeout: 1000,
  build: { server: { outDir: "dist/server" } },
});
```

| Option            | Default                                | Description                                                                       |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `server`          | `"server/main.ts"`                     | Server entry starting the app, relative to Vite root; may be in another package   |
| `app`             | `"server/app.ts"`                      | Module default-exporting the app, read for the `cyrenex/client` type only         |
| `runtime`         | `process.env.CYRENEX_RUNTIME ?? "bun"` | `"bun"` or `"node"`, both run in a child process                                  |
| `routes`          | `["/api", "/ws"]`                      | Forwarded path prefixes, matched by whole segment, not rewritten; or `"auto"`     |
| `watch`           | `[]`                                   | Extra files, directories or globs that restart the app; `false` disables restarts |
| `dts`             | `"cyrenex-env.d.ts"`                   | Where to write the `cyrenex/client` declaration; `false` disables it              |
| `inspect`         | `false`                                | Enable the inspector: `true` (`127.0.0.1:9229`), a port, or `"host:port"`         |
| `execArgv`        | `[]`                                   | Extra runtime flags for the app process                                           |
| `env`             | `{}`                                   | Variables for the app process, over the shell and `.env` files                    |
| `shutdownTimeout` | `1000`                                 | Milliseconds a restart waits for the app to stop before killing the old process   |
| `build`           | see [Server build](#server-build)      | What `vp build` produces; `false` leaves the build to Vite                        |

The server entry runs through Vite's ModuleRunner. `start(app)` reports its port to the dev server; an entry listening by other means gets a free `PORT` (and `HOST`) and is found by probing it. The entry directory and every module loaded through Vite are always watched. `/api` matches `/api` and `/api/users`, not `/apix`.

With `routes: "auto"`, the forwarded prefixes are the first segments of the routes your app defines (`/api/users/:id` → `/api`), read again on every restart, so adding a `/rpc` route needs no config change. Routes whose first segment is empty, a parameter or a wildcard (`/`, `/:slug`, `*`) would take every page from the frontend; they are skipped with a warning.

### Environment variables

The app process gets every variable from Vite's `.env` files (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` in `envDir`), not only `VITE_*` ones: it is server code, so nothing reaches the browser. Variables already set in the shell win, as in Vite. Editing a `.env` file restarts the dev server; `envDir: false` disables loading. When the server entry belongs to another package, the app runs in that package's directory and reads its `.env` files instead.

### Debugging

`inspect: true` starts the app with `--inspect=127.0.0.1:9229` on either runtime. The port is released before the next process starts, so it stays the same across restarts and a debugger set to reconnect (VS Code's `"restart": true` attach configuration) follows the app. For Bun, open the printed `debug.bun.sh` URL or use the Bun extension.

### Restarts

- File changes are debounced by 100ms and queued; requests arriving mid-restart wait for the new process.
- The old process gets a shutdown message, closes the server started by `start()` and disposes the Pond, and is killed after `shutdownTimeout` (1 second by default).
- If the app is unavailable, HTTP returns `503`; forwarding errors return `502`.
- Business WebSockets are closed on restart. Reconnect on `close` in the client; Vite's HMR socket is untouched.
- After each restart, pages receive a `cyrenex:restart` HMR event, typed by `cyrenex-env.d.ts`:

  ```ts
  import.meta.hot?.on("cyrenex:restart", ({ runtime }) => refetch());
  ```

- After a startup error, fix the file and it starts again. The error also shows in Vite's error overlay, including on pages opened later; once the app starts, the overlay is dismissed and the page reloads.

To pick the runtime from the command line, map a Vite mode to it:

```ts
export default defineConfig(({ mode }) => ({
  plugins: [cyrenex({ runtime: mode === "node" ? "node" : "bun" })],
}));
```

```bash
vp dev              # Bun
vp dev --mode node  # Node.js
```

## Production

`server/main.ts` is also the production entry. Let `vp build` bundle it next to the frontend, or run it from source:

```bash
vp build                     # dist/client + dist/server/main.mjs, and how to start it

node dist/server/main.mjs    # built
bun dist/server/main.mjs
bun server/main.ts           # or straight from source
node server/main.ts
```

`start(app, options?)` does what every server entry needs, in order:

1. Creates the `eager` singletons (`warmup(app)`); a failure rejects before anything listens.
2. Listens on `PORT` (default `3000`) and `HOST`, or the `port` and `hostname` options.
3. Serves the client build after your routes, with SPA fallback. Under `vp dev` it serves none: Vite serves the frontend.
4. On `SIGINT` / `SIGTERM`, closes the server and disposes the Pond, then exits. Pass `signals: false` to handle them yourself.

It resolves to `{ port, url, stop }`. Under `vp dev` and `vp preview` it listens where the dev or preview server forwards to, and leaves restarts to it.

Adapters export a `start` listening with their framework's own server (so WebSockets work). `start` from `cyrenex/start` serves any app's `fetch` with srvx on Node.js and Bun; a `fetch` carries no WebSockets, so for another server pass `listen`, which starts it and returns its port and a `close`:

```ts
import { start } from "cyrenex/start";

// `fetch` already falls back to the client build.
await start(app, {
  listen: ({ port, hostname, fetch }) => {
    const server = Bun.serve({ port, hostname, fetch, websocket });
    return { port: server.port!, close: () => server.stop(true) };
  },
});
```

### Static files

| `static` option | Default                 | Description                                                                        |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `dir`           | see below               | Client build directory, relative to the working directory, or a `URL`              |
| `prefix`        | `"/"`                   | URL prefix of the files; match Vite `base`                                         |
| `spa`           | `true`                  | Serve `index.html` for page navigations matching nothing; API calls keep their 404 |
| others          | srvx `staticMiddleware` | `maxAge`, `immutable`, `encodings`, `compress`, `etag`…                            |

`static` also takes the directory alone, or `false` for an API-only server. By default, a built server finds the client build next to itself, so it runs from any working directory; from source it is `dist/client` or `dist` under the working directory, skipped if neither exists. A server shipped as source should name its directory relative to itself: `static: new URL("./public", import.meta.url)`.

Only `GET` requests that accept `text/html` fall back, so `fetch("/api/missing")` and a missing `/assets/app.js` still get a 404.

### Server build

When `server/main.ts` exists, `vp build` builds both environments: the client to `dist/client`, the server to `dist/server/main.mjs`. The output imports its dependencies from `node_modules`, like the source does, so deploy it with your `package.json` and install production dependencies. Before your entry runs, the built server:

- loads `.env.production.local`, `.env.local`, `.env.production` and `.env` from the working directory, without overriding variables already set,
- defaults `NODE_ENV` to `production`,
- points `start()` at the client build next to it.

From source, Bun reads `.env` files on its own; on Node.js run `node --env-file-if-exists=.env server/main.ts`.

| `build` option | Default                     | Description                                                                |
| -------------- | --------------------------- | -------------------------------------------------------------------------- |
| `server`       | `{ outDir: "dist/server" }` | Bundle the server entry to `outDir/main.mjs`; `false` ships it as source   |
| `client`       | Vite's `build.outDir`       | Client output directory, or `{ outDir, copyTo }` to also copy it elsewhere |
| `start`        | the runtime on the entry    | Your start command (`"pnpm start"`), printed after building                |

With a bundled server, the client moves to `dist/client` unless you set its `outDir`; if the server output would land inside the client output (and be served as static files), the build fails. The build uses the export conditions of the configured `runtime`; Vite settings for the server go under `environments.server`. After building, cyrenex prints where everything went and how to start the server.

### Shipping the server as source

To deploy the server as TypeScript (`bun server/main.ts`) or build it with your own tooling, turn the server build off and send the client where the server serves it from:

```ts
cyrenex({ build: { server: false, client: "server/public" } });
```

```ts
// server/main.ts
await start(app, { static: new URL("./public", import.meta.url) });
```

A server shipped as source runs without Vite: aliases, `import.meta.env` and other Vite-only features that work under `vp dev` are not available to it.

> [!TIP]
> Node.js runs TypeScript by stripping types, so enable `erasableSyntaxOnly` and use explicit `.ts` extensions to run the same source on both runtimes without a build step.

### Monorepos

The server can live in its own package. Point `server` (and `app`, for the client type) at it, and build the client into it, or copy it there. These options take a path relative to Vite root, or a package and a path inside it:

```ts
// apps/web/vite.config.ts
cyrenex({
  server: { package: "@acme/api", path: "src/main.ts" },
  app: { package: "@acme/api", path: "src/app.ts" },
  build: {
    server: false,
    client: { outDir: "dist", copyTo: { package: "@acme/api", path: "public" } },
  },
});
```

A package is looked up in `node_modules` up from Vite root, so a declared dependency (`"@acme/api": "workspace:*"`) is found as installed; otherwise among the packages of the workspace (`pnpm-workspace.yaml`, or `workspaces` in `package.json` for npm, yarn and bun), without installing.

- `vp dev` runs the entry in the server package's directory, with that package's `.env` files.
- `vp build` writes the client, copies it, and prints how to start the server: `cd ../api && bun src/main.ts`, or your own command with `build.start: "pnpm --filter @acme/api start"`. cyrenex only prints it.
- `vp preview` runs the entry from source, in its package.

Directories outside Vite root are emptied before writing, so `client` and `copyTo` refuse a package root (`../api`, or `path: "."`): use a directory inside it (`public`).

### Preview

`vp preview` runs the server with the configured runtime (`dist/server/main.mjs`, or the entry itself when it ships as source) and forwards every request and WebSocket to it. The server hosts the client build itself, so the preview is what a deployment serves: same routes, same static files, same SPA fallback. `start()` reports its port to the preview server; other servers get `PORT` and `HOST`. Without a server, the preview serves the client only.

## Writing an Adapter

`cyrenex/adapter` holds what a framework adapter builds on, so `start`, `warmup`, `dispose` and `override` work for its apps:

- `attach(app, pond, { eager })` attaches the Pond and its warm-up to the app.
- `scopeOf(request, pond, setup)` returns the request's fork, created on first use; `release(request)` disposes it, and `releaseAfter(request, response)` once the response body has been sent. Forks are shared by every adapter handling the same request.
- `current(handle)` is the Pond requests resolve from, the override of `cyrenex/testing` while one is active.
- `describeError(error, expose)` is the response body for a `PondError`.

[`@cyrenex/elysia`](https://github.com/cyrenex/core/blob/master/packages/elysia/src/inject.ts) is the reference.

## Development

```bash
vp install
pnpm dev        # build cyrenex, then run the playground on Bun
pnpm dev:node   # ... on Node.js
pnpm test
vp check
```

The packages resolve each other through the `cyrenex-source` export condition (see `playground/vite.config.ts` and the `tsconfig.json` files), so edits under `packages/*/src` restart the playground and run in tests without a rebuild. Only changes to the Vite plugin itself need `vp run cyrenex#build`.

## License

[MIT](./LICENSE)

## Special Thanks

Thanks to everyone who has contributed to cyrenex ❤️

<a href="https://github.com/cyrenex/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=cyrenex/core" />
</a>

## Star History

<a href="https://star-history.dera.page/#cyrenex/core&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=cyrenex/core&type=Date" />
  </picture>
</a>
