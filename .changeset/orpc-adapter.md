---
"cyrenex": minor
"@cyrenex/orpc": minor
---

Add `@cyrenex/orpc`, the oRPC v2 adapter.

- `rpc(router, pond, { prefix, handler, eager, exposeErrors })` serves a router over any oRPC fetch handler (`RPCHandler` by default) as an app with `fetch`, which `start`, `warmup`, `override` and `routes: "auto"` work with; `handle(request)` mounts it in another server.
- `inject(tokens)` is a typed oRPC middleware resolving services from the request's fork in `context.pond` (`PondiContext`); `RequestContext` is `{ request }`.
- A `PondError` becomes an `INTERNAL_SERVER_ERROR` with its code and dependency path, hidden in production.
- `cyrenex/adapter` gains `releaseAfter(request, response)`: request scopes outlive streamed responses (event iterators) until they end or are cancelled.
