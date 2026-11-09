import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { BaseEnvRunner } from "env-runner";

import type { Runtime, WorkerData } from "./types.ts";

/** Resolved executables, keyed by runtime; lookup spawns a process so do it once. */
const executables = new Map<Runtime, string>();

function executableOf(runtime: Runtime): string {
  let executable = executables.get(runtime);
  if (!executable) {
    // Ask the runtime itself: version-manager shims may spawn another process without forwarding IPC,
    // and POSIX `which` can return MSYS paths on Windows.
    const command = runtime + (process.platform === "win32" ? ".exe" : "");
    try {
      executable = execFileSync(command, ["-p", "process.execPath"], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
    } catch (error) {
      throw new Error(`cyrenex: could not find "${runtime}" on PATH`, { cause: error });
    }
    executables.set(runtime, executable);
  }
  return executable;
}

/** How to launch the child process. */
export interface ProcessOptions {
  runtime: Runtime;
  /** Variables added to the host environment, e.g. from `.env` files. */
  env: Record<string, string>;
  /** Runtime flags placed before the worker entry. */
  execArgv: string[];
}

/** Runs the worker in a Node.js or Bun child process connected over IPC. */
export class RuntimeProcessRunner extends BaseEnvRunner {
  /** The process currently owning the application's listener and IPC channel. */
  private child: ChildProcess | undefined;

  /** Resolves on process exit so reloads cannot leave a previous child running. */
  private exited: Promise<void> = Promise.resolve();

  constructor(workerEntry: string, data: WorkerData, options: ProcessOptions) {
    super({ name: "cyrenex", workerEntry, data: { ...data } });
    const { runtime } = options;

    this._initWithVirtualData(() => {
      const child = spawn(executableOf(runtime), [...options.execArgv, workerEntry], {
        env: { ...this._processEnv(), ...options.env },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      this.child = child;

      const exit = Promise.withResolvers<void>();
      this.exited = exit.promise;

      child.once("exit", (code) => {
        exit.resolve();
        void this.close(new Error(`${runtime} child process exited with code ${code}`));
      });
      child.once("error", (error) => {
        exit.resolve();
        void this.close(error);
      });
      child.on("message", (message) => this._handleProcessMessage(message));
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
    });
  }

  sendMessage(message: unknown): void {
    if (!this.child?.connected) {
      throw new Error("Runtime child process IPC is unavailable");
    }
    this.child.send(message as object);
  }

  protected _hasRuntime(): boolean {
    return this.child !== undefined;
  }

  protected _runtimeType(): string {
    return "process";
  }

  /** Forced termination is the fallback after the manager's graceful shutdown deadline. */
  protected async _closeRuntime(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await this.exited;
  }
}
