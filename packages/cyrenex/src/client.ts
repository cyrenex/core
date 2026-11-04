import type { AnyElysia } from "elysia";

/**
 * Filled in by the generated `cyrenex-env.d.ts`:
 *
 * ```ts
 * declare module "cyrenex/client" {
 *   interface Register {
 *     app: typeof import("./server/app.ts").default;
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line no-empty-interface
export interface Register {}

/** The server app type for Eden: `treaty<App>(location.origin)`. */
export type App = Register extends { app: infer A extends AnyElysia } ? A : AnyElysia;
