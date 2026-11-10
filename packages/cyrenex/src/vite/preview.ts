import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { dirname, relative, resolve } from "node:path";

import { normalizePath } from "vite";
import type { Logger, Plugin } from "vite";

import { IPC_ENV, LISTENING_EVENT } from "../host.ts";
import type { ListeningMessage } from "../host.ts";
import { serverBuildOf } from "./build.ts";
import { locate, packageDirOf } from "./packages.ts";
import { freePort, waitForPort } from "./ports.ts";
import { executableOf } from "./process.ts";
import type { ResolvedOptions } from "./types.ts";

const HOST = "127.0.0.1";

/** Forward a request to the server, streaming both ways. */
function forward(port: number, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    { host: HOST, port, method: req.method, path: req.url, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders);
      response.pipe(res);
    },
  );
  upstream.once("error", () => {
    if (res.headersSent) return void res.destroy();
    res.statusCode = 502;
    res.end("cyrenex preview: the server is unavailable");
  });
  req.pipe(upstream);
}

/** Replay a WebSocket upgrade to the server and splice the sockets. */
function forwardUpgrade(port: number, req: IncomingMessage, socket: Socket, head: Buffer): void {
  const upstream = connect(port, HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.once("error", () => socket.destroy());
  socket.once("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
}

function start(main: string, cwd: string, root: string, options: ResolvedOptions, logger: Logger) {
  let child: ChildProcess | undefined;
  const ready = (async () => {
    const port = await freePort(HOST);
    const spawned = spawn(executableOf(options.runtime), [main], {
      cwd,
      env: { ...process.env, PORT: String(port), HOST, [IPC_ENV]: "1" },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child = spawned;
    // start() reports its port over IPC; other servers are found by probing PORT.
    const reported = new Promise<number>((resolve) => {
      spawned.on("message", (message: Partial<ListeningMessage>) => {
        if (message?.event === LISTENING_EVENT && message.port) resolve(message.port);
      });
    });
    let done = false;
    void reported.then(() => (done = true));
    const exited = () =>
      done
        ? new Error("reported")
        : spawned.exitCode === null
          ? undefined
          : new Error(`exited with code ${spawned.exitCode}`);
    return Promise.race([
      reported,
      waitForPort(port, HOST, Date.now() + 15_000, exited).then(() => port),
    ]);
  })();
  ready.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`cyrenex: ${normalizePath(relative(root, main))} ${message}`, {
      timestamp: true,
    });
    child?.kill();
  });
  // Synchronous, so it also works from an `exit` handler.
  const kill = () => child?.kill();
  /** Kill the server and wait until it has exited. */
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child!.once("exit", resolve));
    child.kill();
    await exited;
  };
  return { ready, kill, stop };
}

/**
 * `vp preview`: run the server (`dist/server/main.mjs`, or the entry itself when it ships as
 * source) with the configured runtime and forward every request and WebSocket to it. The
 * server hosts the client build itself, as in production, so the preview shows exactly what a
 * deployment serves.
 */
export function previewPlugin(options: ResolvedOptions): Plugin {
  return {
    name: "cyrenex:preview",

    configurePreviewServer(server) {
      const { root, logger } = server.config;
      if (!options.build) return;
      const build = serverBuildOf(options, root);
      const main = build ? resolve(root, build.outDir, "main.mjs") : locate(root, options.server);
      if (!existsSync(main)) {
        if (build) {
          logger.warn(
            `cyrenex: ${normalizePath(relative(root, main))} is missing; run vp build to ` +
              "preview the server. Serving the client build only.",
          );
        }
        return;
      }
      // A server shipped as source runs in its package, as it would in production.
      const cwd = build ? root : (packageDirOf(dirname(main)) ?? root);

      const { ready, kill, stop } = start(main, cwd, root, options, logger);

      // Before Vite's static middlewares; if the server failed to start, they serve the client.
      server.middlewares.use((req, res, next) => {
        ready.then(
          (port) => forward(port, req, res),
          () => next(),
        );
      });
      server.httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
        ready.then(
          (port) => forwardUpgrade(port, req, socket, head),
          () => socket.destroy(),
        );
      });

      // close() resolves once the server process is gone, not just signalled.
      const close = server.close.bind(server);
      server.close = async () => {
        await Promise.all([close(), stop()]);
        process.off("exit", kill);
      };
      server.httpServer.once("close", kill);
      process.once("exit", kill);
    },
  };
}
