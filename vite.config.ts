import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  // The library's oxc type-aware lint pass covers `src` only. `docs` (Astro,
  // virtual modules the type checker can't resolve) and the `examples` are kept
  // out: the examples consume the *built* `dist` (workspace `exports` point there
  // since `pack.exports.devExports` is off), so they are type-checked separately,
  // against that dist, by the `check:examples` task — each with its own tsconfig
  // (the NestJS one supplies the CommonJS + legacy-decorator consumer view).
  lint: {
    ignorePatterns: ["docs/**", "examples/**"],
    options: { typeAware: true, typeCheck: true },
  },
  pack: {
    tsconfig: "tsconfig.build.json",
    dts: { tsgo: true },
    exports: {
      devExports: false,
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
      // Builds the library, then type-checks every example against the emitted
      // `dist` (consumer view) using each example's own tsconfig. This is what
      // exercises the published `.d.ts`/`.d.cts` the way real consumers do.
      "check:examples": {
        dependsOn: ["build"],
        cache: false,
        command: [
          "tsgo --noEmit -p examples/contract/tsconfig.json",
          "tsgo --noEmit -p examples/hono/tsconfig.json",
          "tsgo --noEmit -p examples/nestjs/tsconfig.json",
          "tsgo --noEmit -p examples/client/tsconfig.json",
        ],
      },
    },
  },
});
