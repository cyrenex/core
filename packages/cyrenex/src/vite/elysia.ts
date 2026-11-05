// Elysia side of the dev worker: validates the entry's export, listens on an internal port and
// stops the app so its onStop hooks (and the Pond) run on every restart.
import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

import type { AnyElysia } from "elysia";

import { stopApp } from "../stop.ts";
import { warmup } from "../warmup.ts";
import type { ServerAdapter } from "./types.ts";

/** Listener information returned by the application's Elysia adapter. */
interface ElysiaServer {
  /** Bound port reported directly by Bun; Node's actual port is read from `raw`. */
  port: number;
  stop(force?: boolean): unknown;
  raw?: {
    ready(): Promise<unknown>;
    node?: {
      server?: HttpServer;
    };
  };
}

export const elysia: ServerAdapter = (exported) => {
  const app = exported as AnyElysia | undefined;
  if (!app || typeof app.listen !== "function" || typeof app.fetch !== "function") {
    throw new TypeError("cyrenex: entry must default-export an Elysia app.");
  }
  if (app.server) {
    throw new Error("cyrenex: export the app without calling .listen().");
  }

  let server: ElysiaServer | undefined;
  const connections = new Set<Socket>();

  return {
    async listen({ hostname }) {
      // Async plugins must finish registering routes before the listener starts.
      await app.modules;
      // `eager` singletons from pondi(): fail startup here, not on the first request.
      await warmup(app);

      const listening = Promise.withResolvers<ElysiaServer>();
      app.listen({ port: 0, hostname }, (value) => {
        listening.resolve(value as unknown as ElysiaServer);
      });
      server = await listening.promise;
      await server.raw?.ready();

      const http = server.raw?.node?.server;
      http?.on("connection", (socket) => {
        connections.add(socket);
        socket.once("close", () => connections.delete(socket));
      });

      const address = http?.address();
      const port = address && typeof address === "object" ? address.port : server.port;
      if (!port) throw new Error("cyrenex: Elysia did not report a listening port.");
      return { port };
    },

    async close() {
      // @elysia/node does not forward the force flag, so close its sockets explicitly.
      for (const socket of connections) socket.destroy();
      // Runs onStop hooks, which dispose the Pond, even if listening never finished.
      await stopApp(app, server);
    },
  };
};
