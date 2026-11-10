import { defaultServerConditions, defineConfig } from "vite-plus";

export default defineConfig({
  // Tests load cyrenex from source, so nothing needs building first.
  ssr: { resolve: { conditions: ["cyrenex-source", ...defaultServerConditions] } },
  test: {
    include: ["tests/*.test.ts"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: {
      generator: "tsgo",
    },
  },
});
