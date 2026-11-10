---
"cyrenex": minor
---

Monorepo support in `cyrenex/vite`.

- `entry` and `build.entry` take `{ package, path }`: the package is found in `node_modules`, else among the packages of the workspace (`pnpm-workspace.yaml`, or `workspaces` in `package.json`), without installing.
- `vp dev` runs an app from another package in that package's directory, with its `.env` files.
- `build.outDir: false` ships the server as source; `vp preview` then runs the entry in its package.
- `build.client` sets the client output and copies it elsewhere with `copyTo`; directories outside Vite root are emptied first and must not be a package root.
- `build.start` is the command printed after the build, next to where the client and server went.
