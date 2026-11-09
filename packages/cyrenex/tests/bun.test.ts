// Runs tests/bun/*.test.ts with `bun test`, one Vitest test per file: they cover what only
// happens inside a Bun process (Bun.serve, its WebSockets, `bun test` itself).
import { execFileSync, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, test } from "vite-plus/test";

const ROOT = join(import.meta.dirname, "..");
const files = readdirSync(join(import.meta.dirname, "bun")).filter((f) => f.endsWith(".test.ts"));

function findBun(): string | undefined {
  try {
    return execFileSync("bun", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const bun = findBun();
if (!bun) {
  // CI installs Bun, so a missing one there is a setup error, not something to skip.
  if (process.env.CI) throw new Error("bun is not on PATH; the Bun tests cannot run");
  console.warn("bun is not on PATH: skipping tests/bun (install Bun to run them)");
}

function run(file: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // A ./ path: bun test treats bare arguments as name filters.
    const child = spawn(bun!, ["test", `./tests/bun/${file}`], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

describe.skipIf(!bun)("bun test", () => {
  test.each(files)("tests/bun/%s", { timeout: 60_000 }, async (file) => {
    const { code, output } = await run(file);
    // Bun's own report, with the failing test, its assertion and stack.
    if (code !== 0) throw new Error(`bun test exited with ${code}:\n\n${output.trim()}`);
  });
});
