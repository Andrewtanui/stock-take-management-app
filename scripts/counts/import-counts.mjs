// Loads a count done in the old Physical Count app (its CSV export) into a stock take, as count
// sheets, stacks and lines the way the counter app writes them, so Level 1 and the reconciliation
// run on it. The Hub's Physical count import page does the same; both read the file with
// src/data/count-import.ts (what it does with the file is described there).
//
//   node scripts/counts/import-counts.mjs <csv> --stocktake <name or id>          dry run: plan + totals
//   node scripts/counts/import-counts.mjs <csv> --stocktake <name or id> --go     writes
//
// Options:
//   --empty-sites KCCE,MAXA   third-party sites checked and found empty (one "Whole site" stack, nothing to count)
//   --not-counted AGL,KPCU    third-party sites not counted on purpose (too little to count): lots at 0, to the reconciliation
//   --reason "..."            why they weren't counted (default "too little to count")
//   --no-empty-stacks         don't submit the Ibero XBS stacks that have no count lines (default: submit
//                             them empty, so their XBS lots are judged as counted 0 - it is a full count)
// Environment: DATAVERSE_URL / DATAVERSE_TENANT pick the environment (default dev), as for dv:schema.
//
// Everything is written as the signed-in user, one count sheet per warehouse; who counted each line in
// the old app is kept in the line's note. Lines are keyed (stk_clientid "old-<stock take>-<row>"), so a
// stock take that already has lines from this file is refused.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { dv } from "../dataverse/api.mjs";
import { ORG_URL } from "../dataverse/auth.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const GO = args.includes("--go");
const FILE = args.find((a, i) => !a.startsWith("--") && !["--stocktake", "--empty-sites", "--not-counted", "--reason"].includes(args[i - 1]));
const WANT = opt("--stocktake");
const EMPTY_SITES = (opt("--empty-sites") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const NOT_COUNTED = (opt("--not-counted") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
if (!FILE || !WANT) {
  console.log("usage: node scripts/counts/import-counts.mjs <csv> --stocktake <name or id> [--empty-sites A,B] [--no-empty-stacks] [--go]");
  process.exit(1);
}

// Choice values (schema.mjs order from 614500000).
const ST_COUNTING = 614500000;
const SHEET_SUBMITTED = 614500001;
const STACK_SUBMITTED = 614500002;
const CAT_CURRENT = 614500000, CAT_PROCESSING = 614500001;
const REASON_MOVED_HERE = 614500001;
const TYPE_BFP = 614500001;

// The Hub's reader, bundled for node.
const bundle = await build({
  stdin: { contents: `export * from "./src/data/count-import";`, resolveDir: fileURLToPath(new URL("../..", import.meta.url)), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { planCountImport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

/* ---------- Dataverse ---------- */
const all = async (q) => {
  const out = [];
  let u = q;
  while (u) {
    const r = await dv("GET", u);
    out.push(...r.value);
    u = r["@odata.nextLink"]?.replace(/^.*\/api\/data\/v9\.2\//, "");
  }
  return out;
};
const bind = (set, id) => `/${set}(${id})`;
const me = (await dv("GET", "WhoAmI")).UserId;
const takes = await all("stk_stocktakes?$select=stk_stocktakeid,stk_name,stk_status,stk_countdate,_stk_import_value");
const take = takes.find((t) => t.stk_stocktakeid === WANT) ?? takes.find((t) => t.stk_name.toLowerCase().includes(WANT.toLowerCase()));
if (!take) throw new Error(`No stock take matches "${WANT}". There are: ${takes.map((t) => t.stk_name).join("; ")}`);
const siteRows = await all("stk_sites?$select=stk_siteid,stk_code,stk_name,stk_shortname,stk_isthirdparty");
const siteBy = Object.fromEntries(siteRows.map((s) => [s.stk_code, s]));
const codeOf = Object.fromEntries(siteRows.map((s) => [s.stk_siteid, s.stk_code]));
const packs = Object.fromEntries((await all("stk_packtypes?$select=stk_packtypeid,stk_kgperbag")).map((p) => [Number(p.stk_kgperbag), p.stk_packtypeid]));
const xbs = await all(
  `stk_xbslines?$select=stk_xbslineid,stk_name,stk_outturn,stk_grade,stk_zone,stk_stocktype,stk_kg,_stk_site_value&$filter=_stk_import_value eq ${take._stk_import_value}&$orderby=stk_rownumber asc`,
);
const sites = siteRows.map((s) => ({ code: s.stk_code, name: s.stk_name, shortName: s.stk_shortname ?? undefined, thirdParty: !!s.stk_isthirdparty }));
const lots = xbs.map((l) => ({ id: l.stk_xbslineid, batch: l.stk_name, outturn: l.stk_outturn ?? "", grade: l.stk_grade ?? "", zone: l.stk_zone ?? "", site: codeOf[l._stk_site_value], bfp: l.stk_stocktype === TYPE_BFP, kg: Number(l.stk_kg ?? 0) }));

for (const s of [...EMPTY_SITES, ...NOT_COUNTED]) if (!siteBy[s]?.stk_isthirdparty) throw new Error(`${s} is not a third-party site`);
const plan = planCountImport(readFileSync(FILE, "utf8"), take.stk_countdate, sites, lots, {
  emptyStacks: !args.includes("--no-empty-stacks"),
  siteChoices: Object.fromEntries([...EMPTY_SITES.map((s) => [s, "empty"]), ...NOT_COUNTED.map((s) => [s, "notCounted"])]),
  notCountedReason: opt("--reason"),
});
const { lines, stacks } = plan;
for (const s of [...EMPTY_SITES, ...NOT_COUNTED]) if (lines.some((l) => l.site === s)) throw new Error(`${s} has count lines in the file`);

/* ---------- plan ---------- */
const eq60 = (kg) => (kg / 60).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
console.log(`Environment ${ORG_URL}`);
console.log(`Stock take "${take.stk_name}" (count date ${take.stk_countdate})${take.stk_status === ST_COUNTING ? "" : "  ** NOT in Count in progress: Level 1 won't run on it **"}`);
console.log(`File ${FILE}: ${plan.rows} rows -> ${plan.withStock} with stock -> ${lines.length} count lines (${plan.withStock - lines.length} merged: same lot on one stack)`);
console.log(`Counted ${plan.from?.slice(0, 16)} to ${plan.to?.slice(0, 16)} UTC by ${plan.clerks} people`);
console.log("\nBy warehouse (60 kg bag equivalents):");
const CHOICE = { empty: "  checked, reported empty", notCounted: "  not counted on purpose: lots at 0, to the reconciliation", open: "  NOT COUNTED (no lines; --empty-sites if checked and empty, --not-counted if left on purpose)" };
for (const s of plan.sites)
  console.log(`  ${s.site.padEnd(5)} counted ${eq60(s.countedKg).padStart(9)}  XBS ${eq60(s.xbsKg).padStart(9)}  lines ${String(s.lines).padStart(4)}  stacks ${s.stacks}${s.emptyStacks ? ` + ${s.emptyStacks} XBS stacks with nothing recorded` : ""}${s.choice ? CHOICE[s.choice] : ""}`);
console.log(`  total counted ${eq60(sum(lines, (l) => l.kg))}  XBS ${eq60(sum(lots, (l) => l.kg))}`);
console.log(`\nFound away from their XBS stack: ${lines.filter((l) => l.found && l.lot).length}   not in XBS at that site: ${lines.filter((l) => !l.lot).length}   50 kg packs: ${lines.filter((l) => l.packKg === 50).length}   Blocked for processing: ${lines.filter((l) => l.lot?.bfp).length}`);
const notInXbs = lines.filter((l) => !l.lot);
if (notInXbs.length) console.log("Not in XBS at that site:", notInXbs.map((l) => `${l.outturn} ${l.site} ${l.stack} ${eq60(l.kg)}${l.inXbs ? " (XBS has it at another site)" : ""}`).join("; "));
const problems = [...plan.errors, ...plan.notes];
if (problems.length) console.log(`\n${problems.length} notes:\n  ${problems.join("\n  ")}`);

const tag = `old-${take.stk_stocktakeid.slice(0, 8)}-`;
const already = await all(`stk_countlines?$select=stk_countlineid&$filter=startswith(stk_clientid,'${tag}')&$top=1`);
if (already.length) {
  console.log(`\nThis stock take already has lines from an old-app load (${tag}*). Nothing written.`);
  process.exit(1);
}
if (!GO) {
  console.log("\nDry run: nothing written. Add --go to load.");
  process.exit(0);
}
if (take.stk_status !== ST_COUNTING) throw new Error("Refused: the stock take is not in Count in progress.");
if (plan.errors.length) throw new Error("Refused: some lines can't be loaded (see the notes). Fix the file or the sites first.");

/* ---------- write ---------- */
async function pool(items, n, fn) {
  const q = [...items];
  let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) {
      await fn(q.shift());
      if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
}
const created = async (set, body) => (await dv("POST", set, body)).id.match(/\(([0-9a-f-]{36})\)/)[1];
const sheetOf = new Map();
for (const s of new Set(stacks.map((x) => x.site))) {
  const ls = lines.filter((l) => l.site === s);
  const id = await created("stk_countsheets", {
    stk_name: `CS-OLD-${s}-${Date.now().toString(36).toUpperCase()}`.slice(0, 60),
    statecode: 0,
    stk_status: SHEET_SUBMITTED,
    stk_submittedon: ls.length ? ls.map((l) => l.at).sort().at(-1) : new Date().toISOString(),
    stk_linecount: ls.length,
    stk_bags: sum(ls, (l) => l.bags),
    stk_countercomment: `Loaded from the old Physical Count app (${FILE.split(/[\\/]/).pop()}).`.slice(0, 2000),
    "stk_stocktake@odata.bind": bind("stk_stocktakes", take.stk_stocktakeid),
    "stk_site@odata.bind": bind("stk_sites", siteBy[s].stk_siteid),
  });
  sheetOf.set(s, id);
}
console.log(`${sheetOf.size} count sheets`);
const stackId = new Map();
await pool(stacks, 6, async (s) => {
  const ls = lines.filter((l) => l.site === s.site && l.stack === s.name);
  stackId.set(`${s.site}|${s.name}`, await created("stk_stacks", {
    stk_name: s.name,
    statecode: 0,
    stk_status: STACK_SUBMITTED,
    stk_submittedon: ls.length ? ls.map((l) => l.at).sort().at(-1) : new Date().toISOString(),
    "stk_submittedby@odata.bind": bind("systemusers", me),
    ...(s.landmark ? { stk_landmark: s.landmark } : {}),
    ...(s.comment ? { stk_comment: s.comment } : {}),
    ...(s.finished ? { stk_sitefinished: true } : {}),
    ...(s.nothing ? { stk_nothinghere: true } : {}),
    ...(s.notCounted ? { stk_notcounted: true } : {}),
    "stk_stocktake@odata.bind": bind("stk_stocktakes", take.stk_stocktakeid),
    "stk_site@odata.bind": bind("stk_sites", siteBy[s.site].stk_siteid),
    "stk_countsheet@odata.bind": bind("stk_countsheets", sheetOf.get(s.site)),
  }));
});
console.log(`${stackId.size} stacks`);
await pool(lines, 6, async (e) => {
  await created("stk_countlines", {
    stk_name: `${e.outturn} @ ${e.stack}`.slice(0, 60),
    stk_clientid: `${tag}${e.rows[0]}`,
    stk_outturn: e.outturn,
    stk_batch: e.lot?.batch ?? `FOUND:${e.outturn}`, // as the counter app saves a lot XBS doesn't have, so two of them on one stack stay apart
    stk_grade: e.grade.slice(0, 30),
    stk_category: e.lot?.bfp ? CAT_PROCESSING : CAT_CURRENT,
    stk_bags: e.bags,
    stk_pocketbags: e.pocketBags,
    stk_pocketkg: Math.round(e.pocketKg * 100) / 100,
    stk_units: e.bags + e.pocketBags,
    stk_kg: Math.round(e.kg * 100) / 100,
    stk_bags60: Math.round((e.kg / 60) * 100) / 100,
    stk_reason: e.found ? REASON_MOVED_HERE : null,
    stk_isfound: e.found,
    stk_isother: false,
    stk_isblind: false,
    stk_countedon: e.at,
    stk_note: `Old app: counted by ${e.clerks.join(", ")}${e.rows.length > 1 ? ` on ${e.rows.length} lines (CSV ${e.rows.join(", ")})` : ` (CSV line ${e.rows[0]})`}.`.slice(0, 2000),
    "stk_countsheet@odata.bind": bind("stk_countsheets", sheetOf.get(e.site)),
    "stk_stack@odata.bind": bind("stk_stacks", stackId.get(`${e.site}|${e.stack}`)),
    "stk_site@odata.bind": bind("stk_sites", siteBy[e.site].stk_siteid),
    "stk_packtype@odata.bind": bind("stk_packtypes", packs[e.packKg]),
    ...(e.lot ? { "stk_xbsline@odata.bind": bind("stk_xbslines", e.lot.id) } : {}),
  });
});
console.log(`${lines.length} count lines. Done: open the Hub on this stock take to run Level 1.`);
