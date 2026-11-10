// What a DI adapter (`pondi()`) stores on an app, so `start()`, the dev worker and
// `cyrenex/testing` drive it without knowing the framework. Registered symbols, so they are
// found even when the app and its host load different copies of cyrenex.
import type { Pond } from "@cyrenex/pondi";

/** Where `pondi()` stores the app's {@link PondHandle}. */
export const POND: unique symbol = Symbol.for("cyrenex.pond") as never;

/** Where `pondi()` stores the app's warm-up function. */
export const WARMUP: unique symbol = Symbol.for("cyrenex.warmup") as never;

/** The Pond attached by `pondi()`, and the fork requests use instead while overridden. */
export interface PondHandle {
  readonly root: Pond;
  override: Pond | undefined;
}

interface Managed {
  [POND]?: PondHandle;
  [WARMUP]?: () => Promise<void>;
}

/** The Pond handle `pondi()` attached to `app`, if any. */
export function pondOf(app: object): PondHandle | undefined {
  return (app as Managed)[POND];
}

/**
 * Resolve the `eager` tokens given to `pondi(pond, { eager })`, once per app.
 *
 * `start()` awaits it before listening, so a failing singleton (a database that refuses
 * connections, a missing provider, a cycle) fails startup instead of the first request. On
 * failure the Pond is disposed and the error rethrown.
 *
 * Resolves immediately for apps without `pondi` or without `eager` tokens.
 */
export async function warmup(app: object): Promise<void> {
  await (app as Managed)[WARMUP]?.();
}

/** Dispose the app's Pond (and every fork, including overrides). Idempotent. */
export async function dispose(app: object): Promise<void> {
  await pondOf(app)?.root.dispose();
}
