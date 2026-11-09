// Runs inside the Node.js / Bun child process. Loads the app through Vite's ModuleRunner and
// listens on a random internal port that the dev server forwards to.
import { createViteTransport } from "env-runner/vite";
import { createNodeImportMeta, ModuleRunner } from "vite/module-runner";

import { elysia } from "./elysia.ts";
import type {
  ServerAdapter,
  ServerHandle,
  WorkerControlMessage,
  WorkerData,
  WorkerInitMessage,
  WorkerReadyMessage,
} from "./types.ts";

const HOST = "127.0.0.1";
const adapter: ServerAdapter = elysia;

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

let handle: ServerHandle | undefined;
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await handle?.close();
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
  const entry = await runner.import<{ default?: unknown }>(data.entry);
  handle = adapter(entry.default);
  const { port, paths } = await handle.listen({ hostname: HOST });
  send({ address: { host: HOST, port }, paths } satisfies WorkerReadyMessage);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Flush the failure over IPC before exiting; the dev server formats and logs it.
  if (process.connected) {
    process.send?.({ event: "init-error", error: message }, () => process.exit(1));
  } else {
    process.exit(1);
  }
}
