import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

// `vp dev` runs the app with Bun, `vp dev --mode node` with Node.js.
export default defineConfig(({ command, mode }) => ({
  plugins: [cyrenex({ runtime: mode === "node" ? "node" : "bun" })],
  environments: {
    // Workspace only: in dev, load cyrenex from source, so edits restart the app without a
    // rebuild. Vite bundles linked workspace packages; keep them external, as they are for
    // users installing them, so their dependencies resolve from them.
    server:
      command === "serve"
        ? { resolve: { conditions: ["cyrenex-source"] } }
        : { resolve: { external: ["cyrenex", "@cyrenex/elysia"] } },
  },
}));
