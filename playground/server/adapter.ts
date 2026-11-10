// The app owns its adapter. Bun needs none; Node.js uses `@cyrenex/elysia/node`
// (`@elysia/node`, installed by the app, with a working `app.stop()`). Pick one statically in a single-runtime app.
import type { ElysiaAdapter } from "elysia";

export const adapter: ElysiaAdapter | undefined =
  "Bun" in globalThis ? undefined : (await import("@cyrenex/elysia/node")).node();
