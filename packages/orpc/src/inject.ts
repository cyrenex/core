import { os, ORPCError } from "@orpc/server";
import { pebble } from "cyrenex";
import type { Pebble, Pond, TokenInput, Value } from "cyrenex";
import { describeError, exposeErrorsDefault, PondError } from "cyrenex/adapter";

/** Whether `PondError` details go into error responses; set by `rpc()` on the context. */
export const EXPOSE: unique symbol = Symbol.for("cyrenex.orpc.expose") as never;

/**
 * The initial context of procedures using {@link inject}: the request's container. `rpc()`
 * provides it for every request; outside HTTP, pass a fork of your Pond yourself:
 *
 * ```ts
 * const client = createRouterClient(router, { context: { pond: pond.fork() } });
 * ```
 */
export interface PondiContext {
  pond: Pond;
}

/**
 * The current request, available to `scoped` ripples:
 *
 * ```ts
 * const CurrentUser = ripple("user:current", [RequestContext], (ctx) => auth(ctx.request), {
 *   mode: "scoped",
 * });
 * ```
 *
 * It is registered as `scoped` in every request container, so a singleton depending on it
 * fails with `CAPTIVE_DEPENDENCY` instead of silently caching request data.
 */
export const RequestContext: Pebble<{ request: Request }> = pebble<{ request: Request }>(
  "cyrenex:orpc:request",
);

export type Injected<T extends Record<string, TokenInput>> = {
  -readonly [K in keyof T]: Value<T[K]>;
};

/** A `PondError` as an oRPC error the client can read: code and dependency path in `data`. */
function toORPCError(error: PondError, expose: boolean): ORPCError<"INTERNAL_SERVER_ERROR", any> {
  const body = describeError(error, expose);
  if (!expose) return new ORPCError("INTERNAL_SERVER_ERROR", { cause: error });
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: error.message,
    data: { code: body.code, path: body.path },
    cause: error,
  });
}

/**
 * Resolve tokens from the request's container into the procedure context:
 *
 * ```ts
 * const base = os.$context<PondiContext>();
 *
 * export const router = {
 *   users: base.use(inject({ users: UserService })).handler(({ context }) => context.users.list()),
 * };
 * ```
 *
 * A `PondError` (a missing provider, a cycle) becomes an `INTERNAL_SERVER_ERROR` carrying its
 * code and dependency path, unless details are hidden (production).
 */
export function inject<const T extends Record<string, TokenInput>>(tokens: T) {
  const entries = Object.entries(tokens);
  return os.$context<PondiContext>().middleware(async ({ context, next }) => {
    if (!context.pond) {
      throw new TypeError(
        "cyrenex: inject() requires a Pond in the context: serve the router with rpc(), or " +
          "pass { context: { pond } }.",
      );
    }
    let values: unknown[];
    try {
      values = await Promise.all(entries.map(([, token]) => context.pond.resolve(token)));
    } catch (error) {
      if (!(error instanceof PondError)) throw error;
      const expose = (context as { [EXPOSE]?: boolean })[EXPOSE] ?? exposeErrorsDefault();
      throw toORPCError(error, expose);
    }
    const injected = Object.fromEntries(entries.map(([key], i) => [key, values[i]]));
    return next({ context: injected as Injected<T> });
  });
}
