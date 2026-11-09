import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // tests/bun/ uses bun:test; tests/bun.test.ts runs it in Bun.
    include: ["tests/*.test.ts"],
  },
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
