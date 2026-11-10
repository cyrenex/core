import { cpSync, existsSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";

import { normalizePath } from "vite";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";

import { CLIENT_DIR_ENV } from "../host.ts";
import { locate, sourceCommand } from "./packages.ts";
import { ENVIRONMENT } from "./types.ts";
import type { ResolvedOptions } from "./types.ts";

const ENTRY = "virtual:cyrenex/server-entry";
const SETUP = "virtual:cyrenex/server-setup";

/** The server entry to bundle, or `undefined` when the server ships as source. */
export function serverBuildOf(
  options: ResolvedOptions,
  root: string,
): { entry: string; outDir: string } | undefined {
  const server = options.build && options.build.server;
  if (!server) return undefined;
  const entry = locate(root, options.server);
  // Defaulted: only build when the conventional entry exists, so API-less setups are untouched.
  if (server.auto && !existsSync(entry)) return undefined;
  return { entry, outDir: server.outDir };
}

/**
 * Code run before the server entry is imported: `.env` files of the mode (as `vite build`
 * would read them, but from the working directory at runtime), `NODE_ENV`, and where the
 * client build is, for `start()`.
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

/** `dir` contains `other`, or is it. */
const contains = (dir: string, other: string) => `${other}/`.startsWith(`${dir}/`);

/**
 * Refuse to empty a directory holding the project or a package: client builds outside Vite
 * root (a monorepo's server package) are emptied, and a typo must not wipe a package.
 */
function assertDisposable(dir: string, root: string, what: string): void {
  const shown = normalizePath(relative(root, dir)) || ".";
  if (contains(dir, root)) {
    throw new Error(`cyrenex: ${what} (${shown}) must not contain the project root.`);
  }
  if (existsSync(resolve(dir, "package.json"))) {
    throw new Error(
      `cyrenex: ${what} (${shown}) is a package root and would be emptied; ` +
        `use a directory inside it, e.g. "${shown}/public".`,
    );
  }
}

/**
 * Build the server entry next to the client: `vp build` writes `dist/client` and
 * `dist/server/main.mjs`, runnable with `node` or `bun`. With the server shipped as source,
 * the client may go to (or be copied into) the server's package instead.
 */
export function buildPlugin(options: ResolvedOptions): Plugin {
  let config: ResolvedConfig;
  let server: { entry: string; outDir: string } | undefined;
  const build = options.build;

  return {
    name: "cyrenex:build",
    apply: "build",

    config(user) {
      if (!build) return;
      const root = resolve(user.root ?? process.cwd());
      server = serverBuildOf(options, root);

      const userOutDir = user.build?.outDir || user.environments?.client?.build?.outDir;
      const client = build.client.outDir
        ? { outDir: build.client.outDir, emptyOutDir: true }
        : server && !userOutDir
          ? { outDir: "dist/client" }
          : {};
      return {
        // Build every environment with a plain `vp build`, not just the client.
        builder: {},
        environments: {
          client: { build: client },
          ...(server && {
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
          }),
        },
      } satisfies UserConfig;
    },

    configResolved(resolved) {
      config = resolved;
      if (!build) return;
      const root = normalizePath(resolved.root);
      const client = outDirOf(resolved, "client");
      if (build.client.outDir) assertDisposable(client, root, "the client build");
      for (const target of build.client.copyTo) {
        assertDisposable(locate(root, target), root, "build.client.copyTo");
      }
      if (server && contains(client, outDirOf(resolved, ENVIRONMENT))) {
        // start() hosts the client directory: the server code would be public.
        throw new Error(
          `cyrenex: the server build (${server.outDir}) must not be inside the client build ` +
            `(${normalizePath(relative(root, client))}). Set the client outDir to e.g. ` +
            `"dist/client", or build.server.outDir of cyrenex().`,
        );
      }
    },

    buildApp: {
      order: "post",
      async handler(builder) {
        if (!build) return;
        // As Vite does after the buildApp hooks, unless one built something already. The
        // server environment may exist without an entry (configured, server shipped as
        // source): it has nothing to build then.
        const environments = Object.values(builder.environments);
        if (environments.every((environment) => !environment.isBuilt)) {
          for (const environment of environments) {
            if (environment.name === ENVIRONMENT && !server) continue;
            await builder.build(environment);
          }
        }

        const root = normalizePath(config.root);
        const client = outDirOf(config, "client");
        const shown = (dir: string) => normalizePath(relative(root, dir)) || ".";
        const lines = [`client → ${shown(client)}`];
        for (const target of build.client.copyTo) {
          const dir = locate(root, target);
          rmSync(dir, { recursive: true, force: true });
          cpSync(client, dir, { recursive: true });
          lines.push(`client → ${shown(dir)} (copy)`);
        }

        const entry = locate(root, options.server);
        if (server) {
          const main = `${shown(outDirOf(config, ENVIRONMENT))}/main.mjs`;
          lines.push(`server → ${main}`);
          lines.push(`start it with: ${build.start ?? `${options.runtime} ${main}`}`);
        } else if (existsSync(entry)) {
          lines.push(`server ships as source (${shown(entry)})`);
          lines.push(
            `start it with: ${build.start ?? sourceCommand(root, entry, options.runtime)}`,
          );
        }
        for (const line of lines) config.logger.info(`cyrenex: ${line}`);
      },
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
        const clientDir = relative(outDirOf(config, ENVIRONMENT), outDirOf(config, "client"));
        return renderSetup(config.mode, normalizePath(clientDir));
      }
    },
  };
}

function outDirOf(config: ResolvedConfig, environment: string): string {
  return normalizePath(resolve(config.root, config.environments[environment]!.build.outDir));
}
