import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { staticMiddleware } from "srvx/static";
import type { StaticMiddlewareOptions } from "srvx/static";

import { CLIENT_DIR_ENV } from "./host.ts";

export type StaticOptions = Omit<StaticMiddlewareOptions, "dir"> & {
  /**
   * Directory of the built frontend. A relative path is resolved against the working
   * directory; pass `new URL("../public", import.meta.url)` to resolve it against a module.
   * @default the client build next to a built server, else `dist/client` or `dist`
   */
  dir?: string | URL;
  /**
   * URL prefix the files are served under; match Vite `base`.
   * @default "/"
   */
  prefix?: string;
  /**
   * Serve `index.html` for page navigations (GET, `Accept: text/html`) that match nothing,
   * so history routing works. API calls and missing assets keep their 404.
   * @default true
   */
  spa?: boolean;
};

/** Answers a request with a file of the client build, or `undefined` when it has none. */
export type Assets = (request: Request) => Promise<Response | undefined>;

/** The client build directory `start()` uses by default, if any. */
export function clientDir(): string | undefined {
  const built = process.env[CLIENT_DIR_ENV];
  if (built) return built;
  return ["dist/client", "dist"].find((dir) => existsSync(`${dir}/index.html`));
}

/** Serve the files of a client build, with SPA fallback; `undefined` when there is no build. */
export function assets(options: StaticOptions | string | URL = {}): Assets | undefined {
  const {
    dir: input,
    prefix = "/",
    spa = true,
    ...rest
  } = typeof options === "string" || options instanceof URL ? { dir: options } : options;
  const dir = input instanceof URL ? fileURLToPath(input) : (input ?? clientDir());
  if (!dir) return undefined;

  const middleware = staticMiddleware({ ...rest, dir });
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const miss = new Response(null, { status: 404 });
  let html: Promise<string> | undefined;

  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    const url = new URL(request.url);
    if (!`${url.pathname}/`.startsWith(base)) return undefined;

    // srvx maps the whole pathname into `dir`: strip the prefix first.
    const inner =
      base === "/"
        ? request
        : new Request(new URL(`/${url.pathname.slice(base.length)}${url.search}`, url), request);
    const response = await middleware(inner, () => miss);
    if (response !== miss) return response;

    if (!spa || request.method !== "GET") return undefined;
    if (!request.headers.get("accept")?.includes("text/html")) return undefined;
    return new Response(await (html ??= readFile(join(dir, "index.html"), "utf8")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
}
