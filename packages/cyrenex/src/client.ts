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

/**
 * The server app type, for typed clients: `treaty<App>(location.origin)` with Eden. `unknown`
 * until `cyrenex-env.d.ts` registers the app.
 */
export type App = Register extends { app: infer A } ? A : unknown;
