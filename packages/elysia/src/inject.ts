import { pebble, ripple } from "cyrenex";
import type { Pebble, Pond, TokenInput, Value } from "cyrenex";
import {
  assertEager,
  attach,
  current,
  describeError,
  exposeErrorsDefault,
  PondError,
  release,
  scopeOf as scopeFor,
} from "cyrenex/adapter";
import { Elysia } from "elysia";
import type { AnyElysia, Context } from "elysia";

/**
 * The current Elysia request context, available to `scoped` ripples:
 *
 * ```ts
 * const CurrentUser = ripple("user:current", [RequestContext], (ctx) => auth(ctx.headers), {
 *   mode: "scoped",
 * });
 * ```
 *
 * It is registered as `scoped` in every request container, so a singleton depending on it
 * fails with `CAPTIVE_DEPENDENCY` instead of silently caching request data.
 */
export const RequestContext: Pebble<Context> = pebble<Context>("cyrenex:request");

interface PondContext {
  request: Request;
  pond?: Pond;
}

/** The request's fork, created the first time a route injects something. */
function scopeOf(ctx: PondContext): Pond {
  if (!ctx.pond) {
    throw new Error(
      "cyrenex: inject() requires a Pond on the app. Add it with app.use(pondi(pond)).",
    );
  }
  return scopeFor(ctx.request, ctx.pond, (fork) => {
    fork.use(ripple(RequestContext, () => ctx as unknown as Context, { mode: "scoped" }));
  });
}

type WebSocketClose = (ws: { data: { request?: Request } }, ...rest: unknown[]) => unknown;

/** WebSocket options already wrapped, shared across apps. */
const adopted = new WeakSet<object>();

/**
 * Make each WebSocket route release its request scope when the connection closes, so scoped
 * values live as long as the connection. Elysia has no global close hook, but both the Bun and
 * Node adapters read `options.close` at close time, so wrapping it in place is enough.
 */
function adoptWebSockets(app: AnyElysia, paths: Set<string>): void {
  for (const route of app.routes) {
    const options = (route.hooks as { websocket?: { close?: WebSocketClose } } | undefined)
      ?.websocket;
    if (route.method !== "WS" || !options) continue;
    paths.add(route.path);
    if (adopted.has(options)) continue;
    adopted.add(options);
    const close = options.close;
    options.close = async (ws, ...rest) => {
      try {
        return await close?.(ws, ...rest);
      } finally {
        await release(ws.data.request);
      }
    };
  }
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/** `set.status` is a number or, when set by name, a status string such as "Unauthorized". */
function isSuccess(status: unknown): boolean {
  return status === undefined || (typeof status === "number" && status < 300);
}

export interface PondiOptions {
  /**
   * Include `code`, `message` and dependency `path` of a `PondError` in the 500 response.
   * When hidden, the error is logged and the response only says "Internal Server Error".
   * @default process.env.NODE_ENV !== "production"
   */
  exposeErrors?: boolean;

  /**
   * Singletons to create before the app starts listening, so failures (a database refusing
   * connections, a missing provider, a cycle) fail startup instead of the first request.
   * Awaited by `start()`; with your own listener, `await warmup(app)` before listening.
   */
  eager?: readonly TokenInput[];
}

type PondiPlugin = Elysia<"", { decorator: { pond: Pond }; store: {}; derive: {}; resolve: {} }>;

/**
 * Attach a Pond to the app. Use it on the root app, before the routes:
 *
 * ```ts
 * export default new Elysia().use(pondi(pond)).use(userRoutes);
 * ```
 *
 * - Each request that injects something gets its own `pond.fork()`, disposed after the
 *   response; for WebSocket routes, when the connection closes.
 * - `pond.dispose()` runs on `app.stop()`, including every dev-server restart.
 * - A `PondError` becomes a 500 response describing the failing dependency path.
 * - `eager` singletons are created before the app listens (`start()`, or `warmup(app)`).
 */
export function pondi(pond: Pond, options: PondiOptions = {}) {
  const expose = options.exposeErrors ?? exposeErrorsDefault();
  assertEager(options.eager ?? []);

  return (app: AnyElysia): PondiPlugin => {
    const webSocketPaths = new Set<string>();
    let seenRoutes = -1;
    const attached = attach(app, pond, options);

    return app
      .decorate("pond", pond)
      .onStart(() => {
        // Fallback for apps that call .listen() themselves; it cannot be awaited here.
        if (!attached.warming) attached.warm().catch((error: unknown) => console.error(error));
      })
      .onRequest((ctx) => {
        // `cyrenex/testing`: requests see the overriding fork while one is active.
        if (attached.handle.override) (ctx as { pond?: Pond }).pond = current(attached.handle);
        // Routes are final by the time requests arrive; re-scan only if more were added.
        if (app.routes.length === seenRoutes) return;
        seenRoutes = app.routes.length;
        adoptWebSockets(app, webSocketPaths);
      })
      .onAfterResponse({ as: "global" }, async ({ request, route, set }) => {
        // An upgraded connection keeps its scope until the WebSocket closes; a rejected
        // upgrade (an error status from a hook or the handler) never opens, so release now.
        if (isWebSocketUpgrade(request) && webSocketPaths.has(route) && isSuccess(set.status)) {
          return;
        }
        await release(request);
      })
      .onError({ as: "global" }, ({ error, set }) => {
        if (!(error instanceof PondError)) return;
        set.status = 500;
        return describeError(error, expose);
      })
      .onStop(async () => {
        await pond.dispose();
      }) as unknown as PondiPlugin;
  };
}

export type Injected<T extends Record<string, TokenInput>> = {
  -readonly [K in keyof T]: Value<T[K]>;
};

/**
 * Resolve tokens from the request container into the handler context.
 *
 * ```ts
 * new Elysia()
 *   .use(inject({ users: UserService, me: CurrentUser }))
 *   .get("/me", ({ users, me }) => users.find(me.id));
 * ```
 *
 * In WebSocket routes the values are on `ws.data` and live until the connection closes.
 */
export function inject<const T extends Record<string, TokenInput>>(tokens: T) {
  const entries = Object.entries(tokens);
  return new Elysia().resolve({ as: "scoped" }, async (ctx) => {
    const scope = scopeOf(ctx as PondContext);
    const values = await Promise.all(entries.map(([, token]) => scope.resolve(token)));
    return Object.fromEntries(entries.map(([key], i) => [key, values[i]])) as Injected<T>;
  });
}
