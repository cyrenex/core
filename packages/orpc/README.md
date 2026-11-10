<h1 align="center">@cyrenex/orpc</h1>

<p align="center">Full-stack <a href="https://orpc.dev">oRPC</a> with <a href="https://github.com/cyrenex/core">cyrenex</a>. Dependency injection by <a href="https://github.com/cyrenex/pondi">pondi</a>, end-to-end types by oRPC.</p>

<p align="center">
  English · <a href="https://github.com/cyrenex/core/blob/master/packages/orpc/README.zh-CN.md">简体中文</a> · <a href="https://www.npmjs.com/package/@cyrenex/orpc">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cyrenex/orpc"><img src="https://img.shields.io/npm/v/@cyrenex/orpc?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://www.npmjs.com/package/@cyrenex/orpc"><img src="https://img.shields.io/npm/dm/@cyrenex/orpc?style=flat&colorA=080f12&colorB=1fa669"></a>
  <a href="https://github.com/cyrenex/core/blob/master/LICENSE"><img src="https://img.shields.io/github/license/cyrenex/core.svg?style=flat&colorA=080f12&colorB=1fa669"></a>
</p>

> [!NOTE]
> The oRPC adapter of cyrenex, for oRPC v2. The dev server, builds, `start` options and testing are covered in the [cyrenex docs](https://github.com/cyrenex/core#readme); this page covers what is specific to oRPC.

## What's Special

- **Typed injection**: `inject({ users: UserService })` is an oRPC middleware adding resolved services to the procedure context with their inferred types.
- **Request scopes**: every request gets its own `pond.fork()`, disposed once the response has been sent, so streamed outputs (event iterators) keep their scoped values until they end.
- **Readable DI errors**: a `PondError` becomes an `INTERNAL_SERVER_ERROR` carrying its code and dependency path in development, and a plain one in production.
- **Plain oRPC**: procedures and routers are yours; `rpc(router, pond)` serves them with any oRPC fetch handler.
- **Typed client without paths**: `RouterClient<App["router"]>` takes the router type from `cyrenex/client`.

## Installation

```bash
pnpm add cyrenex @cyrenex/orpc @orpc/server@beta @orpc/client@beta
pnpm add -D vite-plus
```

## Quick Start

```ts
// vite.config.ts
import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cyrenex({ routes: ["/rpc"] })],
});
```

Describe your services with pondi:

```ts
// server/services.ts
import { RequestContext } from "@cyrenex/orpc";
import { ripple } from "cyrenex";

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
  ({ request }) => ({ name: request.headers.get("x-user") ?? "guest" }),
  { mode: "scoped" },
);
```

Inject them into procedures, and export the router served by `rpc`:

```ts
// server/app.ts
import { inject, rpc } from "@cyrenex/orpc";
import type { PondiContext } from "@cyrenex/orpc";
import { os } from "@orpc/server";
import { Pond } from "cyrenex";
import { CurrentUser, UserService } from "./services.ts";

const base = os.$context<PondiContext>();

const router = {
  users: base.use(inject({ users: UserService })).handler(({ context }) => context.users.list()),
  me: base.use(inject({ me: CurrentUser })).handler(({ context }) => context.me),
};

export default rpc(router, new Pond());
```

Start it from the server entry:

```ts
// server/main.ts
import { start } from "@cyrenex/orpc";
import app from "./app.ts";

await start(app);
```

Call it from the browser with the oRPC client:

```ts
// web/api.ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { App } from "cyrenex/client";

export const api = createORPCClient<RouterClient<App["router"]>>(
  new RPCLink({ origin: location.origin, url: "/rpc" }),
);

const me = await api.me(); // { name: string }
```

```bash
vp dev
```

## Injection

`inject` takes a record of tokens and resolves them before the handler runs. Tokens can be ripples, pebbles or string keys, exactly as in pondi. It is a middleware, so it composes with yours, and procedures needing it declare `PondiContext` as their initial context:

```ts
const base = os.$context<PondiContext>();

export const users = base
  .use(inject({ users: UserService, me: CurrentUser }))
  .use(auth)
  .handler(({ context }) => context.users.list());
```

### Request scope

`rpc` gives each request its own `pond.fork()` in `context.pond`, created once the prefix matches. `scoped` services live in it and are disposed once the response has been sent, even on error; see [Services](https://github.com/cyrenex/core#services) for every mode. Every `inject` of a request, and every procedure of a batched request, share the fork.

`RequestContext` is `{ request }`, the current `Request`. It is registered as `scoped` in every request fork, so a singleton depending on it fails with `CAPTIVE_DEPENDENCY` instead of caching one user's data for everyone.

### Streaming

A procedure returning an event iterator streams its response; the fork lives until the stream ends or the client goes away, so scoped services stay usable for every event:

```ts
export const feed = base.use(inject({ me: CurrentUser })).handler(async function* ({ context }) {
  for await (const item of watch(context.me)) yield item;
});
```

### Errors

A `PondError` thrown while resolving (a missing provider, a cycle, a captive dependency) becomes an `ORPCError`:

```ts
{ code: "INTERNAL_SERVER_ERROR", message: 'No provider for "app:config" (db -> app:config)',
  data: { code: "MISSING_PROVIDER", path: ["db", "app:config"] } }
```

Details are hidden and logged instead when `NODE_ENV` is `production`. Override with `rpc(router, pond, { exposeErrors })`.

## Serving

| `rpc` option   | Default                              | Description                                                       |
| -------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `prefix`       | `"/rpc"`                             | URL prefix of the procedures; match the client's `url`            |
| `handler`      | `(router) => new RPCHandler(router)` | The oRPC fetch handler, e.g. `OpenAPIHandler` or one with plugins |
| `eager`        | `[]`                                 | Singletons created before the app listens                         |
| `exposeErrors` | `NODE_ENV !== "production"`          | Include `PondError` details in error responses                    |

`rpc` returns an app with `fetch`, answering `404` outside the procedures, so `start` serves it like any fetch app: [`start` from cyrenex](https://github.com/cyrenex/core#production), also exported here. Forward its prefix in dev with `routes: ["/rpc"]`, or `routes: "auto"`, which reads it from the app.

To mount it in another server, `app.handle(request)` answers with the response, or `undefined` when no procedure matches.

## Testing

Call procedures in process through a link whose `fetch` is the app's, and swap providers with [`override`](https://github.com/cyrenex/core#testing):

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { ripple } from "cyrenex";
import { override } from "cyrenex/testing";
import app from "../server/app.ts";
import { Db } from "../server/services.ts";

const api = createORPCClient<RouterClient<typeof app.router>>(
  new RPCLink({
    origin: "http://localhost",
    url: "/rpc",
    fetch: (url, init) => app.fetch(new Request(url, init)),
  }),
);

test("lists users", async () => {
  await using _ = override(
    app,
    ripple(Db, () => fakeDb),
  );
  expect(await api.users()).toEqual([]);
});
```

Without HTTP, `createRouterClient` from oRPC takes the context itself: pass a fork of your Pond, and dispose it afterwards.

```ts
const pond = basePond.fork();
const client = createRouterClient(router, { context: { pond } });
```

## License

[MIT](https://github.com/cyrenex/core/blob/master/LICENSE)
