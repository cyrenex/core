// Production entry: `vp build` bundles it to dist/server/main.mjs (run with node or bun);
// `bun server/main.ts` also runs it straight from source.
// serve() creates `eager` singletons first (a failure aborts startup), serves the client build
// with SPA fallback, listens on PORT and stops the app (disposing the Pond) on SIGINT/SIGTERM.
import { serve } from "cyrenex/serve";

import app from "./app.ts";

await serve(app);
