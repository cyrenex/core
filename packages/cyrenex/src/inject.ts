import { pebble, PondError, ripple } from "@cyrenex/pondi";
import type { Pond, TokenInput, Value } from "@cyrenex/pondi";
import { Elysia } from "elysia";
import type { AnyElysia, Context } from "elysia";

import { WARMUP } from "./warmup.ts";

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
export const RequestContext = pebble<Context>("cyrenex:request");

/** Request containers, created lazily the first time a route injects something. */
const scopes = new WeakMap<Request, Pond>();

const keyOf = (token: TokenInput) => (typeof token === "string" ? token : token.key);

interface PondContext {
  request: Request;
  pond?: Pond;
}

function scopeOf(ctx: PondContext): Pond {
  let scope = scopes.get(ctx.request);
  if (scope) return scope;
  if (!ctx.pond) {
    throw new Error(
      "cyrenex: inject() requires a Pond on the app. Add it with app.use(pondi(pond)).",
    );
  }
  scope = ctx.pond
    .fork()
    .use(ripple(RequestContext, () => ctx as unknown as Context, { mode: "scoped" }));
  scopes.set(ctx.request, scope);
  return scope;
}

async function release(request: Request | undefined): Promise<void> {
  const scope = request && scopes.get(request);
  if (!scope) return;
  scopes.delete(request);
  await scope.dispose();
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
   * Awaited by the dev server; in production entries, `await warmup(app)` before listening.
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
 * - `eager` singletons are created before the app listens; see {@link warmup}.
 */
export function pondi(pond: Pond, options: PondiOptions = {}) {
  const expose = options.exposeErrors ?? process.env.NODE_ENV !== "production";
  const eager = options.eager ?? [];
  for (const token of eager) {
    const mode = typeof token === "object" ? (token as { mode?: string }).mode : undefined;
    if (mode && mode !== "singleton") {
      throw new TypeError(
        `cyrenex: eager "${keyOf(token)}" is ${mode}; only singletons can be created at startup`,
      );
    }
  }

  let warming: Promise<void> | undefined;
  const warm = () =>
    (warming ??= (async () => {
      try {
        await Promise.all(eager.map((token) => pond.resolve(token)));
      } catch (error) {
        await pond.dispose().catch(() => {});
        throw error;
      }
    })());

  return (app: AnyElysia): PondiPlugin => {
    const webSocketPaths = new Set<string>();
    let seenRoutes = -1;
    Object.defineProperty(app, WARMUP, { value: warm, configurable: true });

    return app
      .decorate("pond", pond)
      .onStart(() => {
        // Fallback for apps that call .listen() themselves; it cannot be awaited here.
        if (!warming) warm().catch((error: unknown) => console.error(error));
      })
      .onRequest(() => {
        // Routes are final by the time requests arrive; re-scan only if more were added.
        if (app.routes.length === seenRoutes) return;
        seenRoutes = app.routes.length;
        adoptWebSockets(app, webSocketPaths);
      })
      .onAfterResponse({ as: "global" }, async ({ request, route }) => {
        // An upgraded connection keeps its scope until the WebSocket closes.
        if (isWebSocketUpgrade(request) && webSocketPaths.has(route)) return;
        await release(request);
      })
      .onError({ as: "global" }, ({ error, set }) => {
        if (!(error instanceof PondError)) return;
        set.status = 500;
        if (expose) {
          return { error: error.name, code: error.code, message: error.message, path: error.path };
        }
        console.error(error);
        return { error: "Internal Server Error" };
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
