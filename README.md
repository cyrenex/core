<h1 align="center">cyrenex</h1>

<p align="center">Full-stack Elysia inside Vite. Dependency injection by <a href="https://github.com/cyrenex/pondi">pondi</a>, end-to-end types by <a href="https://elysiajs.com/eden/overview">Eden</a>.</p>

<p align="center">
  English · <a href="https://github.com/cyrenex/core/blob/master/README.zh-CN.md">简体中文</a> · <a href="https://www.npmjs.com/package/cyrenex">npm</a> · <a href="https://github.com/cyrenex/core/tree/master/playground">Playground</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/v/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/cyrenex"><img src="https://img.shields.io/npm/dm/cyrenex?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> One `vp dev` serves your frontend and your Elysia API from the same origin. The API runs in its own Bun or Node.js process, restarts on change, and disposes every resource on the way out.

Building a full-stack TypeScript app usually means two dev servers, a proxy, a hand-rolled container and a client you keep in sync by hand. cyrenex folds that into a framework-free core and an adapter per framework (Elysia today):

| Package / entry          | Where            | What                                                                        |
| ------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `cyrenex`                | server           | all of pondi, `warmup`, `dispose`                                           |
| `cyrenex/start`          | server           | `start(app)`: warm-up, static files, listen, graceful shutdown              |
| `cyrenex/testing`        | tests            | `override(app, ...)` swaps providers of an exported app                     |
| `cyrenex/vite`           | `vite.config.ts` | Runs `server/main.ts` in a child process, forwards `/api` and `/ws`, builds |
| `cyrenex/client`         | browser          | `type App`, so `treaty<App>()` never needs a `../server/app` import         |
| `cyrenex/adapter`        | adapters         | Building blocks for framework adapters: Pond attachment, request scopes     |
| `@cyrenex/elysia`        | server           | `pondi`, `inject`, `RequestContext`, `start` for Elysia                     |
| `@cyrenex/elysia/node`   | server (Node.js) | `@elysia/node` adapter with a working `app.stop()`                          |
| `@cyrenex/elysia/static` | server           | `@elysia/static` with Vite defaults and SPA fallback                        |

## What's Special

- **One origin in dev**: Vite serves the frontend and HMR; matching HTTP requests and WebSocket upgrades go to the app.
- **Real runtime, real restarts**: the app runs in a separate Bun or Node.js process, loaded through Vite's ModuleRunner and replaced on file changes.
- **One entry everywhere**: `server/main.ts` starts the app with `start(app)` under `vp dev`, `vp preview` and in production; the dev server only proxies to it.
- **Clean restarts**: every restart stops the server and disposes the Pond, closing connections in reverse dependency order.
- **Typed injection**: `inject({ users: UserService })` adds resolved services to the handler context with their inferred types.
- **Request scopes**: a request that injects something gets its own `pond.fork()`, disposed after the response, or when its WebSocket closes. Routes without injection pay nothing.
- **Fail at startup, not on the first request**: `eager` singletons are created before the app listens, in dev and in production.
- **Readable DI errors**: a `PondError` becomes a 500 with its code and dependency path in development, and a plain 500 in production.
- **Plain Elysia**: no app factory. You create the app, pass your own adapter, and `.use(pondi(pond))`.
- **Eden without paths**: a generated `cyrenex-env.d.ts` registers your app type, so the browser imports it from `cyrenex/client`.
- **Same source in production**: the same entry runs on Bun and Node.js, built or from source; `start()` hosts the client build with SPA fallback.
- **Monorepo friendly**: the server entry may live in another package, and the client build can go to (or be copied into) it.

## Installation

```bash
pnpm add cyrenex @cyrenex/elysia elysia @elysia/eden
pnpm add -D vite-plus

# Node.js runtime, used through @cyrenex/elysia/node
pnpm add @elysia/node
```

Requires Node.js 22.18+ and Vite 8 (or Vite+). The default runtime is Bun, which must be on `PATH`.

## Quick Start

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()], // server: "server/main.ts", app: "server/app.ts", runtime: "bun"
});
```

Describe your services with pondi:

```ts
// server/services.ts
import { RequestContext } from "@cyrenex/elysia";
import { pebble, ripple } from "cyrenex";

export const Config = pebble<{ greeting: string }>("app:config");

export const Db = ripple("db", async () => {
  const pool = await connect(process.env.DATABASE_URL);
  return { pool, [Symbol.asyncDispose]: () => pool.end() };
});

export const UserService = ripple("user:service", [Db], (db) => ({
  list: () => db.pool.query("select * from users"),
}));

// One instance per request.
export const CurrentUser = ripple(
  "user:current",
  [RequestContext],
  (ctx) => ({ name: ctx.request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
```

Attach the Pond with `pondi`, inject services into routes, and export the app **without** calling `.listen()`:

```ts
// server/app.ts
import { inject, pondi } from "@cyrenex/elysia";
import { Pond, ripple } from "cyrenex";
import { Elysia } from "elysia";
import { Config, CurrentUser, UserService } from "./services.ts";

const pond = new Pond().use(ripple(Config, () => ({ greeting: "Hello" })));

export default new Elysia()
  .use(pondi(pond))
  .use(inject({ users: UserService, me: CurrentUser }))
  .get("/api/users", ({ users }) => users.list())
  .get("/api/me", ({ me }) => me);
```

Call it from the browser with official Eden:

```ts
// web/api.ts
import { treaty } from "@elysia/eden";
import type { App } from "cyrenex/client";

export const api = treaty<App>(location.origin);

const { data } = await api.api.me.get(); // { name: string } | null
```

Start it from the server entry. `vp dev` runs this file and forwards `/api` and `/ws` to it; `vp build` bundles it for production:

```ts
// server/main.ts
import { start } from "@cyrenex/elysia";
import app from "./app.ts";

await start(app);
```

```bash
vp dev
```

## Injection

`inject` takes a record of tokens and resolves them before the handler runs. Tokens can be ripples, pebbles or string keys, exactly as in pondi.

```ts
export const userRoutes = new Elysia({ prefix: "/api/users" })
  .use(inject({ users: UserService, me: CurrentUser }))
  .get("/", ({ users }) => users.list())
  .get("/me", ({ me }) => me);
```

Route modules stay plain Elysia instances, so `typeof app` remains fully static for Eden. The Pond comes from the app at request time, which is what makes swapping it in tests possible.

### Request scope

| mode        | Lives in                     | Disposed                                                    |
| ----------- | ---------------------------- | ----------------------------------------------------------- |
| `singleton` | the root Pond                | when the server stops (`stop()`, a signal, a dev restart)   |
| `scoped`    | the request's `pond.fork()`  | after the response, even on error; for WebSockets, on close |
| `transient` | nowhere, new on each resolve | with the request scope                                      |

`RequestContext` is the Elysia context of the current request. It is registered as `scoped` in every request fork, so a singleton depending on it fails with `CAPTIVE_DEPENDENCY` instead of caching one user's data for everyone.

The fork is created lazily: requests to routes without `inject` never touch the container.

Use `pondi(pond)` on the root app, before the routes. It decorates the context with `pond` and installs the hooks that create and dispose request scopes.

### WebSockets

In a WebSocket route, injected values sit on `ws.data` and the scope lives as long as the connection: every message sees the same instances, and they are disposed after your `close` handler runs. If the upgrade is rejected (a hook or the handler returns an error status), the scope is disposed with the response.

```ts
const Session = ripple("session", [RequestContext], (ctx) => openSession(ctx.headers), {
  mode: "scoped",
});

app.use(inject({ session: Session })).ws("/ws", {
  message(ws, message) {
    ws.data.session.track(message);
  },
});
```

### Eager singletons

Singletons are created on first use by default. List the ones that must work before the app serves traffic:

```ts
new Elysia().use(pondi(pond, { eager: [Db, Cache] }));
```

`start()` creates them before listening, in dev and in production; with a listener of your own, `await warmup(app)` before `.listen()`. If one fails (a database refusing connections, a missing provider, a cycle), startup fails with the error and its dependency path, and whatever was already created is disposed: the dev server logs it and retries on the next change, a production entry exits with the error.

Only singletons are accepted. Without `warmup(app)`, an `onStart` hook still creates them, but cannot hold startup back and only logs failures.

### Errors

A `PondError` thrown while resolving (a missing provider, a cycle, a captive dependency) becomes a 500 response:

```json
{
  "error": "PondError",
  "code": "MISSING_PROVIDER",
  "message": "No provider for \"app:config\" (db -> app:config)",
  "path": ["db", "app:config"]
}
```

Details are hidden and logged instead when `NODE_ENV` is `production`. Override with `pondi(pond, { exposeErrors })`. Other errors are left to Elysia.

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

Commit it and include it in your `tsconfig.json`, so a fresh clone type-checks before the dev server ever runs. Change the location with `dts`, or disable it with `dts: false` and write the declaration yourself.

> [!TIP]
> The browser only imports a type. The server code is erased at build time and never ends up in your bundle, but your frontend `tsconfig.json` still needs the types the server uses (e.g. `@types/node`).

## Testing

Test the app your module exports, through Eden and without a network. `override` from `cyrenex/testing` swaps providers until it is disposed, the same way in Vitest and `bun test`:

```ts
import { treaty } from "@elysia/eden";
import { ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import app from "../server/app.ts";
import { Db } from "../server/services.ts";

const api = treaty(app);

test("lists users", async () => {
  await using _ = override(
    app,
    ripple(Db, () => fakeDb),
  );
  expect((await api.api.users.get()).data).toEqual([]);
});
```

Requests resolve from a fork of the app's Pond that shadows the given ripples: singletons depending on them (`UserService` on `Db`) are created again in the fork, the real ones are left alone, and the fork is disposed on restore. Overrides nest and are restored in reverse order. They apply to every request of that app, so don't run overriding tests of one app concurrently.

To test a route module on its own, build a small app with a forked Pond instead:

```ts
const app = new Elysia().use(pondi(pond.fork().use(ripple(Db, () => fakeDb)))).use(userRoutes);
```

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
- The old process gets a shutdown message, closes the server started by `start()` (running Elysia's `onStop` hooks) and disposes the Pond, and is killed after `shutdownTimeout` (1 second by default).
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

`start` from `@cyrenex/elysia` (or from `cyrenex/start`, for any app with a `fetch`) does what every server entry needs, in order:

1. Creates the `eager` singletons (`warmup(app)`); a failure rejects before anything listens.
2. Listens on `PORT` (default `3000`) and `HOST`, or the `port` and `hostname` options: with Elysia's own adapter from `@cyrenex/elysia`, with srvx serving `fetch` from `cyrenex/start`. Pass `listen` to use another server.
3. Serves the client build after your routes, with SPA fallback. Under `vp dev` it serves none: Vite serves the frontend.
4. On `SIGINT` / `SIGTERM`, closes the server and disposes the Pond, then exits. Pass `signals: false` to handle them yourself.

It resolves to `{ port, url, stop }`. Under `vp dev` and `vp preview` it listens where the dev or preview server forwards to, and leaves restarts to it.

### Listeners

`start` from `@cyrenex/elysia` waits for async Elysia plugins, listens with the app's adapter (so WebSockets, `onStart` / `onStop` and `server` in handlers work), answers unmatched requests with the client build, and stops the app on `close`, awaiting its `onStop` hooks on Bun as well.

`start` from `cyrenex/start` only needs `app.fetch`, which carries no WebSockets. For another server, pass a `listen` function that starts it and returns its port and a `close`:

```ts
import { start } from "cyrenex/start";

// Any server taking a fetch handler; `fetch` already falls back to the client build.
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

### Monorepos

The server can live in its own package. Point `server` (and `app`, for the client type) at it, and build the client into it, or copy it there:

```ts
// apps/web/vite.config.ts
cyrenex({
  server: "../api/src/main.ts",
  app: "../api/src/app.ts",
  build: { server: false, client: { outDir: "dist", copyTo: "../api/public" } },
});
```

- `vp dev` runs the entry in the server package's directory, with that package's `.env` files.
- `vp build` writes the client, copies it, and prints how to start the server: `cd ../api && bun src/main.ts`, or your own command with `build.start: "pnpm --filter @acme/api start"`. cyrenex only prints it.
- `vp preview` runs the entry from source, in its package.

Directories outside Vite root are emptied before writing, so `client` and `copyTo` refuse a package root (`../api`): use a directory inside it (`../api/public`).

### Preview

`vp preview` runs the server with the configured runtime (`dist/server/main.mjs`, or the entry itself when it ships as source) and forwards every request and WebSocket to it. The server hosts the client build itself, so the preview is what a deployment serves: same routes, same static files, same SPA fallback. `start()` reports its port to the preview server; other servers get `PORT` and `HOST`. Without a server, the preview serves the client only.

> [!TIP]
> Node.js runs TypeScript by stripping types, so enable `erasableSyntaxOnly` and use explicit `.ts` extensions to run the same source on both runtimes without a build step.

`@cyrenex/elysia/static` remains for apps adding static files to Elysia themselves: it wraps `@elysia/static` (install it yourself) with Vite-friendly defaults (`assets: "dist"`, `prefix: "/"`) and the same SPA fallback.

## Adapters

The app owns its adapter; cyrenex never injects one. Bun needs none. On Node.js, install `@elysia/node` and pass the adapter from `@cyrenex/elysia/node`:

```ts
import { node } from "@cyrenex/elysia/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

It wraps `@elysia/node` and adds a working `app.stop()`: upstream never sets `app.server` and has no `stop`, so `app.stop()` throws and `onStop` hooks never run. If you bring the plain `@elysia/node` adapter instead, `start` still closes the server and runs the hooks itself, but `app.stop()` in your own code throws.

To run the same app on both runtimes, choose at startup:

```ts
export const adapter =
  "Bun" in globalThis ? undefined : (await import("@cyrenex/elysia/node")).node();
```

## Known Limitations

- On Node.js, Elysia only registers WebSocket routes on instances created with a WebSocket-capable adapter, so pass the adapter to plugins that define `.ws()` routes too.
- On Node.js, WebSocket messages with a body schema may need an explicit `parse`.

## Development

```bash
vp install
pnpm dev        # build cyrenex, then run the playground on Bun
pnpm dev:node   # ... on Node.js
pnpm test
vp check
```

The playground resolves `cyrenex` through the `cyrenex-source` export condition (see `playground/vite.config.ts` and `tsconfig.json`), so edits under `packages/cyrenex/src` restart the app without a rebuild. Only changes to the Vite plugin itself need `vp run cyrenex#build`.

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
