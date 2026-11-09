---
"cyrenex": minor
---

Production builds and dev experience improvements.

- Add `cyrenex/serve` for production server entries.
- Build the production server with `vp build` and run the built server in `vp preview`.
- Add `cyrenex/testing` with `override()`.
- Dev plugin: add `routes: "auto"` to forward the app's own prefixes; add `inspect`, `execArgv`, `env` and `shutdownTimeout` options; load `.env` files into the app process; show app startup errors in Vite's error overlay; send a `cyrenex:restart` HMR event after restarts.
- Fix: await `onStop` hooks on Bun before resolving.
- Fix: drop conflicting `transfer-encoding` from Node.js responses.
- Fix: wait for the preview server process on close.
- Fix: dispose request scopes of rejected WebSocket upgrades.
