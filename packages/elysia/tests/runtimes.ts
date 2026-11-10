// The runtimes tests run against: Node.js always, Bun when it is on PATH (required in CI).
import { execFileSync } from "node:child_process";

type Runtime = "node" | "bun";

function findBun(): string | undefined {
  try {
    return execFileSync("bun", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** Absolute path of the Bun executable, if installed. */
export const bun = findBun();

if (!bun) {
  // CI installs Bun, so a missing one there is a setup error, not something to skip.
  if (process.env.CI) throw new Error("bun is not on PATH; the Bun tests cannot run");
  console.warn("bun is not on PATH: skipping the Bun tests (install Bun to run them)");
}

export const runtimes: Runtime[] = bun ? ["node", "bun"] : ["node"];

/** Executable for `runtime`, to run built output with. */
export const executableOf = (runtime: Runtime): string =>
  runtime === "bun" ? bun! : process.execPath;
