import type { AnyElysia } from "elysia";

/**
 * Where `pondi()` stores the app's warm-up function. A registered symbol, so the dev worker and
 * the app find it even when they load different copies of cyrenex.
 */
export const WARMUP: unique symbol = Symbol.for("cyrenex.warmup") as never;

interface Warmable {
  [WARMUP]?: () => Promise<void>;
}

/**
 * Resolve the `eager` tokens given to `pondi(pond, { eager })`, once per app.
 *
 * The dev server awaits it before listening (do the same in production entries), so a failing
 * singleton (a database that refuses connections, a missing provider, a cycle) fails startup
 * instead of the first request. On failure the Pond is disposed and the error rethrown.
 *
 * Resolves immediately for apps without `pondi` or without `eager` tokens.
 */
export async function warmup(app: AnyElysia): Promise<void> {
  await (app as Warmable)[WARMUP]?.();
}
