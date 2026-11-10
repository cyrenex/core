// How `start()` talks to whatever launched the process: the dev worker (in process) or
// `vp preview` (over IPC). Without a host, `start()` behaves as in production.

/** Where the dev worker installs its {@link Host}; registered, as the app loads its own copy. */
export const HOST: unique symbol = Symbol.for("cyrenex.host") as never;

/** Set by the built server entry to the client build directory; read by `start()`. */
export const CLIENT_DIR_ENV = "CYRENEX_CLIENT_DIR";

/** Set by `vp preview` on the server process it spawns with an IPC channel. */
export const IPC_ENV = "CYRENEX_IPC";

/** Sent over IPC by `start()` once the app listens. */
export const LISTENING_EVENT = "cyrenex:listening";

export interface Listening {
  port: number;
  /** Route paths of the app, for `routes: "auto"`. */
  paths: string[];
}

export interface ListeningMessage extends Listening {
  event: typeof LISTENING_EVENT;
}

export interface Host {
  /** The Vite dev server serves the frontend: no static files. */
  readonly dev: boolean;
  /** Overrides the port and hostname `start()` would use. */
  readonly port?: number;
  readonly hostname?: string;
  listening(info: Listening): void;
  /**
   * The host stops the app itself (on restart), so `start()` installs no signal handlers and
   * hands its `stop` over instead.
   */
  adopt?(stop: () => Promise<void>): void;
}

/** The host of this process, if any. */
export function hostOf(): Host | undefined {
  const local = (globalThis as { [HOST]?: Host })[HOST];
  if (local) return local;
  if (process.env[IPC_ENV] && process.send) {
    return {
      dev: false,
      listening: (info) => {
        if (process.connected) process.send?.({ event: LISTENING_EVENT, ...info });
      },
    };
  }
  return undefined;
}

/** Route paths of frameworks exposing `app.routes` (Elysia, Hono). */
export function routesOf(app: object): string[] {
  const routes = (app as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) return [];
  return routes
    .map((route) => (route as { path?: unknown } | null)?.path)
    .filter((path): path is string => typeof path === "string");
}
