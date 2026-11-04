// Runs inside the Node.js / Bun child process. Loads the app through Vite's ModuleRunner and
// listens on a random internal port that the dev server forwards to.
import type { Socket } from "node:net";

import { createViteTransport } from "env-runner/vite";
import { createNodeImportMeta, ModuleRunner } from "vite/module-runner";

import { stopApp } from "../stop.ts";
import { warmup } from "../warmup.ts";
import type {
  AppModule,
  WorkerControlMessage,
  WorkerData,
  WorkerInitMessage,
  WorkerServer,
} from "./types.ts";

const send = (message: unknown): void => {
  if (process.connected) process.send?.(message);
};

// env-runner's process runners deliver bootstrap data through IPC.
const init = Promise.withResolvers<WorkerData>();
const onInit = (message: WorkerInitMessage): void => {
  if (message.event !== "init-data") return;
  process.off("message", onInit);
  init.resolve(JSON.parse(message.data!) as WorkerData);
};
process.on("message", onInit);
send({ event: "request-init-data" });
const data = await init.promise;

const runner = new ModuleRunner({
  // File changes replace the whole process; module HMR must not mutate the running app.
  hmr: false,
  createImportMeta: createNodeImportMeta,
  transport: createViteTransport(
    send,
    (listener) => process.on("message", listener),
    data.environment,
  ),
});

let app: AppModule["default"] | undefined;
let server: WorkerServer | undefined;
let stopping = false;
const connections = new Set<Socket>();

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    // @elysia/node does not forward the force flag, so close its sockets explicitly.
    for (const socket of connections) socket.destroy();
    // Runs onStop hooks, which dispose the Pond.
    if (app) await stopApp(app, server);
    await runner.close();
    send({ event: "exit" });
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.on("message", (message: WorkerControlMessage) => {
  if (message.event === "shutdown") void stop();
});

try {
  app = (await runner.import<AppModule>(data.entry)).default;

  if (!app || typeof app.listen !== "function" || typeof app.fetch !== "function") {
    throw new TypeError("cyrenex: entry must default-export an Elysia app.");
  }
  if (app.server) {
    throw new Error("cyrenex: export the app without calling .listen().");
  }

  // Async plugins must finish registering routes before the listener starts.
  await app.modules;
  // `eager` singletons from pondi(): fail startup here, not on the first request.
  await warmup(app);

  const listening = Promise.withResolvers<WorkerServer>();
  app.listen({ port: 0, hostname: "127.0.0.1" }, (value) => {
    listening.resolve(value as unknown as WorkerServer);
  });
  server = await listening.promise;
  await server.raw?.ready();

  server.raw?.node?.server?.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });

  const address = server.raw?.node?.server?.address();
  const port = address && typeof address === "object" ? address.port : server.port;
  if (!port) throw new Error("cyrenex: Elysia did not report a listening port.");

  send({ address: { host: "127.0.0.1", port } });
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Flush the failure over IPC before exiting; the dev server formats and logs it.
  if (process.connected) {
    process.send?.({ event: "init-error", error: message }, () => process.exit(1));
  } else {
    process.exit(1);
  }
}
