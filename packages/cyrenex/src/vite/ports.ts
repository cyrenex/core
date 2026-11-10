// Port helpers shared by the dev worker and `vp preview`; no Vite imports, as the worker loads
// this file in the app's process.
import { connect, createServer } from "node:net";
import type { AddressInfo } from "node:net";

/** A port nothing listens on right now. */
export async function freePort(host: string): Promise<number> {
  const server = createServer().listen(0, host);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Whether something accepts connections on `port`. */
export function isOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * Resolves once something accepts connections on `port`, for servers that do not report
 * their port. Rejects at `deadline`, or as soon as `failed()` returns an error.
 */
export async function waitForPort(
  port: number,
  host: string,
  deadline: number,
  failed: () => Error | undefined = () => undefined,
): Promise<void> {
  for (;;) {
    const error = failed();
    if (error) throw error;
    if (await isOpen(port, host)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `did not listen on PORT=${port} in time; start the app with start() from ` +
          `"cyrenex/start", or listen on process.env.PORT`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
