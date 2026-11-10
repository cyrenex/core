import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RunnerManager } from "env-runner";
import { createViteHotChannel } from "env-runner/vite";
import { NodeRequest, sendNodeResponse } from "srvx/node";
import { createFilter, DevEnvironment, loadEnv, normalizePath } from "vite";
import type { ErrorPayload, ResolvedConfig, ViteDevServer } from "vite";

import { locate, packageDirOf } from "./packages.ts";
import { RuntimeProcessRunner } from "./process.ts";
import type { ProcessOptions } from "./process.ts";
import { matchesRoutes, normalizeRoutes, prefixesOf } from "./routes.ts";
import { RESTART_EVENT } from "./types.ts";
import type { ResolvedOptions, RestartEvent, WorkerReadyMessage } from "./types.ts";

/** Owns request forwarding and process replacement for the server entry. */
export class ServerEnvironment extends DevEnvironment {
  /** Stable HTTP/WS forwarding facade across child-process replacements. */
  private readonly backend: RunnerManager;

  /** Direct IPC target while module loading still precedes HTTP readiness. */
  private currentRunner: RuntimeProcessRunner | undefined;

  private readonly workerEntry: string;
  private readonly process: ProcessOptions;
  private readonly shutdownTimeout: number;
  /** Absolute server entry used by the child module runner. */
  private readonly entry: string;
  /** Matches extra watch patterns and the entry directory, excluding dependency stores. */
  private readonly matchesWatch: (id: unknown) => boolean;
  /** Concrete watcher roots extracted from the glob patterns. */
  private readonly watchRoots: string[];
  private readonly watching: boolean;
  /** Normalized path prefixes; forwarding preserves the original URL. */
  private routes: string[];
  /** Read the prefixes from the app on every start instead of the options. */
  private readonly autoRoutes: boolean;
  /** Paths `routes: "auto"` last warned about. */
  private skipped = "";
  /** Business upgrade sockets, closed before their owning child is replaced. */
  private readonly sockets = new Set<Socket>();
  /** Serial restart queue, also awaited by incoming requests and upgrades. */
  private task: Promise<void> = Promise.resolve();
  /** Debounce timer coalescing related filesystem events into one restart. */
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private cleanup: (() => void) | undefined;
  /** The browser's HMR channel, used to show startup failures in Vite's error overlay. */
  private client: ViteDevServer["ws"] | undefined;
  /** The last startup failure, shown to browsers until a restart succeeds. */
  private failure: ErrorPayload["err"] | undefined;

  constructor(name: string, config: ResolvedConfig, options: ResolvedOptions) {
    const entry = locate(config.root, options.server);
    // In a monorepo the entry may belong to another package: run the app there, with its own
    // `.env` files, as it runs in production.
    const root = normalizePath(config.root);
    const own = packageDirOf(root);
    const server = packageDirOf(dirname(entry));
    const elsewhere = server !== undefined && server !== own;
    const backend = new RunnerManager();

    super(name, config, {
      hot: true,
      // Module loading precedes HTTP readiness, so messages go straight to the current runner.
      transport: createViteHotChannel(
        {
          sendMessage: (message) => this.currentRunner?.sendMessage(message),
          onMessage: (listener) => backend.onMessage(listener),
          offMessage: (listener) => backend.offMessage(listener),
        },
        name,
      ),
    });

    this.backend = backend;
    this.entry = entry;
    this.process = {
      runtime: options.runtime,
      // Every variable of `.env`, `.env.local`, `.env.[mode]`… not only `VITE_*`: the app is
      // server code. Existing process variables win, as in Vite. Vite restarts on changes.
      env: {
        ...(elsewhere
          ? loadEnv(config.mode, server, "")
          : config.envDir === false
            ? {}
            : loadEnv(config.mode, config.envDir, "")),
        ...options.env,
      },
      execArgv: options.execArgv,
      cwd: elsewhere ? server : undefined,
    };
    this.shutdownTimeout = options.shutdownTimeout;
    this.watching = options.watch !== false;
    this.workerEntry = fileURLToPath(
      new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.mjs", import.meta.url),
    );
    this.autoRoutes = options.routes === "auto";
    this.routes = options.routes === "auto" ? [] : normalizeRoutes(options.routes);

    const patterns = [
      `${normalizePath(dirname(entry))}/**`,
      ...(options.watch || []).map((pattern) => {
        const path = normalizePath(resolve(config.root, pattern));
        return /[*?{[]/.test(path) || /\.[^/]+$/.test(path) ? path : `${path}/**`;
      }),
    ];
    this.matchesWatch = createFilter(patterns, ["**/node_modules/**", "**/.git/**"], {
      resolve: false,
    });
    this.watchRoots = patterns.map((pattern) => pattern.split(/[*?{[]/, 1)[0]!.replace(/\/$/, ""));
  }

  matches(url: string): boolean {
    return matchesRoutes(this.routes, new URL(url, "http://localhost").pathname);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Requests arriving mid-restart wait for the replacement.
    await this.task;

    let response: Response;
    if (this.disposed || !this.backend.ready) {
      response = new Response("cyrenex: the server is unavailable", { status: 503 });
    } else {
      try {
        response = await this.backend.fetch(new NodeRequest({ req, res }));
      } catch (error) {
        this.logger.error(this.formatError(error), { timestamp: true });
        response = new Response("cyrenex: the server request failed", { status: 502 });
      }
    }
    await sendNodeResponse(res, response);
  }

  override async listen(server: ViteDevServer): Promise<void> {
    await super.listen(server);

    const onFile = (event: string, file: string): void => {
      if (!["add", "change", "unlink"].includes(event)) return;
      const path = normalizePath(file);
      if (!this.matchesWatch(path) && !this.moduleGraph.getModulesByFile(path)?.size) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.restart(), 100);
    };

    // Only own business upgrades; Vite handles its own HMR protocol.
    const upgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((value) => value.trim());
      if (
        protocols.includes("vite-hmr") ||
        protocols.includes("vite-ping") ||
        !this.matches(req.url ?? "/")
      ) {
        return;
      }

      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));

      void this.task
        .then(() => {
          if (!socket.destroyed && !this.disposed && this.backend.ready) {
            this.backend.upgrade({ node: { req, socket, head } });
          } else {
            socket.destroy();
          }
        })
        .catch(() => socket.destroy());
    };

    if (this.watching) {
      server.watcher.add(this.watchRoots);
      server.watcher.on("all", onFile);
    }
    server.httpServer?.on("upgrade", upgrade);

    // Pages opened after a failed start still get the overlay.
    this.client = server.ws;
    const onConnection = (): void => {
      if (this.failure) server.ws.send({ type: "error", err: this.failure });
    };
    server.ws.on("connection", onConnection);

    this.cleanup = () => {
      server.watcher.off("all", onFile);
      server.httpServer?.off("upgrade", upgrade);
      server.ws.off("connection", onConnection);
    };

    this.restart(true);
    await this.task;
  }

  private restart(initial = false): void {
    if (this.disposed) return;

    this.task = this.task.then(async () => {
      if (this.disposed) return;

      for (const socket of this.sockets) socket.destroy();
      this.moduleGraph.invalidateAll();

      try {
        // Graceful shutdown closes the server and disposes the Pond in the old process.
        await this.currentRunner?.shutdown(this.shutdownTimeout);
        if (this.disposed) return;

        const runner = new RuntimeProcessRunner(
          this.workerEntry,
          { entry: this.entry, environment: this.name },
          this.process,
        );
        this.currentRunner = runner;
        if (this.autoRoutes) runner.onMessage((message) => this.adoptRoutes(message));
        await this.backend.reload(this.currentRunner);
        await this.currentRunner.waitForReady();

        const entry = normalizePath(relative(this.config.root, this.entry));
        this.logger.info(
          `${this.process.runtime} server ${initial ? "started" : "restarted"}. ${entry}`,
          {
            timestamp: true,
          },
        );
        if (this.failure) {
          // Dismiss the overlay; the page reloads against the working app.
          this.failure = undefined;
          this.client?.send({ type: "full-reload", path: "*" });
        } else if (!initial) {
          // Let pages refetch or reconnect: `import.meta.hot.on("cyrenex:restart", …)`.
          const data: RestartEvent = { runtime: this.process.runtime };
          this.client?.send(RESTART_EVENT, data);
        }
      } catch (error) {
        await this.currentRunner?.close();
        const message = this.formatError(error);
        this.logger.error(message, { timestamp: true });
        this.fail(message);
      }
    });
  }

  /** `routes: "auto"`: forward what the app that just started defines. */
  private adoptRoutes(message: unknown): void {
    const ready = message as Partial<WorkerReadyMessage> | undefined;
    if (!ready?.address || !Array.isArray(ready.paths)) return;
    const { prefixes, skipped } = prefixesOf(ready.paths);
    if (prefixes.join() !== this.routes.join()) {
      this.logger.info(`forwarding ${prefixes.join(", ") || "nothing"}`, { timestamp: true });
    }
    this.routes = prefixes;
    // Warn once per change, not on every restart.
    const skippedKey = skipped.join();
    if (skippedKey === this.skipped) return;
    this.skipped = skippedKey;
    if (skipped.length) {
      this.logger.warn(
        `routes: "auto" cannot forward ${skipped.join(", ")}; they would shadow the frontend. ` +
          "Move them under a prefix or list routes explicitly.",
        { timestamp: true },
      );
    }
  }

  /** Show a startup failure in Vite's error overlay. */
  private fail(text: string): void {
    // Worker failures arrive as a stack: the first line is the message.
    const [message = text, ...stack] = text.split("\n");
    this.failure = {
      message,
      stack: stack.join("\n"),
      id: normalizePath(relative(this.config.root, this.entry)),
      plugin: "cyrenex",
    };
    this.client?.send({ type: "error", err: this.failure });
  }

  private formatError(error: unknown): string {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const message = cause instanceof Error ? cause.message : String(cause);
    const root = `${normalizePath(this.config.root)}/`;
    return message
      .replaceAll(`file:///${root}`, "./")
      .replaceAll(root, "./")
      .replaceAll(root.replaceAll("/", "\\"), ".\\");
  }

  override async close(): Promise<void> {
    this.disposed = true;
    clearTimeout(this.timer);
    this.cleanup?.();
    for (const socket of this.sockets) socket.destroy();
    await this.backend.shutdown(this.shutdownTimeout);
    await this.task;
    await super.close();
  }
}
