import cyrenex from "cyrenex/vite";
import { defineConfig } from "vite-plus";

// `vp dev` runs the app with Bun, `vp dev --mode node` with Node.js.
export default defineConfig(({ mode }) => ({
  plugins: [cyrenex({ runtime: mode === "node" ? "node" : "bun" })],
  environments: {
    // Workspace only: load cyrenex from source, so edits restart the app without a rebuild.
    elysia: { resolve: { conditions: ["cyrenex-source"] } },
  },
}));
