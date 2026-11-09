import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      client: "src/client.ts",
      node: "src/node.ts",
      static: "src/static.ts",
      serve: "src/serve.ts",
      testing: "src/testing.ts",
      vite: "src/vite/index.ts",
      // Spawned as a separate process by the dev plugin; must stay next to vite.mjs.
      worker: "src/vite/worker.ts",
    },
    dts: {
      generator: "tsgo",
    },
    deps: {
      neverBundle: ["vite", "vite/module-runner"],
    },
  },
});
