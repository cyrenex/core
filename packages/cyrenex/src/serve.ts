import { existsSync } from "node:fs";

import type { AnyElysia } from "elysia";

import type { StaticPluginOptions } from "./static.ts";
import { stopApp } from "./stop.ts";
import type { StoppableServer } from "./stop.ts";
import { warmup } from "./warmup.ts";

/** Set by the server build to the client build directory, next to the server output. */
export const CLIENT_DIR_ENV = "CYRENEX_CLIENT_DIR";

export interface ServeOptions {
  /** @default Number(process.env.PORT) || 3000 */
  port?: number;
  /** @default process.env.HOST, else the adapter's default */
  hostname?: string;
  /**
   * Serve the client build through `cyrenex/static` (install `@elysia/static`), after the
   * app's own routes. `false` serves the API only. Without options, the directory is the
   * client build next to a built server, else `dist/client` or `dist` under the working
   * directory, and it is skipped when that directory does not exist.
   */
  static?: StaticPluginOptions | false;
  /**
   * Signals that stop the app (running `onStop` hooks and disposing the Pond), then exit.
   * `false` leaves signal handling to you.
   * @default ["SIGINT", "SIGTERM"]
   */
  signals?: readonly NodeJS.Signals[] | false;
}

export interface Serving {
  /** The bound port. */
  port: number;
  url: string;
  /** Stop the app (`onStop` hooks, Pond disposal) and remove the signal handlers. */
  stop(): Promise<void>;
}

/** What Bun and `@elysia/node` hand to the `listen` callback. */
interface ListeningServer extends StoppableServer {
  port?: number;
  raw?: { ready?(): Promise<unknown>; node?: { server?: { address(): unknown } } };
}

/** The client build directory `serve()` uses by default, if any. */
export function clientDir(): string | undefined {
  const built = process.env[CLIENT_DIR_ENV];
  if (built) return built;
  return ["dist/client", "dist"].find((dir) => existsSync(`${dir}/index.html`));
}

/**
 * Start an app in production, from source (`bun server/main.ts`) or built (`node
 * dist/server/main.mjs`):
 *
 * ```ts
 * // server/main.ts
 * import { serve } from "cyrenex/serve";
 * import app from "./app.ts";
 *
 * await serve(app);
 * ```
 *
 * 1. Creates the `eager` singletons ({@link warmup}); a failure rejects before listening.
 * 2. Serves the client build with SPA fallback (see `static`).
 * 3. Listens on `PORT` (default 3000).
 * 4. Stops the app on SIGINT / SIGTERM, so `onStop` hooks run and the Pond is disposed.
 */
export async function serve(app: AnyElysia, options: ServeOptions = {}): Promise<Serving> {
  await warmup(app);

  if (options.static !== false) {
    const assets = options.static?.assets ?? clientDir();
    if (options.static || assets) {
      const { staticPlugin } = await import("./static.ts");
      app.use(await staticPlugin({ ...options.static, assets }));
    }
  }

  const port = options.port ?? (Number(process.env.PORT) || 3000);
  const hostname = options.hostname ?? process.env.HOST;
  const server = await new Promise<ListeningServer>((resolve) =>
    app.listen({ port, ...(hostname && { hostname }) }, (value) => resolve(value as never)),
  );
  await server.raw?.ready?.();
  // Bun reports the bound port; on Node.js it is on the underlying http.Server.
  const address = server.raw?.node?.server?.address() as { port?: number } | string | null;
  const bound = (typeof address === "object" && address?.port) || server.port || port;
  const url = `http://${hostname && hostname !== "0.0.0.0" ? hostname : "localhost"}:${bound}`;
  console.log(`listening on ${url}`);

  let stopping: Promise<void> | undefined;
  const stop = () => {
    for (const signal of signals) process.off(signal, onSignal);
    return (stopping ??= stopApp(app, server));
  };
  const onSignal = () => {
    stop()
      .catch((error: unknown) => console.error(error))
      .finally(() => process.exit(0));
  };
  const signals = options.signals === false ? [] : (options.signals ?? ["SIGINT", "SIGTERM"]);
  for (const signal of signals) process.once(signal, onSignal);

  return { port: bound, url, stop };
}
