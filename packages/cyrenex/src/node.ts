import { node as elysiaNode } from "@elysia/node";
import type { AnyElysia, ElysiaAdapter } from "elysia";

interface NodeServer {
  stop(): Promise<void> | void;
  /** The underlying srvx server. */
  raw?: { close?(closeActiveConnections?: boolean): Promise<void> };
}

/**
 * The Elysia adapter for Node.js: `@elysia/node` (install it yourself) with a working `app.stop()`.
 *
 * The upstream adapter never sets `app.server` and has no `stop`, so `app.stop()` throws and
 * `onStop` hooks (including `pond.dispose()`) never run. This adapter fixes both.
 *
 * ```ts
 * import { node } from "cyrenex/node";
 *
 * export default new Elysia({ adapter: node() }).use(pondi(pond));
 * ```
 */
export function node(): ElysiaAdapter {
  const base = elysiaNode();
  return {
    ...base,
    listen(app) {
      const listen = base.listen(app);
      return (options, callback) =>
        listen(options, (server) => {
          (app as { server: unknown }).server = server;
          void callback?.(server);
        });
    },
    async stop(app: AnyElysia, closeActiveConnections?: boolean) {
      const server = app.server as unknown as NodeServer | null;
      if (!server) {
        throw new Error("Elysia isn't running. Call `app.listen` to start the server.");
      }
      if (closeActiveConnections && server.raw?.close) await server.raw.close(true);
      else await server.stop();
      (app as { server: unknown }).server = null;
      for (const hook of app.event.stop ?? []) await hook.fn(app);
    },
  };
}
