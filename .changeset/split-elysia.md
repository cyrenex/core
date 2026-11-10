---
"cyrenex": minor
"@cyrenex/elysia": minor
---

Move the Elysia integration into `@cyrenex/elysia`; `cyrenex` no longer depends on Elysia.

- **Breaking**: import `pondi`, `inject`, `RequestContext` and `start` (Elysia's own server, so WebSockets work) from `@cyrenex/elysia`, and the Node.js adapter from `@cyrenex/elysia/node`. `cyrenex/static` (`staticPlugin`) is removed: `start` serves the client build. `cyrenex` keeps pondi, `warmup`, `dispose`, `cyrenex/start`, `cyrenex/testing`, `cyrenex/vite` and `cyrenex/client`.
- `cyrenex/adapter` exposes what a framework adapter needs: `attach` (Pond, `eager` warm-up), per-request forks (`scopeOf`, `release`) shared across adapters, and `describeError` for `PondError` responses.
- `cyrenex/client`'s `App` is the registered app type of any framework, `unknown` until `cyrenex-env.d.ts` registers one.
- `vp build` no longer tries to build a configured server environment when the server ships as source.
