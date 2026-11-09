/** Runtime executable used to launch the isolated application process. */
export type Runtime = "node" | "bun";

export interface CyrenexOptions {
  /**
   * Module default-exporting the Elysia app (without calling `.listen()`), relative to Vite root.
   * @default "server/app.ts"
   */
  entry?: string;

  /**
   * Child process runtime, independent of the runtime running Vite.
   * @default process.env.CYRENEX_RUNTIME ?? "bun"
   */
  runtime?: Runtime;

  /**
   * Path prefixes forwarded to the app, matched by whole segments, without rewriting.
   * @default ["/api", "/ws"]
   */
  routes?: string[];

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
}

export interface ResolvedOptions {
  entry: string;
  runtime: Runtime;
  routes: string[];
  watch: false | string[];
  dts: string | false;
  execArgv: string[];
  env: Record<string, string>;
  shutdownTimeout: number;
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

/**
 * Framework side of the dev worker. Receives the entry's default export, validates it
 * synchronously, and returns a handle the worker drives without knowing the framework.
 */
export type ServerAdapter = (exported: unknown) => ServerHandle;

export interface ServerHandle {
  /** Run startup work (plugins, warm-up) and listen on a random port of `hostname`. */
  listen(options: { hostname: string }): Promise<{ port: number }>;
  /**
   * Stop the server and release app resources. May be called before `listen` settles or
   * after it failed, and must still release whatever was acquired.
   */
  close(): Promise<void>;
}
