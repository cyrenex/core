import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vite-plus/test";

import { locate, packageDir } from "../src/vite/packages.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const normalize = (path: string) => path.replaceAll("\\", "/");

/** A directory tree from file contents, in a fresh temporary root. */
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cyrenex-packages-")));
  dirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const manifest = (name: string) => JSON.stringify({ name });

describe("locate", () => {
  test("resolves paths against the root", () => {
    const root = tree({ "apps/web/index.html": "" });
    const web = join(root, "apps/web");
    expect(locate(web, "server/main.ts")).toBe(normalize(join(web, "server/main.ts")));
    expect(locate(web, "../api/main.ts")).toBe(normalize(join(root, "apps/api/main.ts")));
  });

  test("finds an installed package through node_modules, following the link", () => {
    const root = tree({
      "apps/web/index.html": "",
      "apps/api/package.json": manifest("@acme/api"),
    });
    const web = join(root, "apps/web");
    mkdirSync(join(web, "node_modules/@acme"), { recursive: true });
    // A junction on Windows: no privileges needed, like pnpm's own links.
    symlinkSync(join(root, "apps/api"), join(web, "node_modules/@acme/api"), "junction");

    const api = normalize(join(root, "apps/api"));
    expect(packageDir(web, "@acme/api")).toBe(api);
    expect(locate(web, { package: "@acme/api", path: "src/main.ts" })).toBe(`${api}/src/main.ts`);
  });

  test("finds a package of a pnpm workspace without installing", () => {
    const root = tree({
      "pnpm-workspace.yaml": [
        "# the workspace",
        "packages:",
        '  - "apps/*"',
        "  - 'libs/**' # nested",
        "  - '!libs/**/fixtures/**'",
        "catalog:",
        "  vite: ^8.0.0",
      ].join("\n"),
      "apps/web/package.json": manifest("web"),
      "apps/api/package.json": manifest("@acme/api"),
      "libs/core/db/package.json": manifest("@acme/db"),
      "libs/core/fixtures/db/package.json": manifest("@acme/fixture"),
    });
    const web = join(root, "apps/web");
    expect(packageDir(web, "@acme/api")).toBe(normalize(join(root, "apps/api")));
    expect(packageDir(web, "@acme/db")).toBe(normalize(join(root, "libs/core/db")));
    expect(() => packageDir(web, "@acme/fixture")).toThrow("was not found");
  });

  test("finds a package of an npm, yarn or bun workspace without installing", () => {
    for (const workspaces of [["packages/*"], { packages: ["packages/*"] }]) {
      const root = tree({
        "package.json": JSON.stringify({ private: true, workspaces }),
        "packages/web/package.json": manifest("web"),
        "packages/api/package.json": manifest("api"),
      });
      expect(packageDir(join(root, "packages/web"), "api")).toBe(
        normalize(join(root, "packages/api")),
      );
    }
  });

  test("says where it looked for a package it cannot find", () => {
    const root = tree({ "pnpm-workspace.yaml": "packages:\n  - apps/*\n", "apps/web/x": "" });
    expect(() => locate(join(root, "apps/web"), { package: "@acme/missing", path: "a" })).toThrow(
      'package "@acme/missing" was not found',
    );
  });
});
