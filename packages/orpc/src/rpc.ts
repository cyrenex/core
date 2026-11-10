import type { AnyRouter, Context } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ripple } from "cyrenex";
import type { Pond, TokenInput } from "cyrenex";
import {
  assertEager,
  attach,
  current,
  exposeErrorsDefault,
  release,
  releaseAfter,
  scopeOf,
} from "cyrenex/adapter";

import { EXPOSE, RequestContext } from "./inject.ts";
import type { PondiContext } from "./inject.ts";

/** What `rpc()` needs from an oRPC fetch handler: `RPCHandler`, `OpenAPIHandler`… */
export interface FetchHandlerLike {
  handle(
    request: Request,
    options: { prefix?: `/${string}`; context: () => PondiContext },
  ): Promise<{ matched: boolean; response?: Response | undefined }>;
}

export interface RpcOptions<TRouter extends AnyRouter> {
  /**
   * URL prefix the procedures are served under; the client's `url` must match.
   * @default "/rpc"
   */
  prefix?: `/${string}`;

  /**
   * The oRPC handler serving the router.
   * @default (router) => new RPCHandler(router)
   */
  handler?: (router: TRouter) => FetchHandlerLike;

  /**
   * Singletons to create before the app starts listening, so failures (a database refusing
   * connections, a missing provider, a cycle) fail startup instead of the first request.
   */
  eager?: readonly TokenInput[];

  /**
   * Include the code, message and dependency path of a `PondError` in error responses. When
   * hidden, the error is logged and the client gets a plain `INTERNAL_SERVER_ERROR`.
   * @default process.env.NODE_ENV !== "production"
   */
  exposeErrors?: boolean;
}

/** An oRPC router served over fetch, with a Pond: start it, test it, mount it. */
export interface RpcApp<TRouter extends AnyRouter> {
  /** The router, for typed clients: `RouterClient<App["router"]>`. */
  readonly router: TRouter;
  /** The prefix, as a route, for `routes: "auto"` of `cyrenex/vite`. */
  readonly routes: readonly { path: string }[];
  /** Answer a request; `404` when no procedure matches. */
  fetch(request: Request): Promise<Response>;
  /** Answer a request, or `undefined` when no procedure matches: to mount in another app. */
  handle(request: Request): Promise<Response | undefined>;
}

/**
 * Serve an oRPC router with a Pond:
 *
 * ```ts
 * // server/app.ts
 * export default rpc(router, pond, { eager: [Db] });
 * ```
 *
 * - Each request gets its own `pond.fork()` in `context.pond`, disposed once the response
 *   has been sent, so streamed outputs keep their scoped values until they end.
 * - `start` (from `@cyrenex/orpc` or `cyrenex/start`) creates the `eager` singletons before
 *   listening and disposes the Pond on stop; `override` from `cyrenex/testing` swaps providers.
 */
export function rpc<TRouter extends AnyRouter>(
  router: TRouter,
  pond: Pond,
  options: RpcOptions<TRouter> = {},
): RpcApp<TRouter> {
  assertEager(options.eager ?? []);
  const prefix = options.prefix ?? "/rpc";
  const expose = options.exposeErrors ?? exposeErrorsDefault();
  const handler =
    options.handler?.(router) ??
    (new RPCHandler(router as AnyRouter & Context) as FetchHandlerLike);

  const handle = async (request: Request): Promise<Response | undefined> => {
    // Called once the prefix matches: the request's fork, with the request in it.
    const context = (): PondiContext => {
      const scope = scopeOf(request, current(attached.handle), (fork) => {
        fork.use(ripple(RequestContext, () => ({ request }), { mode: "scoped" }));
      });
      return { pond: scope, [EXPOSE]: expose } as PondiContext;
    };
    let result: Awaited<ReturnType<FetchHandlerLike["handle"]>>;
    try {
      result = await handler.handle(request, { prefix, context });
    } catch (error) {
      await release(request);
      throw error;
    }
    if (!result.matched || !result.response) {
      await release(request);
      return undefined;
    }
    return releaseAfter(request, result.response);
  };

  const app: RpcApp<TRouter> = {
    router,
    routes: [{ path: prefix }],
    handle,
    async fetch(request) {
      return (await handle(request)) ?? new Response("Not Found", { status: 404 });
    },
  };
  const attached = attach(app, pond, options);
  return app;
}
