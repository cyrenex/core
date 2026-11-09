import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { connect, createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { relative, resolve } from "node:path";

import { normalizePath } from "vite";
import type { Logger, Plugin } from "vite";

import { serverBuildOf } from "./build.ts";
import { executableOf } from "./process.ts";
import type { ResolvedOptions } from "./types.ts";

const HOST = "127.0.0.1";

async function freePort(): Promise<number> {
  const server = createServer().listen(0, HOST);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Resolves once something accepts connections on `port`. */
async function waitForPort(port: number, child: ChildProcess, deadline: number): Promise<void> {
  for (;;) {
    if (child.exitCode !== null) throw new Error(`exited with code ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error(`did not listen on PORT=${port} in time`);
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, HOST, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Forward a request to the built server, streaming both ways. */
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

/** Replay a WebSocket upgrade to the built server and splice the sockets. */
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

function start(main: string, root: string, options: ResolvedOptions, logger: Logger) {
  let child: ChildProcess | undefined;
  const ready = (async () => {
    const port = await freePort();
    child = spawn(executableOf(options.runtime), [main], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST },
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitForPort(port, child, Date.now() + 15_000);
    return port;
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
 * `vp preview`: run the built server (`dist/server/main.mjs`) with the configured runtime and
 * forward every request and WebSocket to it. The server hosts the client build itself, as in
 * production, so the preview shows exactly what a deployment serves.
 */
export function previewPlugin(options: ResolvedOptions): Plugin {
  return {
    name: "cyrenex:preview",

    configurePreviewServer(server) {
      const { root, logger } = server.config;
      const build = serverBuildOf(options, root);
      if (!build) return;
      const main = resolve(root, build.outDir, "main.mjs");
      if (!existsSync(main)) {
        logger.warn(
          `cyrenex: ${normalizePath(relative(root, main))} is missing; run vp build to preview ` +
            "the server. Serving the client build only.",
        );
        return;
      }

      const { ready, kill, stop } = start(main, root, options, logger);

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
