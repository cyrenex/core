import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  // Tests load cyrenex from source, so nothing needs building first.
  ssr: { resolve: { conditions: ["cyrenex-source", ...defaultServerConditions] } },
  test: {
    // tests/bun/ uses bun:test; tests/bun.test.ts runs it in Bun.
    include: ["tests/*.test.ts"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
      node: "src/node.ts",
    },
    dts: {
      generator: "tsgo",
    },
  },
});
