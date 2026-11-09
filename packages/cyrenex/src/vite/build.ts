import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import { normalizePath } from "vite";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";

import { CLIENT_DIR_ENV, ENVIRONMENT } from "./types.ts";
import type { ResolvedOptions } from "./types.ts";

const ENTRY = "virtual:cyrenex/server-entry";
const SETUP = "virtual:cyrenex/server-setup";

/** The server entry to build, or `undefined` when the server build is off for this root. */
export function serverBuildOf(
  options: ResolvedOptions,
  root: string,
): { entry: string; outDir: string } | undefined {
  const { build } = options;
  if (!build) return undefined;
  const entry = resolve(root, build.entry);
  // Defaulted: only build when the conventional entry exists, so API-less setups are untouched.
  if (build.auto && !existsSync(entry)) return undefined;
  return { entry, outDir: build.outDir };
}

/**
 * Code run before the server entry is imported: `.env` files of the mode (as `vite build`
 * would read them, but from the working directory at runtime), `NODE_ENV`, and where the
 * client build is, for `serve()`.
 */
function renderSetup(mode: string, clientDir: string): string {
  const files = [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"];
  return `import { resolve } from "node:path";

// process.loadEnvFile() never overrides, so the most specific file goes first.
for (const file of ${JSON.stringify(files)}) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
process.env.NODE_ENV ??= ${JSON.stringify(mode === "development" ? "development" : "production")};
process.env.${CLIENT_DIR_ENV} ??= resolve(import.meta.dirname, ${JSON.stringify(clientDir)});
`;
}

/**
 * Build the server entry next to the client: `vp build` writes `dist/client` and
 * `dist/server/main.mjs`, runnable with `node` or `bun`.
 */
export function buildPlugin(options: ResolvedOptions): Plugin {
  let config: ResolvedConfig;
  let server: { entry: string; outDir: string } | undefined;

  return {
    name: "cyrenex:build",
    apply: "build",

    config(user) {
      server = serverBuildOf(options, resolve(user.root ?? process.cwd()));
      if (!server) return;

      const clientOutDir =
        user.build?.outDir || user.environments?.client?.build?.outDir
          ? {}
          : { outDir: "dist/client" };
      return {
        // Build every environment with a plain `vp build`, not just the client.
        builder: {},
        environments: {
          client: { build: clientOutDir },
          [ENVIRONMENT]: {
            build: {
              outDir: server.outDir,
              emptyOutDir: true,
              copyPublicDir: false,
              target: "esnext",
              minify: false,
              rolldownOptions: {
                input: { main: ENTRY },
                output: {
                  format: "es",
                  entryFileNames: "[name].mjs",
                  chunkFileNames: "chunks/[name]-[hash].mjs",
                },
              },
            },
          },
        },
      } satisfies UserConfig;
    },

    configResolved(resolved) {
      config = resolved;
      if (!server) return;
      const outDir = (name: string) =>
        normalizePath(resolve(resolved.root, resolved.environments[name]!.build.outDir));
      const client = outDir("client");
      if (`${outDir(ENVIRONMENT)}/`.startsWith(`${client}/`)) {
        // serve() hosts the client directory: the server code would be public.
        throw new Error(
          `cyrenex: the server build (${options.build && options.build.outDir}) must not be ` +
            `inside the client build (${normalizePath(relative(resolved.root, client))}). ` +
            `Set the client outDir to e.g. "dist/client", or build.outDir of cyrenex().`,
        );
      }
    },

    resolveId(id) {
      if (id === ENTRY || id === SETUP) return `\0${id}`;
    },

    load(id) {
      if (!server) return;
      if (id === `\0${ENTRY}`) {
        // A dynamic import: static ones, including the app's external dependencies, would be
        // hoisted and evaluated before the setup has loaded the environment.
        return `import ${JSON.stringify(SETUP)};\nawait import(${JSON.stringify(normalizePath(server.entry))});\n`;
      }
      if (id === `\0${SETUP}`) {
        const outDir = (name: string) =>
          resolve(config.root, config.environments[name]!.build.outDir);
        const clientDir = normalizePath(relative(outDir(ENVIRONMENT), outDir("client")));
        return renderSetup(config.mode, clientDir);
      }
    },
  };
}
