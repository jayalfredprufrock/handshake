import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: false } },
  pack: {
    dts: { tsgo: true },
    exports: {
      devExports: true,
    },
    format: ["esm", "cjs"],
    sourcemap: true,
    entry: {
      contract: "src/contract/index.ts",
      client: "src/client/index.ts",
      server: "src/server/index.ts",
      hono: "src/adapters/hono/index.ts",
    },
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
      },
    },
  },
});
