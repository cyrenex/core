# cyrenex

## 0.2.0-beta.1

### Minor Changes

- [#4](https://github.com/cyrenex/core/pull/4) [`a25b502`](https://github.com/cyrenex/core/commit/a25b5020f4f6c04eefa4c276fdee00d2480a14fa) Thanks [@YanChenBai](https://github.com/YanChenBai)! - Monorepo support in `cyrenex/vite`.

  - `entry` and `build.entry` take `{ package, path }`: the package is found in `node_modules`, else among the packages of the workspace (`pnpm-workspace.yaml`, or `workspaces` in `package.json`), without installing.
  - `vp dev` runs an app from another package in that package's directory, with its `.env` files.
  - `build.outDir: false` ships the server as source; `vp preview` then runs the entry in its package.
  - `build.client` sets the client output and copies it elsewhere with `copyTo`; directories outside Vite root are emptied first and must not be a package root.
  - `build.start` is the command printed after the build, next to where the client and server went.

- [`e3a4376`](https://github.com/cyrenex/core/commit/e3a4376a7a290a2f2d59847c3237e4e938143450) Thanks [@YanChenBai](https://github.com/YanChenBai)! - Upgrade `@cyrenex/pondi` to 0.2.0: `cyrenex` now re-exports `ripple.scoped` and `ripple.transient` (rippling with a fixed mode, no options) and their `ModeRipple` / `ModeRippleClass` types.

## 0.2.0-beta.0

### Minor Changes

- [`1ad1b04`](https://github.com/cyrenex/core/commit/1ad1b044f3aa097f039f006cdf4bc0aff054a2d6) Thanks [@YanChenBai](https://github.com/YanChenBai)! - Production builds and dev experience improvements.

  - Add `cyrenex/serve` for production server entries.
  - Build the production server with `vp build` and run the built server in `vp preview`.
  - Add `cyrenex/testing` with `override()`.
  - Dev plugin: add `routes: "auto"` to forward the app's own prefixes; add `inspect`, `execArgv`, `env` and `shutdownTimeout` options; load `.env` files into the app process; show app startup errors in Vite's error overlay; send a `cyrenex:restart` HMR event after restarts.
  - Fix: await `onStop` hooks on Bun before resolving.
  - Fix: drop conflicting `transfer-encoding` from Node.js responses.
  - Fix: wait for the preview server process on close.
  - Fix: dispose request scopes of rejected WebSocket upgrades.

## 0.1.0

### Minor Changes

- [`adfa114`](https://github.com/cyrenex/core/commit/adfa1141abb716b1fb93844120f01dc545da4c1c) Thanks [@YanChenBai](https://github.com/YanChenBai)! - cyrenex is now a full-stack Elysia toolkit: one `vp dev` serves the Vite frontend and the Elysia API, with pondi dependency injection, request scopes and Eden types.

  The dependency graph runtime published as `cyrenex@0.0.1-beta.*` now lives in [`@cyrenex/pondi`](https://www.npmjs.com/package/@cyrenex/pondi). `cyrenex` re-exports it, and adds the Elysia integration on top: `pondi()`, `inject()`, `RequestContext` and `warmup()`.
