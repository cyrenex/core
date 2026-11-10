import type { AnyElysia } from "elysia";

export interface StoppableServer {
  stop(force?: boolean): unknown;
}

/**
 * Stop a listening app and await its `onStop` hooks (which dispose the Pond), so a process can
 * exit as soon as this resolves.
 *
 * - `@cyrenex/elysia/node` sets `app.server` and awaits the hooks, so `app.stop()` does the work.
 * - Bun's adapter calls the hooks without awaiting them: `app.stop()` would resolve while the
 *   Pond is still disposing. Its server is stopped and the hooks awaited here instead.
 * - Plain `@elysia/node` sets no `app.server`, so the server returned to the `listen` callback
 *   is closed and the hooks run here.
 */
export async function stopApp(app: AnyElysia, server: StoppableServer | undefined): Promise<void> {
  if (app.server && app["~adapter"].name !== "bun") {
    await app.stop(true);
    return;
  }
  await ((app.server as StoppableServer | null) ?? server)?.stop(true);
  (app as { server: unknown }).server = null;
  for (const hook of app.event.stop ?? []) await hook.fn(app);
}
