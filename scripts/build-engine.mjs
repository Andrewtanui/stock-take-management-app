// Builds the server engine into one file: engine/dist/stk-level1.mjs (Node 20, no npm packages).
//   npm run engine:build
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Vite's "?inline" import (the logo in the Level 1 PDF) becomes a data: URL, as in the Hub.
const inline = {
  name: "inline",
  setup(b) {
    b.onResolve({ filter: /\?inline$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?inline$/, "")), namespace: "inline" }));
    b.onLoad({ filter: /.*/, namespace: "inline" }, (a) => ({
      contents: `export default "data:image/png;base64,${readFileSync(a.path).toString("base64")}"`,
      loader: "js",
      resolveDir: dirname(a.path),
    }));
  },
};

const out = resolve(root, "engine/dist/stk-level1.mjs");
await build({
  entryPoints: [resolve(root, "src/engine/stk-level1.ts")],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  minify: true,
  legalComments: "none",
  plugins: [inline],
  banner: { js: "// stk-level1 · IBKY Stock Take Level 1 engine · built from the Hub's src/data/level1.ts. Do not edit; rebuild." },
  logLevel: "warning",
});
console.log(`Built ${out}`);
