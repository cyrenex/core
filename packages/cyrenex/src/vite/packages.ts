// Package lookups for monorepos: where a package is, and which package a file belongs to.
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { normalizePath } from "vite";

import type { Location, Runtime } from "./types.ts";

/**
 * The directory of package `name` as `root` sees it: the first `node_modules/<name>` up from
 * `root`, followed to the workspace package it links to. Reads no `exports`.
 */
export function packageDir(root: string, name: string): string {
  for (let dir = root; ;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return normalizePath(realpathSync(candidate));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `cyrenex: package "${name}" was not found in node_modules from ${normalizePath(root)}. ` +
      `Add it to the dependencies (\`"${name}": "workspace:*"\`) and install.`,
  );
}

/** The absolute path of a file or directory option: relative to `root`, or in a package. */
export function locate(root: string, location: Location): string {
  if (typeof location === "string") return normalizePath(resolve(root, location));
  return normalizePath(resolve(packageDir(root, location.package), location.path));
}

/** Directory of the package `path` (a file or directory) belongs to, if any. */
export function packageDirOf(path: string): string | undefined {
  for (let dir = path; ;) {
    if (existsSync(join(dir, "package.json"))) return normalizePath(dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The plain command running a server shipped as source from `entry`, as seen from `root`: the
 * runtime on the entry, from its own package's directory when that is another package. Set
 * `build.start` for anything else (`pnpm start`, `bun --filter api start`…).
 */
export function sourceCommand(root: string, entry: string, runtime: Runtime): string {
  const own = packageDirOf(root);
  const server = packageDirOf(dirname(entry));
  if (!server || server === own) return `${runtime} ${normalizePath(relative(root, entry))}`;
  const dir = normalizePath(relative(root, server)) || ".";
  return `cd ${dir} && ${runtime} ${normalizePath(relative(server, entry))}`;
}
