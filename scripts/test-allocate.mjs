// Tests the random counter allocation on the real 2 Mar 2026 XBS snapshot.
//   npm run test:allocate
// Bundles src/data/allocate.ts + src/shared/sections.ts with esbuild (comes with Vite).
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = await build({
  stdin: { contents: `export * from "./src/data/allocate"; export * from "./src/shared/sections"; export * from "./src/data/variance-rules"; export * from "./src/data/auto-decide"; export * from "./src/data/close-count";`, resolveDir: fileURLToPath(root), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { allocate, buildAreas, zoneInSections, sectionList, parseZone, pickRecounter, draftVariances, sortSections, sectionsWords, planAutoDecisions, AUTO_DEFAULTS, closeCheck, l1Summary } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

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

// 8. A third-party site reported empty: every lot XBS has there is a variance counted as 0.
const tpSite = "KCCE";
const tpLots = new Set(lines.filter((l) => l.wh === tpSite).map((l) => l.b));
const emptyDrafts = draftVariances([], lines, [{ site: tpSite, stack: "Whole site" }], thirdParty, siteName, [{ site: tpSite, stack: "Whole site", by: "William", at: "09:40", reason: "Coffee delivered or moved out before the count" }]);
check(emptyDrafts.length === tpLots.size && emptyDrafts.every((d) => d.countedUnits === 0 && d.cause === "Unposted gate-out" && d.stack === "Whole site" && /reported empty by William/.test(d.why)),
  `an empty ${tpSite} gives one variance per XBS lot there (${emptyDrafts.length} of ${tpLots.size}), counted 0, cause "Unposted gate-out"`);
check(draftVariances([], lines, [], thirdParty, siteName).length === 0, "a site nobody reported isn't judged (not counted, not zero)");

// 9. A third-party site the counter finished: lots nobody counted there become "not found" (counted 0).
const agl = [...new Set(lines.filter((l) => l.wh === "AGL").map((l) => l.b))];
const one = lines.find((l) => l.wh === "AGL" && l.b === agl[0]);
const aglFacts = [{ lineId: "x", site: "AGL", stack: "Area 1", batch: one.b, outturn: one.o, grade: one.i, units: lines.filter((l) => l.wh === "AGL" && l.b === one.b).reduce((s, l) => s + l.u, 0), kg: lines.filter((l) => l.wh === "AGL" && l.b === one.b).reduce((s, l) => s + l.kg, 0), by: "William", at: "10:00", other: false }];
const finished = draftVariances(aglFacts, lines, [{ site: "AGL", stack: "Area 1" }, { site: "AGL", stack: "Whole site" }], thirdParty, siteName, [{ site: "AGL", stack: "Whole site", by: "William", at: "17:30", reason: "Every stack at the site is counted", finished: true }]);
const withStock = agl.filter((b) => b !== one.b && lines.filter((l) => l.wh === "AGL" && l.b === b).some((l) => l.u > 0 || l.kg >= 1)).length;
check(finished.length === withStock && finished.every((d) => d.countedUnits === 0 && /^Not found at AGL: William finished the site/.test(d.why) && d.cause !== "Unposted gate-out"),
  `a finished AGL judges every lot nobody counted (${finished.length} of ${withStock} with stock in XBS) as not found; the counted lot that matches isn't a variance`);
const unfinished = draftVariances(aglFacts, lines, [{ site: "AGL", stack: "Area 1" }], thirdParty, siteName);
check(unfinished.length === 0, "until the site is finished, lots nobody counted aren't judged");

// Automatic Level 1 decisions (auto-decide.ts).
{
  const tp = new Set(["AGL", "KPCU"]);
  const v = (id, o) => ({ id, key: `${o.site ?? "IBR"}|${o.stack ?? "A-01-1"}|${id}`, site: "IBR", stack: "A-01-1", outturn: id, expectedUnits: 10, countedUnits: 10, expectedKg: 600, countedKg: 600, cause: "Not yet known", state: "open", decided: false, ...o });
  const act = (p, id) => p.find((a) => a.id === id);
  const vs = [
    v("m1", { outturn: "OUT1", stack: "A-01-1", countedUnits: 15, countedKg: 900 }),
    v("m2", { outturn: "OUT1", stack: "B-02-1", countedUnits: 5, countedKg: 300 }),
    v("pk", { countedKg: 605 }),
    v("wl", { countedKg: 570 }),
    v("tp1", { site: "AGL", stack: "", countedUnits: 0, countedKg: 0, cause: "Partial delivery: rest still at third party" }),
    v("tp2", { site: "AGL", stack: "", countedUnits: 4, countedKg: 240, cause: "Unposted gate-out" }),
    v("nx", { expectedUnits: 0, expectedKg: 0, countedUnits: 37, countedKg: 2198, cause: "Mapping error" }),
    v("rc", { countedUnits: 8, countedKg: 480 }),
    v("old", { countedUnits: 8, countedKg: 480, decided: true }),
  ];
  const p = planAutoDecisions(vs, [], tp, AUTO_DEFAULTS);
  check(act(p, "m1")?.act === "accept" && act(p, "m2")?.act === "accept", "auto: over on one stack, short on another, netting to 0 - both accepted as moved");
  check(act(p, "pk")?.act === "accept" && act(p, "pk").cause === "Pocket / unit difference", "auto: bags match, 5 kg over - accepted as a pocket / unit difference");
  check(act(p, "wl")?.act === "exception" && act(p, "wl").dept === "Warehouse", "auto: bags match, 30 kg under at Ibero - weight-loss exception for Warehouse");
  check(act(p, "tp1")?.group === "site:AGL" && act(p, "tp2")?.group === "site:AGL", "auto: third-party lots short - one AGL exception between them");
  check(act(p, "nx")?.act === "exception" && act(p, "nx").rule === "Found, not in XBS", "auto: counted, not in XBS - exception");
  check(act(p, "rc")?.act === "recount", "auto: unexplained difference - blind recount");
  const uo = planAutoDecisions([v("uo", { countedUnits: 11, countedKg: 603 })], [], tp, AUTO_DEFAULTS);
  check(act(uo, "uo")?.act === "accept" && act(uo, "uo").rule === "Same weight, different bag count", "auto: one unit more but only 3 kg more - accepted, no recount");
  check(!act(p, "old"), "auto: a variance someone already decided is left alone");
  check(act(p, "nx")?.priority === "High" && !act(p, "nx").group, "auto: 36.6 bags found, not in XBS - High, its own exception");
  check(act(p, "wl")?.priority === "Low" && act(p, "wl").group === "low:IBR", "auto: 30 kg weight loss (0.5 bags) - Low, on the Ibero low-priority list");
  const mid = planAutoDecisions([v("md", { expectedUnits: 0, expectedKg: 0, countedUnits: 5, countedKg: 300, cause: "Mapping error" })], [], tp, AUTO_DEFAULTS);
  check(act(mid, "md")?.priority === "Medium" && !act(mid, "md").group, "auto: 5 bags - Medium, its own exception");
  check(planAutoDecisions(vs, [], tp, { ...AUTO_DEFAULTS, on: false }).length === 0, "auto: switched off - nothing decided");
  const f = (units, recount) => ({ lineId: String(Math.random()), site: "IBR", stack: "A-01-1", batch: "rc", outturn: "rc", grade: "", units, kg: units * 60, by: "x", at: "", other: false, recount });
  const sent = [v("rc", { countedUnits: 8, countedKg: 480, state: "recount", decided: true })];
  check(act(planAutoDecisions(sent, [f(8), f(8, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "exception", "auto: recount repeats the first count - exception");
  check(act(planAutoDecisions(sent, [f(9), f(8, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "review", "auto: recount disagrees with the first count - back to the supervisor");
  check(!act(planAutoDecisions(sent, [f(8)], tp, AUTO_DEFAULTS), "rc"), "auto: recount not in yet - waits");
}

// Level 1 closes on its own (close-count.ts).
{
  const base = { iberoStacks: ["A-01-1", "B-02-1"], submittedStacks: new Set(["A-01-1", "B-02-1"]), thirdPartySites: ["AGL"], closedSites: new Set(["AGL"]), openRecounts: 0, undecidedVariances: 0, countLines: 10 };
  check(closeCheck(base).ready, "close: every stack in, sites closed, nothing open - closes");
  const notIn = closeCheck({ ...base, submittedStacks: new Set(["A-01-1"]) });
  check(!notIn.ready && notIn.missing[0] === "1 Ibero stack not submitted (B-02-1)", "close: an Ibero stack not submitted - waits and names it");
  check(!closeCheck({ ...base, closedSites: new Set() }).ready, "close: a third-party site not finished - waits");
  check(!closeCheck({ ...base, openRecounts: 2 }).ready && !closeCheck({ ...base, undecidedVariances: 1 }).ready, "close: open recounts or undecided variances - waits");
  check(!closeCheck({ ...base, countLines: 0 }).ready, "close: nothing counted - waits");
  const text = l1Summary({
    stockTake: "Monthly Stock Take - 31/08/2026", closedAt: new Date("2026-09-03T09:00:00Z"),
    sites: [{ name: "Ibero", xbs: 19400.5, physical: 19440.5 }, { name: "AGL", xbs: 5072.5, physical: 4196.5 }],
    variances: { total: 686, accepted: 479, acceptedAutomatically: 479, exception: 207 }, recountsDone: 32, exceptions: { High: 9, Medium: 4, Low: 3 },
  });
  check(
    text.includes(">AGL</td>") && text.includes(">5,072.5</td>") && text.includes(">-876.0</td>") && text.includes(">Total</td>") && text.includes(">24,473.0</td>") && text.includes(">23,637.0</td>") && text.includes(">-836.0</td>"),
    "close: summary table with each warehouse and the total",
  );
  check(/>Accepted automatically<\/td><td[^>]*>479<\/td>/.test(text) && /High priority \(10 bags or more\)<\/td><td[^>]*>9<\/td>/.test(text), "close: summary variance and exception sections");
  check(l1Summary({ stockTake: "x", closedAt: new Date(), sites: [{ name: "A <b>bad</b> name", xbs: 1, physical: 1 }], variances: { total: 0, accepted: 0, acceptedAutomatically: 0, exception: 0 }, recountsDone: 0, exceptions: { High: 0, Medium: 0, Low: 0 } }).includes("A &lt;b&gt;bad&lt;/b&gt; name"), "close: names are escaped in the summary");
}

console.log("\nPlan (seed " + plan.seed + "):");
for (const r of plan.rows) console.log(`  ${r.name.padEnd(9)} ${String(r.bags).padStart(6)} bags  ${r.areas.map((a) => a.label).join(" · ")}`);
for (const w of plan.warnings) console.log("  note: " + w);
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
