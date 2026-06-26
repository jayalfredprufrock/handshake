import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  // `docs` (Astro) is excluded from tsconfig and uses virtual modules the
  // type checker can't resolve, so keep it out of the type-aware lint pass.
  lint: { ignorePatterns: ["docs/**"], options: { typeAware: true, typeCheck: true } },
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
      typebox: "src/typebox/index.ts",
      openapi: "src/openapi/index.ts",
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
