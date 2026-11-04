// Loads XBS's "Zone" report (every location of every warehouse: Zone, Warehouse, Default, Active)
// into stk_zone, the location master. One full copy per report, keyed by the report's time, so a
// newer report adds a new copy and the apps read the latest; rows are never changed (locked table).
//
//   node scripts/xbs/import-zones.mjs "<XBS - Zone - ....xlsx>"        dry run: per-warehouse summary
//   node scripts/xbs/import-zones.mjs "<XBS - Zone - ....xlsx>" --go   writes
//
// Environment: DATAVERSE_URL / DATAVERSE_TENANT pick the environment (default dev), as for dv:schema.
//
// Warehouses are matched to sites the way the XBS stock import does (siteResolver: full name, then a
// third party by first word), so Ibero's two buildings stay apart. Zones of a warehouse with no site
// yet (Thika, Classic, ...) are kept with the XBS name only.
//
// It also checks each Ibero building against its layout in src/shared/sections.ts (rows, bays,
// zones): every zone XBS has must fit, and every location of the layout must be in XBS. If XBS's
// floor plan changes, it says so - update LAYOUTS (both apps) before relying on the new zones.
import { build } from "esbuild";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import readXlsxFile from "read-excel-file/node";
import { dv } from "../dataverse/api.mjs";
import { ORG_URL } from "../dataverse/auth.mjs";

const args = process.argv.slice(2);
const GO = args.includes("--go");
const FILE = args.find((a) => !a.startsWith("--"));
if (!FILE) {
  console.log('usage: node scripts/xbs/import-zones.mjs "<XBS - Zone - ....xlsx>" [--go]');
  process.exit(1);
}

const text = (c) => (c == null ? "" : String(c)).trim();

/** "15-Oct-2026  -  14:34:08" → Date (East Africa Time, UTC+3), as the XBS stock import reads it. */
function reportTime(s) {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*-\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
  return new Date(Date.UTC(+m[3], mon, +m[1], +m[4] - 3, +m[5], +m[6]));
}

/* ---------- read the report ---------- */
const sheet = (await readXlsxFile(FILE))[0].data;
const meta = new Map();
let headerAt = -1;
for (let i = 0; i < Math.min(sheet.length, 20); i++) {
  const r = sheet[i].map(text);
  if (r[0] === "Zone" && r[1] === "Warehouse") {
    headerAt = i;
    break;
  }
  if (r[0]) meta.set(r[0].replace(/:$/, ""), r[1]);
}
if (headerAt < 0 || meta.get("Report Name") !== "Zone") throw new Error(`${FILE} doesn't look like the XBS "Zone" report (no Zone / Warehouse columns).`);
const at = reportTime(meta.get("Report Generated On") ?? "");
if (!at) throw new Error(`No "Report Generated On" time in ${FILE}.`);
const zones = sheet
  .slice(headerAt + 1)
  .map((r) => r.map(text))
  .filter((r) => r[0] && r[1])
  .map(([zone, warehouse, def, active]) => ({ zone, warehouse, isDefault: /^yes$/i.test(def), isActive: /^yes$/i.test(active) }));

/* ---------- the app's own rules: site matching and the Ibero layouts ---------- */
const bundle = await build({
  stdin: { contents: `export { siteResolver } from "./src/data/xbs-parse"; export * from "./src/shared/sections";`, resolveDir: fileURLToPath(new URL("../..", import.meta.url)), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { siteResolver, LAYOUTS, zoneFits } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

/* ---------- match warehouses to sites ---------- */
const sites = (await dv("GET", "stk_sites?$select=stk_siteid,stk_name,stk_code,stk_isthirdparty")).value;
const resolve = siteResolver(sites.map((s) => ({ code: s.stk_code, name: s.stk_name, thirdParty: s.stk_isthirdparty })));
const xbsNames = [...new Set(zones.map((z) => z.warehouse))];
const siteOf = new Map(xbsNames.map((n) => [n, sites.find((s) => s.stk_code === resolve(n))]));

const stamp = at.toISOString().slice(0, 16).replace(/\D/g, ""); // yyyymmddhhmm (UTC)
console.log(`${ORG_URL}\n${basename(FILE)}: ${zones.length} zones, report of ${meta.get("Report Generated On")} (key ${stamp})\n`);
for (const n of xbsNames) {
  const zs = zones.filter((z) => z.warehouse === n);
  console.log(`  ${String(zs.length).padStart(6)}  ${n.padEnd(38)} → ${siteOf.get(n)?.stk_code ?? "(no site yet)"}${zs.some((z) => !z.isActive) ? `  ${zs.filter((z) => !z.isActive).length} inactive` : ""}`);
}

// No table yet (before dv:schema) counts as nothing loaded.
/* ---------- each Ibero building against its layout ---------- */
// Which XBS warehouse is which layout: by its site, or (before the site exists) by the zones themselves.
let layoutOk = true;
for (const [code, l] of Object.entries(LAYOUTS)) {
  const name = xbsNames.find((n) => siteOf.get(n)?.stk_code === code) ?? xbsNames.find((n) => zones.some((z) => z.warehouse === n && zoneFits(z.zone, code)) && !siteOf.get(n));
  if (!name) {
    console.log(`  ${code}: no XBS warehouse found for this layout`);
    layoutOk = false;
    continue;
  }
  const have = new Set(zones.filter((z) => z.warehouse === name && z.zone !== "TEMP-0-0").map((z) => z.zone));
  const rows = [...l.rows, ...[...l.rows].slice(0, -1).map((r, i) => `${r}/${l.rows[i + 1]}`)];
  const p = (b) => String(b).padStart(2, "0");
  const bays = [];
  for (let b = l.bayFrom; b <= l.bayTo; b++) bays.push(p(b), ...(b < l.bayTo ? [`${p(b)}/${p(b + 1)}`] : []));
  const want = new Set(rows.flatMap((r) => bays.flatMap((b) => Array.from({ length: l.zones }, (_, i) => `${r}-${b}-${i + 1}`))));
  const extra = [...have].filter((z) => !want.has(z));
  const missing = [...want].filter((z) => !have.has(z));
  const ok = !extra.length && !missing.length;
  layoutOk &&= ok;
  console.log(`  ${code} layout (rows ${l.rows[0]}-${l.rows.at(-1)}, bays ${l.bayFrom}-${l.bayTo}, zones 1-${l.zones}) vs ${name}: ${ok ? `matches, ${have.size} locations` : `DIFFERENT - ${extra.length} not in the layout (${extra.slice(0, 5).join(", ")}), ${missing.length} not in XBS (${missing.slice(0, 5).join(", ")})`}`);
}
if (!layoutOk) console.log("  XBS's floor plan differs from LAYOUTS in src/shared/sections.ts - update it in both apps.");

// Zones of this report already loaded (all of them, or part of an interrupted load, which a re-run finishes).
const loaded = new Set();
let page = `stk_zones?$select=stk_key&$filter=startswith(stk_key,'${stamp}|')`;
while (page) {
  const r = (await dv("GET", page, undefined, { allow404: true })) ?? { value: [] }; // no table yet = nothing loaded
  for (const x of r.value) loaded.add(x.stk_key);
  page = r["@odata.nextLink"]?.split("/api/data/v9.2/")[1];
}
const keyOf = (z) => `${stamp}|${z.warehouse}|${z.zone}`.slice(0, 160);
const todo = zones.filter((z) => !loaded.has(keyOf(z)));
if (!todo.length) {
  console.log(`\nThis report (${stamp}) is already loaded. Nothing to do.`);
  process.exit(0);
}
if (loaded.size) console.log(`\n${loaded.size} of ${zones.length} zones of this report are already loaded; ${todo.length} to add.`);
if (!GO) {
  console.log("\nDry run. Add --go to write.");
  process.exit(0);
}

/* ---------- write ---------- */
let n = 0;
const rows = todo.map((z) => ({
  stk_name: z.zone,
  stk_warehouse: z.warehouse,
  stk_isdefault: z.isDefault,
  stk_isactive: z.isActive,
  stk_snapshotat: at.toISOString(),
  stk_source: basename(FILE).slice(0, 200),
  stk_key: keyOf(z),
  ...(siteOf.get(z.warehouse) ? { "stk_site@odata.bind": `/stk_sites(${siteOf.get(z.warehouse).stk_siteid})` } : {}),
}));
// 10 at a time (20 ran into throttling on NKG_Demo). If a load stops part-way, run it again: it adds the rest.
for (let i = 0; i < rows.length; i += 10) {
  await Promise.all(rows.slice(i, i + 10).map((r) => dv("POST", "stk_zones", r)));
  n += rows.slice(i, i + 10).length;
  if (n % 1000 < 10) process.stdout.write(`  ${n} … `);
}
console.log(`\nWrote ${n} zones${loaded.size ? ` (${loaded.size} were already there)` : ""}.`);
