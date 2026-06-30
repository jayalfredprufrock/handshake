import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  // `docs` (Astro, virtual modules the type checker can't resolve) and the
  // NestJS example (a standalone sample app with its own standard Nest toolchain
  // — CommonJS + legacy decorators + `nest build`, validated on its own) are kept
  // out of the library's oxc type-aware lint pass.
  lint: {
    ignorePatterns: ["docs/**", "examples/nestjs/**"],
    options: { typeAware: true, typeCheck: true },
  },
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
      nestjs: "src/adapters/nestjs/index.ts",
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
