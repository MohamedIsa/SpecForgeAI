// Production bundling for the Docker image  .
//
// `pnpm run build` (plain tsc) is kept as-is for local typechecking/declarations
// — this project's tsconfig uses moduleResolution: "bundler", which never
// rewrites relative import specifiers to include a ".js" extension. That
// output is fine for tools with their own resolution (tsx, vitest, vite) but
// is NOT valid ESM under plain `node`: every extensionless relative import
// throws ERR_MODULE_NOT_FOUND. Since the Docker image runs the built output
// with plain `node`, first-party source is bundled into one file instead —
// esbuild resolves and inlines all relative imports, so no extensionless
// specifier survives into the output. Every npm dependency (fastify, pg,
// jsonwebtoken, etc.) is left external and still resolved normally from
// node_modules at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outfile: "dist/index.js",
  sourcemap: true,
  logLevel: "info",
});
