// Production entry: `vp build`, then `bun server/main.ts` or `node server/main.ts`.
// serve() creates `eager` singletons first (a failure aborts startup), serves the client build
// with SPA fallback, listens on PORT and stops the app (disposing the Pond) on SIGINT/SIGTERM.
import { serve } from "cyrenex/serve";

import app from "./app.ts";

await serve(app);
