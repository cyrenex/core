# cyrenex

## 0.1.0

### Minor Changes

- [`adfa114`](https://github.com/cyrenex/core/commit/adfa1141abb716b1fb93844120f01dc545da4c1c) Thanks [@YanChenBai](https://github.com/YanChenBai)! - cyrenex is now a full-stack Elysia toolkit: one `vp dev` serves the Vite frontend and the Elysia API, with pondi dependency injection, request scopes and Eden types.
  
  The dependency graph runtime published as `cyrenex@0.0.1-beta.*` now lives in [`@cyrenex/pondi`](https://www.npmjs.com/package/@cyrenex/pondi). `cyrenex` re-exports it, and adds the Elysia integration on top: `pondi()`, `inject()`, `RequestContext` and `warmup()`.
