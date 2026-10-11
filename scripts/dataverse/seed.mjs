// Loads the starting data into Dataverse. Safe to re-run: rows that already
// exist are left as they are (app edits survive), XBS lines already loaded are
// skipped.
//
//   node scripts/dataverse/seed.mjs --dry-run
//   node scripts/dataverse/seed.mjs
//
// Loads: warehouses, packing types, settings, the 2 Mar 2026 XBS snapshot
// (import header + 1,750 locked lines, following the import rules: create
// only, header marked Imported last), basket mapping, the stock take with its
// warehouses, and an assignment for the signed-in user (Ibero rows D–E).
// Not loaded: counts, variances, exceptions, Comtras — those come from using
// the apps, or from real extracts later.

import { readFileSync } from "node:fs";
import { CHOICES } from "./schema.mjs";

const DRY = process.argv.includes("--dry-run");
const root = new URL("../../", import.meta.url);
const xbs = JSON.parse(readFileSync(new URL("src/data/xbs-2026-03-02.json", root), "utf8"));

/* ---------- the data ---------- */

const SITES = [
  { code: "IBR", name: "Ibero Export Warehouse", short: "Ibero", thirdParty: false, manualEntry: true, layout: true },
  { code: "AGL", name: "AGL", short: "AGL", thirdParty: true, manualEntry: false },
  { code: "KPCU", name: "New KPCU", short: "New KPCU", thirdParty: true, manualEntry: false },
  { code: "MAXA", name: "Maxa Africa Logistics", short: "Maxa", thirdParty: true, manualEntry: false },
  { code: "MCF", name: "Mitchel Cotts Freight", short: "Mitchel Cotts", thirdParty: true, manualEntry: false },
  { code: "KCCE", name: "Kenya Co-op Coffee Exporters", short: "KCCE", thirdParty: true, manualEntry: false },
];
const PACKS = [
  { code: "JUTE60", name: "60 kg jute bag", kg: 60, pattern: null },
  { code: "JUTE50", name: "50 kg jute bag", kg: 50, pattern: "LIGHT" },
];
const SETTINGS = [
  ["TargetNetVariancePct", "0.10", "Net variance target, physical vs XBS, ± percent"],
  ["SignOffWorkingDays", "7", "SOP: sign-off within this many working days of the count"],
  ["ExceptionSlaWorkingDays", "5", "Working days to close an exception before escalation"],
  ["ThirdPartyAgeDays", "21", "Third-party stock older than this breaks the call-off rule"],
  ["MatchToleranceKg", "0.05", "Weight difference still treated as a match"],
  ["AvgValueUsdPerTonne", "7383", "Average coffee value for value-at-risk (Kenya Variables sheet)"],
  ["EnforceSeparationOfDuties", "false", "true = a mapping change can't be approved by the person who requested it. Off in the dev environment (one user); turn on for go-live."],
  ["MappingApprovers", "andrew.tanui@pathwaystechnologies.com", "Who approves basket/outturn mapping changes (flow F6). Emails separated by ;. Set to the Finance approvers for go-live."],
  ["SignOffDistribution", "andrew.tanui@pathwaystechnologies.com", "Who gets the sign-off pack email when Finance certifies a stock take (flow F5). Emails separated by ;."],
  ["HeadsOfDepartment", "{\"Operations\": \"andrew.tanui@pathwaystechnologies.com\", \"Warehouse\": \"andrew.tanui@pathwaystechnologies.com\", \"Trading\": \"andrew.tanui@pathwaystechnologies.com\", \"Finance\": \"andrew.tanui@pathwaystechnologies.com\", \"Logistics\": \"andrew.tanui@pathwaystechnologies.com\", \"Quality\": \"andrew.tanui@pathwaystechnologies.com\", \"IT\": \"andrew.tanui@pathwaystechnologies.com\"}", "Department → head of department email, as JSON. Exceptions 3+ days overdue escalate here (flow F4)."],
  ["CountReportDistribution", "andrew.tanui@pathwaystechnologies.com", "Who gets the count report the morning after the count (flow F8). Emails separated by ;. It shows XBS figures: never include counters (counting is blind)."],
  ["CountReportDate", "auto", "auto = report on the stock take counted yesterday (flow F8). A date (yyyy-MM-dd) re-sends the report for that count date; set back to auto afterwards."],
  ["CountryFinanceManager", "andrew.tanui@pathwaystechnologies.com", "Exceptions 7+ days overdue escalate to this email (flow F4)."],
];
const IMPORT = {
  name: "IMP-260302-0852",
  snapshotAt: "2026-03-02T05:52:00Z", // 08:52 EAT
  files: "9_XBS - Current Stock - 02-Mar-2026 - 085230.xlsx\n9_XBS - Current Stock - 02-Mar-2026 - 085250.xlsx",
};
const STOCK_TAKE = { name: "Monthly Stock Take - 02/03/2026", countDate: "2026-03-02" };

/** Starting secondary → primary basket rule (the mapping table is what's maintained afterwards). */
const guessPrimary = (name = "") =>
  /Top|Plus|Better|Certified/i.test(name) ? "Plus" : /Grinder|Minus|MH|ML|UG|NATURAL|below|Light|H CLASS/i.test(name) ? "Grinder" : "FAQ";

/* ---------- helpers ---------- */

const opt = (set, label) => {
  const i = CHOICES[set][1].indexOf(label);
  if (i < 0) throw new Error(`${label} is not in ${set}`);
  return 614500000 + i;
};
const baskets = new Map();
for (const l of xbs) if (l.bc && !baskets.has(l.bc)) baskets.set(l.bc, l.bn ?? "");

console.log(`${DRY ? "DRY RUN — " : ""}Seed plan`);
console.log(`  ${SITES.length} warehouses, ${PACKS.length} packing types, ${SETTINGS.length} settings`);
console.log(`  XBS import ${IMPORT.name} with ${xbs.length} lines`);
console.log(`  ${baskets.size} basket mappings`);
console.log(`  stock take "${STOCK_TAKE.name}" on ${SITES.length} warehouses + 1 assignment (you, Ibero rows D–E)`);
if (DRY) process.exit(0);

const { dv } = await import("./api.mjs");
const sets = {};
const set = async (logical) =>
  (sets[logical] ??= (await dv("GET", `EntityDefinitions(LogicalName='${logical}')?$select=EntitySetName`)).EntitySetName);
const esc = (v) => String(v).replace(/'/g, "''");

/**
 * Creates the row if its alternate key doesn't exist yet; never changes an
 * existing row (warehouse switches, approved mappings and settings are edited
 * in the app and must survive a re-run). Returns the row id.
 */
async function upsert(logical, keyCol, keyVal, body) {
  const es = await set(logical);
  const url = `${es}(${keyCol}='${esc(keyVal)}')`;
  const found = await dv("GET", `${url}?$select=${logical}id`, undefined, { allow404: true });
  if (found) return found[`${logical}id`];
  await dv("PATCH", url, body);
  return (await dv("GET", `${url}?$select=${logical}id`))[`${logical}id`];
}
async function findOne(logical, filter) {
  const r = await dv("GET", `${await set(logical)}?$select=${logical}id&$filter=${filter}&$top=1`);
  return r.value[0]?.[`${logical}id`];
}
async function pool(items, size, fn) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
        if (++done % 250 === 0) console.log(`    … ${done}/${items.length}`);
      }
    }),
  );
}

const me = await dv("GET", "WhoAmI");
const user = await dv("GET", `systemusers(${me.UserId})?$select=fullname`);
console.log(`\nSeeding as ${user.fullname}\n`);

/* 1. warehouses */
const siteId = {};
for (const s of SITES)
  siteId[s.code] = await upsert("stk_site", "stk_code", s.code, {
    stk_name: s.name,
    stk_shortname: s.short,
    stk_isthirdparty: s.thirdParty,
    stk_manualentry: s.manualEntry,
    stk_ceilingbags: 6000,
    stk_hasbaylayout: !!s.layout,
  });
console.log(`✓ ${SITES.length} warehouses`);

/* 2. packing types, settings */
for (const p of PACKS) await upsert("stk_packtype", "stk_code", p.code, { stk_name: p.name, stk_kgperbag: p.kg, stk_gradepattern: p.pattern });
for (const [k, v, d] of SETTINGS) await upsert("stk_setting", "stk_name", k, { stk_value: v, stk_description: d });
console.log(`✓ ${PACKS.length} packing types, ${SETTINGS.length} settings`);

/* 3. XBS import: header (Validating) → lines (create only) → header Imported */
const importId = await upsert("stk_xbsimport", "stk_name", IMPORT.name, {
  stk_snapshotat: IMPORT.snapshotAt,
  stk_filenames: IMPORT.files,
  stk_rowcount: xbs.length,
  "stk_importedby@odata.bind": `/systemusers(${me.UserId})`,
});
const header = await dv("GET", `${await set("stk_xbsimport")}(${importId})?$select=stk_status`);
const lineSet = await set("stk_xbsline");
const have = new Set();
for (let url = `${lineSet}?$select=stk_rownumber&$filter=_stk_import_value eq ${importId}`; url; ) {
  const r = await dv("GET", url);
  for (const x of r.value) have.add(x.stk_rownumber);
  url = r["@odata.nextLink"]?.split("/api/data/v9.2/")[1];
}
if (header.stk_status === opt("stk_importstatus", "Imported") && have.size === xbs.length) {
  console.log(`✓ XBS import ${IMPORT.name} already loaded (${have.size} lines, locked)`);
} else {
  if (header.stk_status == null)
    await dv("PATCH", `${await set("stk_xbsimport")}(${importId})`, { stk_status: opt("stk_importstatus", "Validating") });
  const todo = xbs.map((l, i) => ({ l, row: i + 1 })).filter((x) => !have.has(x.row));
  console.log(`  loading ${todo.length} XBS lines (${have.size} already there) …`);
  await pool(todo, 8, ({ l, row }) =>
    dv("POST", lineSet, {
      stk_name: l.b,
      stk_rownumber: row,
      "stk_import@odata.bind": `/${(sets.stk_xbsimport)}(${importId})`,
      "stk_site@odata.bind": `/${sets.stk_site}(${siteId[l.wh]})`,
      stk_stocktype: opt("stk_stocktype", l.t === "W" ? "Warehouse" : "Blocked for processing"),
      stk_zone: l.z ?? null,
      stk_outturn: l.o,
      stk_grade: l.i,
      stk_basketcode: l.bc ?? null,
      stk_basketname: l.bn ?? null,
      stk_bags: l.bg,
      stk_pocketkg: l.pk,
      stk_units: l.u,
      stk_kg: l.kg,
      stk_growermark: l.g ?? null,
      stk_warrant: l.wr ?? null,
      stk_certification: l.c ?? null,
      stk_cupscore: l.cs ?? null,
      stk_blocked: !!l.bl,
      stk_salescontract: l.so ?? null,
      stk_instruction: l.in ?? null,
      stk_daysinstock: l.d ?? null,
      stk_cropyear: l.cy ?? null,
    }),
  );
  await dv("PATCH", `${await set("stk_xbsimport")}(${importId})`, { stk_status: opt("stk_importstatus", "Imported") });
  console.log(`✓ XBS import ${IMPORT.name}: ${xbs.length} lines, marked Imported`);
}

/* 4. basket mapping */
for (const [code, name] of baskets)
  await upsert("stk_basketmap", "stk_basketcode", code, { stk_name: `${code} ${name}`, stk_primarybasket: opt("stk_primarybasket", guessPrimary(name)) });
console.log(`✓ ${baskets.size} basket mappings`);

/* 5. stock take + its warehouses */
const stSet = await set("stk_stocktake");
let stId = await findOne("stk_stocktake", `stk_name eq '${esc(STOCK_TAKE.name)}'`);
if (!stId) {
  await dv("POST", stSet, {
    stk_name: STOCK_TAKE.name,
    stk_type: opt("stk_stocktaketype", "Monthly"),
    stk_status: opt("stk_stocktakestatus", "Count in progress"),
    stk_countdate: STOCK_TAKE.countDate,
    "stk_import@odata.bind": `/${sets.stk_xbsimport}(${importId})`,
  });
  stId = await findOne("stk_stocktake", `stk_name eq '${esc(STOCK_TAKE.name)}'`);
}
const linked = new Set(
  (await dv("GET", `${stSet}(${stId})/stk_stocktake_site?$select=stk_code`)).value.map((s) => s.stk_code),
);
for (const s of SITES)
  if (!linked.has(s.code))
    await dv("POST", `${stSet}(${stId})/stk_stocktake_site/$ref`, { "@odata.id": `${(await import("./auth.mjs")).ORG_URL}/api/data/v9.2/${sets.stk_site}(${siteId[s.code]})` });
console.log(`✓ stock take "${STOCK_TAKE.name}" on ${SITES.length} warehouses`);

/* 6. assignment for the signed-in user */
const asSet = await set("stk_assignment");
if (!(await findOne("stk_assignment", `_stk_stocktake_value eq ${stId} and _stk_counter_value eq ${me.UserId}`))) {
  await dv("POST", asSet, {
    stk_name: `${user.fullname} · Ibero rows D–E`,
    stk_rows: "D,E",
    "stk_stocktake@odata.bind": `/${stSet}(${stId})`,
    "stk_counter@odata.bind": `/systemusers(${me.UserId})`,
    "stk_site@odata.bind": `/${sets.stk_site}(${siteId.IBR})`,
  });
}
console.log(`✓ assignment: ${user.fullname} → Ibero rows D–E`);

/* 7. verify */
console.log("\nVerify (rows in Dataverse):");
for (const [logical, expected] of [
  ["stk_site", SITES.length],
  ["stk_packtype", PACKS.length],
  ["stk_setting", SETTINGS.length],
  ["stk_xbsimport", 1],
  ["stk_xbsline", xbs.length],
  ["stk_basketmap", baskets.size],
  ["stk_stocktake", 1],
  ["stk_assignment", 1],
]) {
  const r = await dv("GET", `${await set(logical)}?$select=${logical}id&$count=true&$top=1`);
  const n = r["@odata.count"];
  console.log(`  ${n === expected ? "✓" : "✗"} ${logical}: ${n}${n === expected ? "" : ` (expected ${expected})`}`);
}
