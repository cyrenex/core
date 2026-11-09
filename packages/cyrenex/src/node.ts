import { node as elysiaNode } from "@elysia/node";
import type { AnyElysia, ElysiaAdapter } from "elysia";

interface NodeServer {
  stop(): Promise<void> | void;
  /** The underlying srvx server. */
  raw?: { close?(closeActiveConnections?: boolean): Promise<void> };
}

/**
 * Upstream sets `transfer-encoding: chunked` on file responses, and srvx then adds the file's
 * `content-length`: HTTP/1.1 forbids both, so strict clients (Node's fetch) and some proxies
 * reject the response. Node's http module chunks bodies of unknown length by itself, so the
 * header is never needed. Runs as srvx middleware to see every response, including the ones
 * plugins such as `@elysia/static` precompute on their own Elysia instance.
 */
async function dropTransferEncoding(_: Request, next: () => unknown): Promise<Response> {
  const response = (await next()) as Response;
  if (!response.headers.has("transfer-encoding")) return response;
  try {
    response.headers.delete("transfer-encoding");
    return response;
  } catch {
    // Immutable headers, e.g. a fetch() response returned as is.
    const headers = new Headers(response.headers);
    headers.delete("transfer-encoding");
    const { status, statusText } = response;
    return new Response(response.body, { status, statusText, headers });
  }
}

type ListenOptions = Parameters<ReturnType<ElysiaAdapter["listen"]>>[0];

/** `@elysia/node` passes object options through to srvx; add the middleware there. */
function withMiddleware(options: ListenOptions): ListenOptions {
  const object = typeof options === "object" ? options : { port: Number(options) };
  const middleware = (object as { middleware?: unknown[] }).middleware ?? [];
  return { ...object, middleware: [...middleware, dropTransferEncoding] } as ListenOptions;
}

/**
 * The Elysia adapter for Node.js: `@elysia/node` (install it yourself) with a working `app.stop()`.
 *
 * The upstream adapter never sets `app.server` and has no `stop`, so `app.stop()` throws and
 * `onStop` hooks (including `pond.dispose()`) never run. It also sends files with conflicting
 * length headers. This adapter fixes all three.
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
        listen(withMiddleware(options), (server) => {
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
