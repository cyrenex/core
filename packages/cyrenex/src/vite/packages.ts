// Package lookups for monorepos: where a package is, and which package a file belongs to.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { normalizePath } from "vite";

import type { Location, Runtime } from "./types.ts";

/**
 * The directory of package `name` as `root` sees it: the first `node_modules/<name>` up from
 * `root` (followed to the workspace package it links to), else the workspace package of that
 * name, so it needs no install. Reads no `exports`.
 */
export function packageDir(root: string, name: string): string {
  for (let dir = root; ;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return normalizePath(realpathSync(candidate));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const found = workspacePackage(root, name);
  if (found) return found;
  throw new Error(
    `cyrenex: package "${name}" was not found from ${normalizePath(root)}, neither in ` +
      "node_modules nor among the packages of its workspace (pnpm-workspace.yaml, or " +
      "`workspaces` in package.json).",
  );
}

/** The directory of the workspace package `name`, scanning the workspace above `root`. */
function workspacePackage(root: string, name: string): string | undefined {
  const workspace = workspaceOf(root);
  if (!workspace) return undefined;
  const include = workspace.patterns.filter((pattern) => !pattern.startsWith("!"));
  const exclude = workspace.patterns
    .filter((pattern) => pattern.startsWith("!"))
    .flatMap((pattern) => expand(workspace.dir, pattern.slice(1)));
  for (const dir of include.flatMap((pattern) => expand(workspace.dir, pattern))) {
    if (exclude.includes(dir)) continue;
    if (readName(join(dir, "package.json")) === name) return normalizePath(realpathSync(dir));
  }
  return undefined;
}

/** The nearest workspace root above `root`, with its package patterns. */
function workspaceOf(root: string): { dir: string; patterns: string[] } | undefined {
  for (let dir = root; ;) {
    const pnpm = join(dir, "pnpm-workspace.yaml");
    if (existsSync(pnpm)) return { dir, patterns: pnpmPackages(readFileSync(pnpm, "utf8")) };
    const manifest = readJson(join(dir, "package.json")) as
      | { workspaces?: string[] | { packages?: string[] } }
      | undefined;
    const workspaces = manifest?.workspaces;
    if (workspaces) {
      return {
        dir,
        patterns: Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []),
      };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The `packages` list of a pnpm-workspace.yaml, the only key read. */
function pnpmPackages(yaml: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages || !line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s*(['"]?)(.+?)\1\s*(#.*)?$/.exec(line);
    if (item) patterns.push(item[2]!);
    else if (!/^\s/.test(line)) break;
  }
  return patterns;
}

/** Directories under `base` matching a workspace glob: `*` and `?` in a segment, `**`. */
function expand(base: string, pattern: string): string[] {
  const segments = pattern.replace(/^\.\//, "").split("/").filter(Boolean);
  const results: string[] = [];
  const walk = (dir: string, index: number): void => {
    if (index === segments.length) {
      results.push(normalizePath(dir));
      return;
    }
    const segment = segments[index]!;
    if (segment === "**") {
      walk(dir, index + 1);
      for (const child of subdirectories(dir)) walk(join(dir, child), index);
      return;
    }
    if (!/[*?]/.test(segment)) {
      if (existsSync(join(dir, segment))) walk(join(dir, segment), index + 1);
      return;
    }
    const regex = new RegExp(
      `^${segment
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".")}$`,
    );
    for (const child of subdirectories(dir)) {
      if (regex.test(child)) walk(join(dir, child), index + 1);
    }
  };
  walk(base, 0);
  return [...new Set(results)];
}

/** Subdirectories worth scanning: no dependency stores or hidden directories. */
function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

const readName = (file: string) => (readJson(file) as { name?: unknown } | undefined)?.name;

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
