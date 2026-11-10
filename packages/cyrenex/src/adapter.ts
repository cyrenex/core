// Building blocks for framework adapters (`@cyrenex/elysia`, …): attach a Pond to an app, give
// each request its own fork, and describe DI errors. Framework-free.
import { PondError } from "@cyrenex/pondi";
import type { Pond, TokenInput } from "@cyrenex/pondi";

import { POND, WARMUP } from "./lifecycle.ts";
import type { PondHandle } from "./lifecycle.ts";

export { pondOf } from "./lifecycle.ts";
export type { PondHandle } from "./lifecycle.ts";

export interface AttachOptions {
  /**
   * Singletons to create before the app starts listening, so failures (a database refusing
   * connections, a missing provider, a cycle) fail startup instead of the first request.
   * Awaited by `start()`; with your own listener, `await warmup(app)` before listening.
   */
  eager?: readonly TokenInput[];
}

export interface Attached {
  /** Where requests resolve from; `override()` from `cyrenex/testing` swaps `override`. */
  readonly handle: PondHandle;
  /** Create the `eager` singletons, once; on failure the Pond is disposed. */
  warm(): Promise<void>;
  /** Whether `warm()` was called. */
  readonly warming: boolean;
}

export const keyOf = (token: TokenInput): string => (typeof token === "string" ? token : token.key);

/** Throws for `eager` tokens that are not singletons; call it when the adapter is created. */
export function assertEager(eager: readonly TokenInput[]): void {
  for (const token of eager) {
    const mode = typeof token === "object" ? (token as { mode?: string }).mode : undefined;
    if (mode && mode !== "singleton") {
      throw new TypeError(
        `cyrenex: eager "${keyOf(token)}" is ${mode}; only singletons can be created at startup`,
      );
    }
  }
}

/**
 * Attach `pond` to `app`, where `start()`, `warmup()`, `dispose()` and `cyrenex/testing` find
 * it. Throws for `eager` tokens that are not singletons.
 */
export function attach(app: object, pond: Pond, options: AttachOptions = {}): Attached {
  const eager = options.eager ?? [];
  assertEager(eager);

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

  const handle: PondHandle = { root: pond, override: undefined };
  Object.defineProperty(app, WARMUP, { value: warm, configurable: true });
  Object.defineProperty(app, POND, { value: handle, configurable: true });
  return {
    handle,
    warm,
    get warming() {
      return warming !== undefined;
    },
  };
}

/** The Pond requests resolve from: the override of `cyrenex/testing` while one is active. */
export const current = (handle: PondHandle): Pond => handle.override ?? handle.root;

/**
 * Request containers, keyed by request. Registered globally, so adapters of different
 * frameworks (an oRPC handler mounted in a Hono app) share one scope per request.
 */
const SCOPES = Symbol.for("cyrenex.scopes");
const scopes: WeakMap<Request, Pond> = ((globalThis as { [SCOPES]?: WeakMap<Request, Pond> })[
  SCOPES
] ??= new WeakMap());

/**
 * The request's own fork of `pond`, created on first use. `setup` registers request-bound
 * providers (the framework's request context) on a new fork.
 */
export function scopeOf(request: Request, pond: Pond, setup?: (fork: Pond) => void): Pond {
  let scope = scopes.get(request);
  if (scope) return scope;
  scope = pond.fork();
  setup?.(scope);
  scopes.set(request, scope);
  return scope;
}

/** Dispose the request's fork, if it has one. */
export async function release(request: Request | undefined): Promise<void> {
  const scope = request && scopes.get(request);
  if (!scope) return;
  scopes.delete(request);
  await scope.dispose();
}

/** Whether `PondError` details go into responses. */
export const exposeErrorsDefault = (): boolean => process.env.NODE_ENV !== "production";

/**
 * The response body for a `PondError`: its code, message and dependency path when `expose`,
 * else a generic message (the error is logged instead).
 */
export function describeError(error: PondError, expose: boolean): Record<string, unknown> {
  if (expose) {
    return { error: error.name, code: error.code, message: error.message, path: error.path };
  }
  console.error(error);
  return { error: "Internal Server Error" };
}

export { PondError };
