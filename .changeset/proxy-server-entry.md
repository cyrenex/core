---
"cyrenex": minor
---

Run the server entry everywhere and proxy to it.

- **Breaking**: `cyrenex/serve` is now `cyrenex/start`: `serve(app)` → `start(app)`, `ServeOptions` → `StartOptions`, `Serving` → `Server`. It serves `app.fetch` with srvx, or any server through its `listen` option; Elysia apps use `start` from `@cyrenex/elysia`, which listens with Elysia's own server (WebSockets, `onStart` / `onStop`). `static` takes a directory, a `URL` or `{ dir, prefix, spa, ...srvx static options }` instead of `@elysia/static` options.
- **Breaking**: `vp dev` runs the server entry (`server/main.ts`) instead of loading the app from `server/app.ts`, so dev, preview and production start the app the same way. The `entry` option is replaced by `server` (the entry, default `server/main.ts`) and `app` (the app module for client types, default `server/app.ts`). Entries that listen without `start()` get a free `PORT` and are found by probing it.
- **Breaking**: `build: { entry, outDir }` is now `build: { server: { outDir } | false, client }`, and the server's Vite environment is named `server` instead of `elysia`.
- `build.server: false` ships the server as source; `build.client` sends the client build to a directory (possibly in another package) and `copyTo` copies it elsewhere. After building, cyrenex prints where everything went and how to start the server: the runtime on the entry, or your own command from `build.start` (`"pnpm start"`).
- Monorepos: the server entry may live in another package; it runs in that package's directory with its `.env` files, and `vp preview` runs it from source.
- `vp preview` learns the port from `start()` over IPC.
