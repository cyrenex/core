<h1 align="center">@cyrenex/elysia</h1>

<p align="center">Full-stack <a href="https://elysiajs.com">Elysia</a> with <a href="https://github.com/cyrenex/core">cyrenex</a>. Dependency injection by <a href="https://github.com/cyrenex/pondi">pondi</a>, end-to-end types by <a href="https://elysiajs.com/eden/overview">Eden</a>.</p>

<p align="center">
  English · <a href="https://github.com/cyrenex/core/blob/master/packages/elysia/README.zh-CN.md">简体中文</a> · <a href="https://www.npmjs.com/package/@cyrenex/elysia">npm</a> · <a href="https://github.com/cyrenex/core/tree/master/playground">Playground</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/v/@cyrenex/elysia?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/@cyrenex/elysia"><img src="https://img.shields.io/npm/dm/@cyrenex/elysia?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> The Elysia adapter of cyrenex. The dev server, builds, `start` options and testing are covered in the [cyrenex docs](https://github.com/cyrenex/core#readme); this page covers what is specific to Elysia.

## What's Special

- **Typed injection**: `inject({ users: UserService })` adds resolved services to the handler context with their inferred types.
- **Request scopes**: a request that injects something gets its own `pond.fork()`, disposed after the response, or when its WebSocket closes. Routes without injection pay nothing.
- **Readable DI errors**: a `PondError` becomes a 500 with its code and dependency path in development, and a plain 500 in production.
- **Plain Elysia**: no app factory. You create the app, pass your own adapter, and `.use(pondi(pond))`.
- **Elysia's own server**: `start` listens with the app's adapter, so WebSockets, `onStart` / `onStop` and `server` in handlers work in dev and in production.
- **Eden without paths**: `treaty<App>()` takes the app type from `cyrenex/client`.

## Installation

```bash
pnpm add cyrenex @cyrenex/elysia elysia @elysia/eden
pnpm add -D vite-plus

# Node.js runtime, used through @cyrenex/elysia/node
pnpm add @elysia/node
```

## Quick Start

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex()],
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

Start it from the server entry:

```ts
// server/main.ts
import { start } from "@cyrenex/elysia";
import app from "./app.ts";

await start(app);
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

Use `pondi(pond)` on the root app, before the routes. It decorates the context with `pond` and installs the hooks that create and dispose request scopes.

### Request scope

`scoped` services live in the request's `pond.fork()` and are disposed after the response, even on error; see [Services](https://github.com/cyrenex/core#services) for every mode.

`RequestContext` is the Elysia context of the current request. It is registered as `scoped` in every request fork, so a singleton depending on it fails with `CAPTIVE_DEPENDENCY` instead of caching one user's data for everyone.

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

`start` creates them before listening, in dev and in production; with a listener of your own, `await warmup(app)` before `.listen()`. If one fails (a database refusing connections, a missing provider, a cycle), startup fails with the error and its dependency path, and whatever was already created is disposed: the dev server logs it and retries on the next change, a production entry exits with the error.

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

## Starting

`start` from `@cyrenex/elysia` takes the options of [`start` from cyrenex](https://github.com/cyrenex/core#production) and listens with Elysia's own adapter instead of a plain `fetch`: it waits for async plugins, listens with the app's adapter, answers requests no route matches with the client build, and on stop runs the `onStop` hooks (awaiting them on Bun as well) and disposes the Pond.

An Elysia app also has a `fetch`, so `start` from `cyrenex/start` serves it too, without WebSockets and Elysia's lifecycle hooks.

## Testing

Test the app your module exports through Eden, without a network, and swap providers with [`override`](https://github.com/cyrenex/core#testing):

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

To test a route module on its own, build a small app with a forked Pond instead:

```ts
const app = new Elysia().use(pondi(pond.fork().use(ripple(Db, () => fakeDb)))).use(userRoutes);
```

## Node.js

The app owns its adapter; cyrenex never injects one. Bun needs none. On Node.js, install `@elysia/node` and pass the adapter from `@cyrenex/elysia/node`:

```ts
import { node } from "@cyrenex/elysia/node";

export default new Elysia({ adapter: node() }).use(pondi(pond));
```

It wraps `@elysia/node`, adds a working `app.stop()` and drops a conflicting header on file responses: upstream never sets `app.server` and has no `stop`, so `app.stop()` throws and `onStop` hooks never run. If you bring the plain `@elysia/node` adapter instead, `start` still closes the server and runs the hooks itself, but `app.stop()` in your own code throws.

To run the same app on both runtimes, choose at startup:

```ts
export const adapter =
  "Bun" in globalThis ? undefined : (await import("@cyrenex/elysia/node")).node();
```

## Known Limitations

- On Node.js, Elysia only registers WebSocket routes on instances created with a WebSocket-capable adapter, so pass the adapter to plugins that define `.ws()` routes too.
- On Node.js, WebSocket messages with a body schema may need an explicit `parse`.

## License

[MIT](https://github.com/cyrenex/core/blob/master/LICENSE)
