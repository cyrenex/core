import type { AnyElysia } from "elysia";

export interface StoppableServer {
  stop(force?: boolean): unknown;
}

/**
 * Stop a listening app and await its `onStop` hooks (which dispose the Pond).
 *
 * Bun and `cyrenex/node` set `app.server`, so `app.stop()` does the work. Plain `@elysia/node`
 * does not, so the server returned to the `listen` callback is closed and the hooks run here.
 */
export async function stopApp(app: AnyElysia, server: StoppableServer | undefined): Promise<void> {
  if (app.server) {
    await app.stop(true);
    return;
  }
  await server?.stop(true);
  for (const hook of app.event.stop ?? []) await hook.fn(app);
}
