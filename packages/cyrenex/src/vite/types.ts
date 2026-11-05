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
}

export interface ResolvedOptions {
  entry: string;
  runtime: Runtime;
  routes: string[];
  watch: false | string[];
  dts: string | false;
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
