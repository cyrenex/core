import { start as startApp } from "cyrenex/start";
import type { Server, StartOptions } from "cyrenex/start";
import type { AnyElysia } from "elysia";

import { listen } from "./listen.ts";

export type { Server, StartOptions } from "cyrenex/start";

/**
 * Start an Elysia app, in production and under `vp dev`:
 *
 * ```ts
 * // server/main.ts
 * import { start } from "@cyrenex/elysia";
 * import app from "./app.ts";
 *
 * await start(app);
 * ```
 *
 * `start` from `cyrenex/start` listening with Elysia's own adapter, so WebSockets, `onStart` /
 * `onStop` hooks and `server` in handlers work: creates the `eager` singletons, listens on
 * `PORT`, serves the client build for requests no route matches, and on SIGINT / SIGTERM stops
 * the app and disposes the Pond.
 */
export function start<App extends AnyElysia>(
  app: App,
  options: StartOptions<App> = {},
): Promise<Server> {
  return startApp(app, { listen, ...options });
}
