// Tests the random counter allocation on the real 2 Mar 2026 XBS snapshot.
//   npm run test:allocate
// Bundles src/data/allocate.ts + src/shared/sections.ts with esbuild (comes with Vite).
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = await build({
  stdin: { contents: `export * from "./src/data/allocate"; export * from "./src/shared/sections"; export * from "./src/data/variance-rules";`, resolveDir: fileURLToPath(root), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { allocate, buildAreas, zoneInSections, sectionList, parseZone, pickRecounter, draftVariances, sortSections, sectionsWords } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const snap = JSON.parse(readFileSync(new URL("../src/data/xbs-2026-03-02.json", import.meta.url), "utf8"));
const lines = (Array.isArray(snap) ? snap : snap.lines ?? Object.values(snap).find(Array.isArray)).filter((l) => l.t === "W" || l.t === "B");
const thirdParty = new Set(["AGL", "KPCU", "MAXA", "MCF", "KCCE"]);
const siteName = (c) => ({ IBR: "Ibero", AGL: "AGL", KPCU: "New KPCU", MAXA: "Maxa", MCF: "Mitchel Cotts", KCCE: "KCCE" })[c] ?? c;
const RULES = { homeArea: true, rotation: true, thirdPartyClearance: true };

const counters = [
  { id: "c1", name: "Achieng", homeSite: "IBR", homeRows: ["D", "E"], thirdPartyOk: false },
  { id: "c2", name: "Brian", homeSite: "IBR", homeRows: ["D", "E"], thirdPartyOk: true, lastAreas: ["IBR:A", "AGL"] },
  { id: "c3", name: "Cynthia", homeSite: "IBR", homeRows: ["A", "B"], thirdPartyOk: false },
  { id: "c4", name: "Dennis", homeSite: "IBR", homeRows: ["A", "B"], thirdPartyOk: true },
  { id: "c5", name: "Esther", homeSite: "IBR", homeRows: ["C"], thirdPartyOk: false },
  { id: "c6", name: "Felix", homeSite: "IBR", homeRows: ["C"], thirdPartyOk: true },
  { id: "c7", name: "Grace", homeSite: "IBR", homeRows: ["F", "G"], thirdPartyOk: false },
  { id: "c8", name: "Hassan", homeSite: "AGL", thirdPartyOk: true },
  { id: "c9", name: "Irene", homeSite: "AGL", thirdPartyOk: true },
  { id: "c10", name: "James", thirdPartyOk: true },
  { id: "c11", name: "Kevin", noProfile: true },
  { id: "c12", name: "Lucy", homeSite: "KPCU", thirdPartyOk: true },
];

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "pass" : "FAIL"}  ${what}`); if (!ok) failed++; };

const plan = allocate({ lines, counters, rules: RULES, thirdParty, siteName, seed: 12345 });

// 1. Every Ibero stack is in exactly one counter's sections; every third-party site is covered.
const iberoZones = [...new Set(lines.filter((l) => l.wh === "IBR" && l.z && parseZone(l.z)).map((l) => l.z))];
const owners = (z) => plan.rows.filter((r) => zoneInSections(z, sectionList(r.areas.filter((a) => a.site === "IBR").map((a) => a.section).join(",")))).length;
const bad = iberoZones.filter((z) => owners(z) !== 1);
check(bad.length === 0, `every one of ${iberoZones.length} Ibero stacks has exactly one counter${bad.length ? ` (problems: ${bad.slice(0, 5).join(", ")})` : ""}`);
const tpSites = [...new Set(lines.filter((l) => thirdParty.has(l.wh) && l.bg > 0).map((l) => l.wh))];
check(tpSites.every((s) => plan.rows.some((r) => r.areas.some((a) => a.site === s))), `every third-party site with stock has a counter (${tpSites.join(", ")})`);
check(plan.unassigned.length === 0, "nothing left unassigned");

// 2. Bags are conserved.
const total = lines.reduce((s, l) => s + l.bg, 0);
const planned = plan.rows.reduce((s, r) => s + r.areas.reduce((x, a) => x + a.bags, 0), 0);
check(Math.abs(total - planned) < 1, `all ${total.toLocaleString("en-GB")} bags are in the plan`);

// 3. Rules.
const byId = new Map(counters.map((c) => [c.id, c]));
const homeHits = plan.rows.flatMap((r) => r.areas.filter((a) => {
  const c = byId.get(r.counterId);
  if (c.noProfile) return false;
  if (a.site === "IBR") return (c.homeSite ?? "IBR") === "IBR" && (c.homeRows ?? []).some((x) => a.section.replace(/\d.*$/, "").split("/").includes(x));
  return c.homeSite === a.site;
}).map((a) => `${r.name}: ${a.label}`));
check(homeHits.length === 0, `no one counts their home rows or home warehouse${homeHits.length ? ` (${homeHits.join("; ")})` : ""}`);
const tpHits = plan.rows.filter((r) => byId.get(r.counterId).thirdPartyOk === false && r.areas.some((a) => thirdParty.has(a.site))).map((r) => r.name);
check(tpHits.length === 0, `third-party sites only for counters cleared to travel${tpHits.length ? ` (${tpHits.join(", ")})` : ""}`);
const rotHits = plan.rows.flatMap((r) => r.areas.filter((a) => (byId.get(r.counterId).lastAreas ?? []).includes(a.key.replace(/#\d+$/, ""))).map((a) => `${r.name}: ${a.key}`));
check(rotHits.length === plan.rotationRepeats, `rotation repeats reported honestly (${rotHits.length})`);

const twoSites = plan.rows.filter((r) => new Set(r.areas.map((a) => a.site)).size > 1).map((r) => r.name);
check(twoSites.length === plan.multiSite && twoSites.length <= 2, `at most 2 counters work at two warehouses (${twoSites.length}${twoSites.length ? ": " + twoSites.join(", ") : ""})`);

// 4. Balance and reproducibility.
check(plan.spreadPct < 35, `workload spread ${plan.spreadPct}% (busiest vs lightest, as % of average)`);
const again = allocate({ lines, counters, rules: RULES, thirdParty, siteName, seed: 12345 });
check(JSON.stringify(again.rows) === JSON.stringify(plan.rows), "same seed gives the same plan (audit)");
const other = allocate({ lines, counters, rules: RULES, thirdParty, siteName, seed: 999 });
check(JSON.stringify(other.rows) !== JSON.stringify(plan.rows), "a different seed gives a different plan (random)");

// 5. Rebalance keeps counted areas with their counter.
const keep = plan.rows[0].areas.slice(0, 1).map((area) => ({ counterId: plan.rows[0].counterId, area }));
const rest = buildAreas(lines, counters.length, thirdParty, siteName).filter((a) => !keep.some((k) => k.area.key === a.key));
const rebalanced = allocate({ lines, counters: counters.slice(0, -2), rules: RULES, thirdParty, siteName, seed: 7, areas: rest, fixed: keep });
check(rebalanced.rows.find((r) => r.counterId === keep[0].counterId).areas.some((a) => a.key === keep[0].area.key), "rebalance leaves an already-counted area with its counter");

// 5b. Sections read in floor order.
check(sortSections(["G", "B/C", "A", "D8-14", "B", "D1-7"]).join(",") === "A,B,B/C,D1-7,D8-14,G", "sections sort by row, between-rows after the row above, then bay");
const words = sectionsWords(["B", "G", "A", "C/D", "D1-7"]);
check(words === "rows A, B and G; row D, bays 1–7; between C and D", `sections in words: "${words}"`);

// 6. Recounts go to a different counter, never into their home rows or an uncleared third party.
const picks = Array.from({ length: 200 }, (_, i) => pickRecounter({ site: "IBR", stack: "D-05-1", exclude: ["c3"], counters, openRecounts: {}, rules: RULES, thirdParty, rand: () => (i + 0.5) / 200 }));
check(picks.every((c) => c && c.id !== "c3" && !["c1", "c2"].includes(c.id)), "recount of D-05-1 never goes to the original counter or a counter whose home rows are D/E");
check(new Set(picks.map((c) => c.id)).size > 3, `recounts are spread at random (${new Set(picks.map((c) => c.id)).size} different counters)`);
const busy = pickRecounter({ site: "IBR", stack: "D-05-1", exclude: [], counters: counters.slice(2, 4), openRecounts: { c3: 2 }, rules: RULES, thirdParty });
check(busy?.id === "c4", "the counter with fewer open recounts gets it");
const tp = Array.from({ length: 50 }, (_, i) => pickRecounter({ site: "AGL", stack: "S1", exclude: [], counters, openRecounts: {}, rules: RULES, thirdParty, rand: () => (i + 0.5) / 50 }));
const tpBad = tp.filter((c) => !c.noProfile && !(c.thirdPartyOk === true && c.homeSite !== "AGL")).map((c) => c.name);
check(tpBad.length === 0, `third-party recounts only for cleared counters from another warehouse (or no profile yet, as in the allocation)${tpBad.length ? ": " + [...new Set(tpBad)].join(", ") : ""}`);

// 7. A recount line by another counter replaces the earlier count (no false duplicate).
const lot = lines.find((l) => l.wh === "IBR" && l.z && parseZone(l.z) && l.u > 2);
const sub = [{ site: "IBR", stack: lot.z }];
const zoneLines = lines.filter((l) => l.wh === "IBR" && l.z === lot.z && l.b === lot.b);
const exp = zoneLines.reduce((s, l) => s + l.u, 0);
const expKg = zoneLines.reduce((s, l) => s + l.kg, 0);
const fx = (by, units, recount) => ({ lineId: by, site: "IBR", stack: lot.z, batch: lot.b, outturn: lot.o, grade: lot.i, units, kg: expKg * (units / exp), by, at: "10:00", other: false, recount });
const others = lines
  .filter((l) => l.wh === "IBR" && l.z === lot.z && l.b !== lot.b)
  .map((l) => ({ lineId: l.b, site: "IBR", stack: l.z, batch: l.b, outturn: l.o, grade: l.i, units: l.u, kg: l.kg, by: "Achieng", at: "09:00", other: false }));
const judge = (facts) => draftVariances([...others, ...facts], lines, sub, thirdParty, siteName).find((d) => d.batch === lot.b);
const short = judge([fx("Achieng", exp - 2)]);
check(short && short.countedUnits === exp - 2, "first count 2 short makes a variance");
check(!judge([fx("Achieng", exp - 2), fx("Brian", exp, "R-007")]), "Brian's matching recount replaces Achieng's line: no variance, no duplicate");
const still = judge([fx("Achieng", exp - 2), fx("Brian", exp - 1, "R-007")]);
check(still && still.cause !== "Duplicate entry" && still.countedUnits === exp - 1, `a recount that still differs is judged on the recount alone (${still?.cause})`);
check(judge([fx("Achieng", exp - 2), fx("Brian", exp)])?.cause === "Duplicate entry", "two ordinary counts of the same lot are still a duplicate");

console.log("\nPlan (seed " + plan.seed + "):");
for (const r of plan.rows) console.log(`  ${r.name.padEnd(9)} ${String(r.bags).padStart(6)} bags  ${r.areas.map((a) => a.label).join(" · ")}`);
for (const w of plan.warnings) console.log("  note: " + w);
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
