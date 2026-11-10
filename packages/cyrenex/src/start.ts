import { assets as createAssets } from "./assets.ts";
import type { Assets, StaticOptions } from "./assets.ts";
import { hostOf, routesOf } from "./host.ts";
import { dispose, warmup } from "./lifecycle.ts";

export { clientDir } from "./assets.ts";
export type { Assets, StaticOptions } from "./assets.ts";

/** Anything with a web-standard `fetch` handler: Hono, h3, Elysia, an oRPC handler… */
export interface Fetchable {
  fetch(request: Request): Response | Promise<Response>;
}

export interface ListenContext<App> {
  app: App;
  port: number;
  hostname: string | undefined;
  /** The app's `fetch`, falling back to the client build for its 404s. */
  fetch: (request: Request) => Promise<Response>;
  /**
   * The client build alone, for servers that cannot take `fetch` (a framework's own
   * listener): answer unmatched requests with it. `undefined` when there is nothing to serve.
   */
  assets: Assets | undefined;
}

/** A listening server. */
export interface Listener {
  /** The bound port. */
  port: number;
  /** Stop accepting connections and close the open ones. */
  close(): unknown;
}

/**
 * Start listening: `({ port, hostname, fetch }) => Bun.serve({ port, hostname, fetch, websocket })`.
 * The default serves `fetch` with srvx, on Node.js and Bun.
 */
export type Listen<App = any> = (context: ListenContext<App>) => Listener | Promise<Listener>;

export interface StartOptions<App = any> {
  /** `0` picks a free port. @default Number(process.env.PORT ?? 3000) */
  port?: number;
  /** @default process.env.HOST, else all interfaces */
  hostname?: string;
  /**
   * Serve the client build after the app, with SPA fallback: a directory, or options. Without
   * it, the directory is the client build next to a built server, else `dist/client` or `dist`
   * under the working directory, skipped when it does not exist. `false` serves the API only.
   * Never served in development, where Vite serves the frontend.
   */
  static?: StaticOptions | string | URL | false;
  /**
   * How to listen, for servers beyond a plain `fetch` (WebSockets, a framework's own
   * listener). @default srvx serving `fetch`
   */
  listen?: Listen<App>;
  /**
   * Signals that stop the app (closing the server and disposing the Pond), then exit.
   * `false` leaves signal handling to you.
   * @default ["SIGINT", "SIGTERM"]
   */
  signals?: readonly NodeJS.Signals[] | false;
}

export interface Server {
  /** The bound port. */
  port: number;
  url: string;
  /** Close the server, dispose the Pond, and remove the signal handlers. Idempotent. */
  stop(): Promise<void>;
}

/** srvx serving `fetch`. */
const serveFetch: Listen = async ({ port, hostname, fetch }) => {
  const { serve } = await import("srvx");
  const server = serve({ fetch, port, hostname, silent: true, gracefulShutdown: false });
  await server.ready();
  const address = server.node?.server?.address();
  const bound = (typeof address === "object" && address?.port) || server.bun?.server?.port;
  if (!bound) throw new Error("cyrenex: the server did not report a listening port.");
  return { port: bound, close: () => server.close(true) };
};

/**
 * Start an app, in production and under `vp dev`:
 *
 * ```ts
 * // server/main.ts
 * import { start } from "cyrenex/start";
 * import app from "./app.ts";
 *
 * await start(app);
 * ```
 *
 * 1. Creates the `eager` singletons of `pondi()`; a failure rejects before listening.
 * 2. Listens on `PORT` (default 3000), serving the client build after the app's routes.
 * 3. On SIGINT / SIGTERM, closes the server and disposes the Pond, then exits.
 *
 * Under `vp dev` it listens on the port the dev server forwards to and leaves the frontend
 * and restarts to Vite; under `vp preview` it reports its port to the preview server.
 */
export async function start<App extends object>(
  app: App,
  options: StartOptions<App> = {},
): Promise<Server> {
  const host = hostOf();
  // Read `fetch` per request only: Elysia's is a getter that compiles the app, after which
  // hooks added by a listener (the client build fallback) would be ignored.
  const appFetch = (request: Request) => (app as unknown as Fetchable).fetch(request);
  if (!options.listen && !("fetch" in app)) {
    throw new TypeError("cyrenex: start() needs an app with fetch(), or a listen option.");
  }

  await warmup(app);

  const assets =
    host?.dev || options.static === false ? undefined : createAssets(options.static ?? {});
  const fetch = async (request: Request): Promise<Response> => {
    const response = await appFetch(request);
    if (response.status !== 404 || !assets) return response;
    const file = await assets(request);
    if (!file) return response;
    // Not awaited: some bodies (Elysia's on @elysia/node) never settle a cancel.
    response.body?.cancel().catch(() => {});
    return file;
  };

  const port = host?.port ?? options.port ?? Number(process.env.PORT || 3000);
  const hostname = host?.hostname ?? options.hostname ?? (process.env.HOST || undefined);
  let listener: Listener;
  try {
    listener = await (options.listen ?? serveFetch)({ app, port, hostname, fetch, assets });
  } catch (error) {
    await dispose(app).catch(() => {});
    throw error;
  }

  const shown = hostname && hostname !== "0.0.0.0" && hostname !== "::" ? hostname : "localhost";
  const url = `http://${shown}:${listener.port}`;
  if (!host?.dev) console.log(`listening on ${url}`);

  const signals =
    host?.adopt || options.signals === false ? [] : (options.signals ?? ["SIGINT", "SIGTERM"]);
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    for (const signal of signals) process.off(signal, onSignal);
    return (stopping ??= (async () => {
      try {
        await listener.close();
      } finally {
        await dispose(app);
      }
    })());
  };
  const onSignal = (): void => {
    stop()
      .catch((error: unknown) => console.error(error))
      .finally(() => process.exit(0));
  };
  for (const signal of signals) process.once(signal, onSignal);

  host?.adopt?.(stop);
  host?.listening({ port: listener.port, paths: routesOf(app) });
  return { port: listener.port, url, stop };
}
