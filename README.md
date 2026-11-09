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

Building a full-stack TypeScript app usually means two dev servers, a proxy, a hand-rolled container and a client you keep in sync by hand. cyrenex folds that into one package with seven entries:

| Entry             | Where            | What                                                                         |
| ----------------- | ---------------- | ---------------------------------------------------------------------------- |
| `cyrenex`         | server           | `pondi`, `inject`, `RequestContext`, `warmup`, and all of pondi              |
| `cyrenex/node`    | server (Node.js) | `@elysia/node` adapter with a working `app.stop()`                           |
| `cyrenex/static`  | server (prod)    | `@elysia/static` with Vite defaults and SPA fallback                         |
| `cyrenex/serve`   | server (prod)    | `serve(app)`: warm-up, static files, listen, graceful shutdown               |
| `cyrenex/testing` | tests            | `override(app, ...)` swaps providers of an exported app                      |
| `cyrenex/vite`    | `vite.config.ts` | Runs the app in a child process, forwards `/api` and `/ws`, generates types  |
| `cyrenex/client`  | browser          | `type App`, so `treaty<App>()` never needs a `../server/app` relative import |

## What's Special

- **One origin in dev**: Vite serves the frontend and HMR; matching HTTP requests and WebSocket upgrades go to the app.
- **Real runtime, real restarts**: the app runs in a separate Bun or Node.js process, loaded through Vite's ModuleRunner and replaced on file changes.
- **Clean restarts**: every restart calls `app.stop()`, so `onStop` hooks run and the Pond disposes connections in reverse dependency order.
- **Typed injection**: `inject({ users: UserService })` adds resolved services to the handler context with their inferred types.
- **Request scopes**: a request that injects something gets its own `pond.fork()`, disposed after the response, or when its WebSocket closes. Routes without injection pay nothing.
- **Fail at startup, not on the first request**: `eager` singletons are created before the app listens, in dev and in production.
- **Readable DI errors**: a `PondError` becomes a 500 with its code and dependency path in development, and a plain 500 in production.
- **Plain Elysia**: no app factory. You create the app, pass your own adapter, and `.use(pondi(pond))`.
- **Eden without paths**: a generated `cyrenex-env.d.ts` registers your app type, so the browser imports it from `cyrenex/client`.
- **Same source in production**: the same `app.ts` runs on Bun and Node.js; `cyrenex/static` hosts the build with SPA fallback.

## Installation

```bash
pnpm add cyrenex elysia @elysia/eden
pnpm add -D vite-plus

# Node.js runtime, used through cyrenex/node
pnpm add @elysia/node
# Serve the built frontend through cyrenex/static
pnpm add @elysia/static
```

Requires Node.js 22.18+ and Vite 8 (or Vite+). The default runtime is Bun, which must be on `PATH`.

## Quick Start

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()], // entry: "server/app.ts", runtime: "bun"
});
```

Describe your services with pondi:

```ts
// server/services.ts
import { pebble, RequestContext, ripple } from "cyrenex";

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
import { inject, Pond, pondi, ripple } from "cyrenex";
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
| `singleton` | the root Pond                | on `app.stop()` / dev restart                               |
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

The dev server creates them before listening; in production, `await warmup(app)` before `.listen()`. If one fails (a database refusing connections, a missing provider, a cycle), startup fails with the error and its dependency path, and whatever was already created is disposed: the dev server logs it and retries on the next change, a production entry exits with the error.

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

Test the app your module exports, through Eden and without a network. `override` from `cyrenex/testing` swaps providers until it is disposed:

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
  entry: "server/app.ts",
  runtime: "bun",
  routes: ["/api", "/ws"],
  watch: ["templates/**"],
  dts: "cyrenex-env.d.ts",
  inspect: false,
  execArgv: [],
  env: {},
  shutdownTimeout: 1000,
});
```

| Option            | Default                                | Description                                                                       |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `entry`           | `"server/app.ts"`                      | Module default-exporting the Elysia app, relative to Vite root                    |
| `runtime`         | `process.env.CYRENEX_RUNTIME ?? "bun"` | `"bun"` or `"node"`, both run in a child process                                  |
| `routes`          | `["/api", "/ws"]`                      | Forwarded path prefixes, matched by whole segment, not rewritten; or `"auto"`     |
| `watch`           | `[]`                                   | Extra files, directories or globs that restart the app; `false` disables restarts |
| `dts`             | `"cyrenex-env.d.ts"`                   | Where to write the `cyrenex/client` declaration; `false` disables it              |
| `inspect`         | `false`                                | Enable the inspector: `true` (`127.0.0.1:9229`), a port, or `"host:port"`         |
| `execArgv`        | `[]`                                   | Extra runtime flags for the app process                                           |
| `env`             | `{}`                                   | Variables for the app process, over the shell and `.env` files                    |
| `shutdownTimeout` | `1000`                                 | Milliseconds a restart waits for `app.stop()` before killing the old process      |

The entry directory and every module loaded through Vite are always watched. `/api` matches `/api` and `/api/users`, not `/apix`.

With `routes: "auto"`, the forwarded prefixes are the first segments of the routes your app defines (`/api/users/:id` → `/api`), read again on every restart, so adding a `/rpc` route needs no config change. Routes whose first segment is empty, a parameter or a wildcard (`/`, `/:slug`, `*`) would take every page from the frontend; they are skipped with a warning.

### Environment variables

The app process gets every variable from Vite's `.env` files (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` in `envDir`), not only `VITE_*` ones: it is server code, so nothing reaches the browser. Variables already set in the shell win, as in Vite. Editing a `.env` file restarts the dev server; `envDir: false` disables loading.

### Debugging

`inspect: true` starts the app with `--inspect=127.0.0.1:9229` on either runtime. The port is released before the next process starts, so it stays the same across restarts and a debugger set to reconnect (VS Code's `"restart": true` attach configuration) follows the app. For Bun, open the printed `debug.bun.sh` URL or use the Bun extension.

### Restarts

- File changes are debounced by 100ms and queued; requests arriving mid-restart wait for the new process.
- The old process gets a shutdown message, runs `app.stop()` (so `onStop` and `pond.dispose()` run), and is killed after `shutdownTimeout` (1 second by default).
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

`vp build` builds the frontend. The server entry is a few lines with `cyrenex/serve`:

```ts
// server/main.ts
import { serve } from "cyrenex/serve";
import app from "./app.ts";

await serve(app);
```

```bash
bun server/main.ts
node server/main.ts
```

`serve(app, options?)` does what every production entry needs, in order:

1. Creates the `eager` singletons (`warmup(app)`); a failure rejects before anything listens.
2. Serves the client build through `cyrenex/static` with SPA fallback, after your routes. The directory is `dist/client` or `dist` under the working directory, skipped if neither exists; pass `static: { assets }` to choose, or `static: false` for an API only server.
3. Listens on `PORT` (default `3000`) and `HOST`, or the `port` and `hostname` options.
4. On `SIGINT` / `SIGTERM`, stops the app (`onStop` hooks, Pond disposal), then exits. Pass `signals: false` to handle them yourself.

It resolves to `{ port, url, stop }`. On Node.js, `app.stop()` needs the `cyrenex/node` adapter; `serve` falls back to closing the server and running the hooks itself. Bun reads `.env` files on its own; on Node.js run `node --env-file-if-exists=.env server/main.ts`.

### Static files

`cyrenex/static` wraps `@elysia/static` (install it yourself) for a Vite build. It takes every upstream option, with Vite-friendly defaults and an SPA fallback:

| Option   | Default  | Description                                                                         |
| -------- | -------- | ----------------------------------------------------------------------------------- |
| `assets` | `"dist"` | Built frontend directory, relative to the working directory                         |
| `prefix` | `"/"`    | URL prefix of the files; match Vite `base`                                          |
| `spa`    | `true`   | Serve `index.html` for page navigations matching no route; API calls keep their 404 |

Only `GET` requests that accept `text/html` fall back, so `fetch("/api/missing")` and a missing `/assets/app.js` still get a 404.

> [!TIP]
> Node.js runs TypeScript by stripping types, so enable `erasableSyntaxOnly` and use explicit `.ts` extensions to run the same source on both runtimes without a build step.

## Adapters

The app owns its adapter; cyrenex never injects one. Bun needs none. On Node.js, install `@elysia/node` and pass the adapter from `cyrenex/node`:

```ts
import { node } from "cyrenex/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

It wraps `@elysia/node` and adds a working `app.stop()`: upstream never sets `app.server` and has no `stop`, so `app.stop()` throws and `onStop` hooks, including `pond.dispose()`, never run. If you bring the plain `@elysia/node` adapter instead, the dev server still closes the server and runs the hooks itself, but `app.stop()` in your own entry throws.

To run the same app on both runtimes, choose at startup:

```ts
export const adapter = "Bun" in globalThis ? undefined : (await import("cyrenex/node")).node();
```

## Known Limitations

- On Node.js, Elysia only registers WebSocket routes on instances created with a WebSocket-capable adapter, so pass the adapter to plugins that define `.ws()` routes too.
- On Node.js, WebSocket messages with a body schema may need an explicit `parse`.
- The dev plugin is development only. Apart from writing `cyrenex-env.d.ts`, `vp build` builds just the frontend; the server entry and deployment are yours.

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
