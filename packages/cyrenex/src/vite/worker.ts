// Runs inside the Node.js / Bun child process. Loads the server entry through Vite's
// ModuleRunner; the entry listens by itself (`start(app)`), and the dev server forwards to it.
import { createViteTransport } from "env-runner/vite";
import { createNodeImportMeta, ModuleRunner } from "vite/module-runner";

import { HOST } from "../host.ts";
import type { Host, Listening } from "../host.ts";
import { freePort, waitForPort } from "./ports.ts";
import type {
  WorkerControlMessage,
  WorkerData,
  WorkerInitMessage,
  WorkerReadyMessage,
} from "./types.ts";

const HOSTNAME = "127.0.0.1";

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

// `start()` reports to the host below. Entries listening by other means get a free PORT, and
// are found by probing it.
const fallbackPort = await freePort(HOSTNAME);
process.env.PORT = String(fallbackPort);
process.env.HOST = HOSTNAME;

const listening = Promise.withResolvers<Listening>();
const stops: (() => Promise<void>)[] = [];
const host: Host = {
  dev: true,
  port: 0,
  hostname: HOSTNAME,
  listening: (info) => listening.resolve(info),
  adopt: (stop) => void stops.push(stop),
};
(globalThis as { [HOST]?: Host })[HOST] = host;

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

let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    // Closes the server and disposes the Pond, even if listening never finished.
    for (const close of stops) await close();
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
  // `await start(app)` reports before the import settles. An entry that loaded without
  // reporting listens by other means (or not at all): wait for PORT.
  let reported = false;
  void listening.promise.then(() => (reported = true));
  const probe = async (): Promise<Listening> => {
    const settled = () => (reported ? new Error("reported") : undefined);
    await waitForPort(fallbackPort, HOSTNAME, Date.now() + 15_000, settled);
    return { port: fallbackPort, paths: [] };
  };
  const loaded = runner.import(data.entry).then(() => Promise.race([listening.promise, probe()]));
  const info = await Promise.race([listening.promise, loaded]);
  send({
    address: { host: HOSTNAME, port: info.port },
    paths: info.paths,
  } satisfies WorkerReadyMessage);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Flush the failure over IPC before exiting; the dev server formats and logs it.
  if (process.connected) {
    process.send?.({ event: "init-error", error: message }, () => process.exit(1));
  } else {
    process.exit(1);
  }
}
