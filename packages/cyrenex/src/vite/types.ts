/** Vite environment running (in dev) and building the server. */
export const ENVIRONMENT = "server";

/** HMR event sent to pages after the app restarted. */
export const RESTART_EVENT = "cyrenex:restart";

/** Payload of {@link RESTART_EVENT}. */
export interface RestartEvent {
  runtime: Runtime;
}

/** Runtime executable used to launch the isolated application process. */
export type Runtime = "node" | "bun";

/**
 * A file or directory: a path relative to Vite root, or a path inside a workspace package,
 * found through `node_modules` (declare the package as a dependency, e.g. `workspace:*`).
 */
export type Location = string | { package: string; path: string };

export interface CyrenexOptions {
  /**
   * The server entry, relative to Vite root: the module that starts the app, usually with
   * `start(app)` from `cyrenex/start`. `vp dev` runs it and forwards `routes` to it; `vp build`
   * bundles it. It may live in another package of a monorepo, `{ package: "@acme/api", path:
   * "src/main.ts" }`: the app then runs in that package's directory, with its `.env` files.
   * @default "server/main.ts"
   */
  server?: Location;

  /**
   * Module default-exporting the app, relative to Vite root: its type is what `cyrenex/client`
   * exposes to the frontend. Only read for types.
   * @default "server/app.ts"
   */
  app?: Location;

  /**
   * Child process runtime, independent of the runtime running Vite.
   * @default process.env.CYRENEX_RUNTIME ?? "bun"
   */
  runtime?: Runtime;

  /**
   * Path prefixes forwarded to the app, matched by whole segments, without rewriting.
   * `"auto"` forwards the first segment of every route the app defines (`/api/users/:id` →
   * `/api`), re-read on each restart; routes such as `/` or `/:id` are skipped with a warning.
   * @default ["/api", "/ws"]
   */
  routes?: string[] | "auto";

  /**
   * Extra files, directories or globs (relative to Vite root) that restart the app.
   * The entry directory and every module loaded through Vite are always watched.
   * `false` disables automatic restarts.
   * @default []
   */
  watch?: false | string[];

  /**
   * Where to write the declaration that types `cyrenex/client`, relative to Vite root.
   * `false` disables generation.
   * @default "cyrenex-env.d.ts"
   */
  dts?: string | false;

  /**
   * Start the app with the inspector enabled: `true` for `127.0.0.1:9229`, a port, or
   * `"host:port"`. The port stays the same across restarts, so a debugger can reattach.
   * @default false
   */
  inspect?: boolean | number | string;

  /**
   * Extra runtime flags for the app process, e.g. `["--enable-source-maps"]`.
   * @default []
   */
  execArgv?: string[];

  /**
   * Variables for the app process, on top of the shell and the `.env` files.
   * @default {}
   */
  env?: Record<string, string>;

  /**
   * How long a restart waits for `app.stop()` (and the Pond's disposal) before killing the
   * old process, in milliseconds.
   * @default 1000
   */
  shutdownTimeout?: number;

  /** What `vp build` produces. `false` leaves the build to Vite (the client only). */
  build?: false | BuildOptions;
}

export interface BuildOptions {
  /**
   * Bundle `server` to `outDir/main.mjs`, runnable with `node` or `bun`; dependencies stay
   * external, as in Vite's SSR builds. The client build then defaults to `dist/client`.
   * `false` ships the server as source (run `bun server/main.ts`, or build it yourself).
   * @default { outDir: "dist/server" } when the server entry exists
   */
  server?: false | { outDir?: string };

  /**
   * Where the client build goes: a directory (relative to Vite root, possibly in the server's
   * package of a monorepo), or a directory plus copies of it. Directories outside Vite root
   * are emptied first, so they must not be a package root.
   * @default Vite's `build.outDir`, or "dist/client" when the server is bundled
   */
  client?: string | { outDir?: string; copyTo?: Location | Location[] };

  /**
   * How you start the server, shown after building: `"pnpm start"`, `"bun --filter api start"`…
   * cyrenex only prints it.
   * @default the runtime on the built server, or on the entry when it ships as source
   */
  start?: string;
}

export interface ResolvedOptions {
  server: Location;
  app: Location;
  runtime: Runtime;
  routes: string[] | "auto";
  watch: false | string[];
  dts: string | false;
  execArgv: string[];
  env: Record<string, string>;
  shutdownTimeout: number;
  build:
    | false
    | {
        /** `auto`: defaulted, so skipped when the entry does not exist. */
        server: false | { outDir: string; auto: boolean };
        client: { outDir: string | undefined; copyTo: Location[] };
        start: string | undefined;
      };
}

/** Bootstrap data serialized by env-runner and delivered to the child over IPC. */
export interface WorkerData {
  /** Absolute application entry resolved by the Vite host. */
  entry: string;
  /** Vite environment name used to namespace module-loading messages. */
  environment: string;
}

/** Initial data response received through env-runner's process handshake. */
export interface WorkerInitMessage {
  event?: string;
  data?: string;
}

/** Lifecycle message sharing the IPC channel with Vite's module transport. */
export interface WorkerControlMessage {
  event?: string;
}

/** Sent by the worker once the app listens, next to env-runner's `address`. */
export interface WorkerReadyMessage {
  address: { host: string; port: number };
  /** Route paths defined by the app, for `routes: "auto"`. */
  paths: string[];
}
