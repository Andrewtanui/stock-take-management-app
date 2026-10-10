// Fails if src/shared differs between the two apps. Both repos sit side by
// side; set SHARED_SIBLING to point elsewhere.
//   node scripts/check-shared.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siblingName = basename(here) === "stocktake-app" ? "stock take management app" : "stocktake-app";
const sibling = process.env.SHARED_SIBLING ?? join(here, "..", siblingName);
const a = join(here, "src", "shared");
const b = join(sibling, "src", "shared");
if (!existsSync(b)) {
  console.error(`Can't find the other app's src/shared at ${b}`);
  process.exit(2);
}
const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort();
let bad = 0;
for (const n of names) {
  const x = existsSync(join(a, n)) ? readFileSync(join(a, n), "utf8").replace(/\r\n/g, "\n") : null;
  const y = existsSync(join(b, n)) ? readFileSync(join(b, n), "utf8").replace(/\r\n/g, "\n") : null;
  const ok = x !== null && x === y;
  if (!ok) bad++;
  console.log(`${ok ? "same     " : x === null || y === null ? "MISSING  " : "DIFFERENT"} src/shared/${n}`);
}
if (bad) {
  console.error(`\n${bad} shared file(s) out of step — copy the newer one across.`);
  process.exit(1);
}
console.log("\nShared rules identical in both apps.");
