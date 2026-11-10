// The server entry: `vp dev` runs it (and forwards /api and /ws to it), `vp build` bundles it
// to dist/server/main.mjs (run with node or bun), and `bun server/main.ts` runs it from source.
// start() creates `eager` singletons first (a failure aborts startup), listens on PORT with
// Elysia's own server (for its WebSockets), serves the client build with SPA fallback, and
// disposes the Pond on SIGINT/SIGTERM.
import { start } from "@cyrenex/elysia";

import app from "./app.ts";

await start(app);
