// Production entry: `vp build` first, then `bun server/main.ts` or `node server/main.ts`.
import { fileURLToPath } from "node:url";

import { warmup } from "cyrenex";
import { staticPlugin } from "cyrenex/static";

import app from "./app.ts";

const port = Number(process.env.PORT ?? 3000);

// Create `eager` singletons first: a failure aborts startup instead of the first request.
await warmup(app);

app
  .use(await staticPlugin({ assets: fileURLToPath(new URL("../dist", import.meta.url)) }))
  .listen(port, () => console.log(`listening on http://localhost:${port}`));

// app.stop() runs onStop hooks, which dispose the Pond (on Node.js via cyrenex/node).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.stop().finally(() => process.exit(0)));
}
