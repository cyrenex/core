import type { Pond, Ripple } from "@cyrenex/pondi";
import { pondOf } from "./lifecycle.ts";

export interface Override extends AsyncDisposable {
  /** The fork requests resolve from while the override is active. */
  readonly pond: Pond;
  /** Route requests back to the previous Pond and dispose the fork. Idempotent. */
  restore(): Promise<void>;
}

/**
 * Swap providers of an app built with `pondi(pond)` until restored, without rebuilding it:
 *
 * ```ts
 * import app from "../server/app.ts";
 * import { override } from "cyrenex/testing";
 *
 * test("lists users", async () => {
 *   await using _ = override(app, ripple(Db, () => fakeDb));
 *   expect((await treaty(app).api.users.get()).data).toEqual([]);
 * });
 * ```
 *
 * Requests resolve from a `fork()` of the app's Pond that shadows the given ripples, so
 * singletons depending on them are created again in the fork and the real ones stay untouched.
 * Overrides nest; restore them in reverse order. Disposing the fork disposes its instances.
 *
 * The override applies to every request of the app, so do not run overriding tests of the
 * same app concurrently.
 */
export function override(
  app: object,
  ...ripples: (Ripple<any> | readonly Ripple<any>[])[]
): Override {
  const handle = pondOf(app);
  if (!handle) {
    throw new TypeError("cyrenex: override() needs an app using pondi(pond).");
  }
  const previous = handle.override;
  const pond = (previous ?? handle.root).fork().use(...ripples);
  handle.override = pond;

  let restoring: Promise<void> | undefined;
  const restore = (): Promise<void> => {
    if (!restoring && handle.override !== pond) {
      return Promise.reject(new Error("cyrenex: restore overrides in reverse order."));
    }
    return (restoring ??= (() => {
      handle.override = previous;
      return pond.dispose();
    })());
  };

  return { pond, restore, [Symbol.asyncDispose]: restore };
}
