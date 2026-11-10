import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { staticPlugin as elysiaStatic } from "@elysia/static";

type UpstreamOptions = NonNullable<Parameters<typeof elysiaStatic>[0]>;

export type StaticPluginOptions = Omit<UpstreamOptions, "prefix"> & {
  /**
   * Directory of the built frontend, relative to the working directory.
   * @default "dist"
   */
  assets?: string;
  /**
   * URL prefix the files are served under; match Vite `base`.
   * @default "/"
   */
  prefix?: string;
  /**
   * Serve `index.html` for page navigations (GET, `Accept: text/html`) that match no route,
   * so history routing works. API calls and missing assets keep their 404.
   * @default true
   */
  spa?: boolean;
};

/**
 * Serve a Vite build with `@elysia/static` (install it yourself), plus SPA fallback.
 *
 * Defaults follow Vite's output instead of upstream's (`dist` under `/`). For production only;
 * in development the frontend is served by Vite.
 *
 * ```ts
 * import { staticPlugin } from "@cyrenex/elysia/static";
 *
 * app.use(await staticPlugin()).listen(3000);
 * ```
 */
export async function staticPlugin(options: StaticPluginOptions = {}) {
  const { spa = true, assets = "dist", prefix = "/", ...rest } = options;
  const files = await elysiaStatic({ ...rest, assets, prefix });
  if (!spa) return files;

  const index = resolve(assets, "index.html");
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  let html: Promise<string> | undefined;

  // Global, so it sees both requests matching no route and upstream's wildcard route
  // (alwaysStatic: false), which throws NOT_FOUND for missing files.
  return files.onError({ as: "global" }, async ({ code, request, set }) => {
    if (code !== "NOT_FOUND" || request.method !== "GET") return;
    if (!request.headers.get("accept")?.includes("text/html")) return;
    const { pathname } = new URL(request.url);
    if (!`${pathname}/`.startsWith(base)) return;
    // Errors thrown by a route keep `set.status`; unmatched requests keep the Response status.
    set.status = 200;
    return new Response(await (html ??= readFile(index, "utf8")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}
