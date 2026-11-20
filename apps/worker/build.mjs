import { build } from "esbuild";

// Bundle our workspace packages (TypeScript sources); keep real npm packages external.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  plugins: [
    {
      name: "externalize-npm",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith("@ssw/") ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
console.log("worker built -> dist/index.js");
