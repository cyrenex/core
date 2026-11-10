import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

import type { AnyElysia } from "elysia";

import type { Listen } from "cyrenex/start";
import { stopApp } from "./stop.ts";

/** What Bun and `@elysia/node` hand to the `listen` callback. */
interface ElysiaServer {
  /** Bound port reported directly by Bun; Node's actual port is read from `raw`. */
  port?: number;
  stop(force?: boolean): unknown;
  raw?: { ready?(): Promise<unknown>; node?: { server?: HttpServer } };
}

/**
 * Listen with Elysia's own adapter instead of a plain `fetch`, for WebSockets, `onStart` /
 * `onStop` hooks and `server` in handlers: the default of `start` from `@cyrenex/elysia`.
 * The client build answers requests no route matches.
 */
export const listen: Listen<AnyElysia> = async ({ app, port, hostname, assets }) => {
  if (app.server) throw new Error("cyrenex: export the app without calling .listen().");
  // Async plugins must finish registering routes before the listener starts.
  await app.modules;

  if (assets) {
    app.onError({ as: "global" }, async ({ code, request, set }) => {
      if (code !== "NOT_FOUND") return;
      const file = await assets(request);
      if (!file) return;
      // Errors thrown by a route keep `set.status`; unmatched requests keep the Response's.
      set.status = file.status;
      return file;
    });
  }

  const listening = Promise.withResolvers<ElysiaServer>();
  app.listen({ port, ...(hostname && { hostname }) }, (value) => {
    listening.resolve(value as unknown as ElysiaServer);
  });
  const server = await listening.promise;
  await server.raw?.ready?.();

  const http = server.raw?.node?.server;
  const connections = new Set<Socket>();
  http?.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });

  const address = http?.address();
  const bound = (typeof address === "object" && address?.port) || server.port;
  if (!bound) throw new Error("cyrenex: Elysia did not report a listening port.");

  return {
    port: bound,
    async close() {
      // @elysia/node does not forward the force flag, so close its sockets explicitly.
      for (const socket of connections) socket.destroy();
      // Runs the onStop hooks, which dispose the Pond.
      await stopApp(app, server);
    },
  };
};
