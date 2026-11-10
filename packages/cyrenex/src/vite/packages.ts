// Package lookups for monorepos: which package a server entry belongs to.
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { normalizePath } from "vite";

import type { Runtime } from "./types.ts";

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
