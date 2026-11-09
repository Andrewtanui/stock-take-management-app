// Tests the random counter allocation on the real 2 Mar 2026 XBS snapshot.
//   npm run test:allocate
// Bundles src/data/allocate.ts + src/shared/sections.ts with esbuild (comes with Vite).
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = await build({
  stdin: { contents: `export * from "./src/data/allocate"; export * from "./src/shared/sections"; export * from "./src/data/variance-rules"; export * from "./src/data/auto-decide"; export * from "./src/data/close-count"; export * from "./src/data/count-import"; export * from "./src/data/recon-items"; export * from "./src/data/transfers-parse"; export * from "./src/data/transfer-evidence"; export * from "./src/data/recount-import"; export * from "./src/data/contracts-parse"; export * from "./src/data/xbs-shipped-parse";`, resolveDir: fileURLToPath(root), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { allocate, buildAreas, zoneInSections, sectionList, parseZone, pickRecounter, draftVariances, sortSections, sectionsWords, planAutoDecisions, AUTO_DEFAULTS, closeCheck, l1Summary, planCountImport, countItems, transferUpload, weightLossEvidence, parseRecountSheet, planRecountAnswers, newContractLines, lookbackStart, parse537, parseShipped } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

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
// 9b. A third-party site not counted on purpose (too little to count): every lot is a difference at 0,
// accepted automatically and carried to the reconciliation as one item.
const skipped = draftVariances([], lines, [{ site: "AGL", stack: "Whole site" }], thirdParty, siteName, [{ site: "AGL", stack: "Whole site", by: "Andrew", at: "10:00", reason: "Not counted: too little to count", notCounted: true }]);
check(skipped.length === withStock + 1 && skipped.every((d) => d.countedUnits === 0 && d.cause === "Third party not counted"), `a third party not counted on purpose: each lot with stock is a difference at 0 (${skipped.length}), cause "Third party not counted"`);
const ncPlan = planAutoDecisions(
  skipped.map((d, i) => ({ id: `nc${i}`, key: `${d.site}||${d.batch}`, site: d.site, stack: "", outturn: d.outturn, expectedUnits: d.expectedUnits, countedUnits: 0, expectedKg: d.expectedKg, countedKg: 0, cause: d.cause, state: "open", decided: false })),
  [], thirdParty, AUTO_DEFAULTS,
);
check(ncPlan.length === skipped.length && ncPlan.every((a) => a.act === "accept" && a.rule === "Not counted on purpose"), "not counted on purpose: accepted automatically (no recount, no Logistics exception)");
const ncItems = countItems(skipped.map((d) => ({ ...d, id: d.batch, expected: d.expectedUnits, counted: 0, state: "accepted", why: "" })), lines, thirdParty);
check(ncItems.length === 1 && ncItems[0].kind === "Third party not counted" && ncItems[0].label === "Third parties not counted (AGL)" && Math.abs(ncItems[0].bags - skipped.reduce((a, d) => a + d.expectedKg, 0) / 60) < 0.01, `not counted on purpose: one reconciling item, its XBS bags (${ncItems[0]?.bags})`);
// 9c. A move half decided when Level 1 stopped: the open side finishes against the side already accepted.
const half = [{ id: "h1", key: "IBR|C-08-1|x", site: "IBR", stack: "C-08-1", outturn: "KCS8502", expectedUnits: 0, countedUnits: 2, expectedKg: 0, countedKg: 86, cause: "Unposted receipt", state: "open", decided: false }];
check(planAutoDecisions(half, [], thirdParty, AUTO_DEFAULTS)[0]?.act === "recount", "a lone over with no partner goes for a recount");
check(planAutoDecisions(half, [], thirdParty, AUTO_DEFAULTS, undefined, [{ site: "IBR", stack: "B-08-3", outturn: "KCS8502", expectedUnits: 2, countedUnits: 0 }])[0]?.act === "accept", "its partner already accepted as moved: the open side is accepted as moved too");
check(closeCheck({ iberoStacks: [], submittedStacks: new Set(), thirdPartySites: ["AGL"], closedSites: new Set(["AGL"]), openRecounts: 0, undecidedVariances: 0, countLines: 1, siteShort: (s) => s }).ready, "a third party not counted on purpose doesn't hold up the count close");
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
    v("wl", { outturn: "KCS8447", countedKg: 570 }),
    v("wl2", { outturn: "52NC0005", countedKg: 570 }),
    v("tp1", { site: "AGL", stack: "", countedUnits: 0, countedKg: 0, cause: "Partial delivery: rest still at third party" }),
    v("tp2", { site: "AGL", stack: "", countedUnits: 4, countedKg: 240, cause: "Unposted gate-out" }),
    v("nx", { expectedUnits: 0, expectedKg: 0, countedUnits: 37, countedKg: 2198, cause: "Mapping error" }),
    v("rc", { countedUnits: 8, countedKg: 480 }),
    v("old", { countedUnits: 8, countedKg: 480, decided: true }),
  ];
  const p = planAutoDecisions(vs, [], tp, AUTO_DEFAULTS);
  check(act(p, "m1")?.act === "accept" && act(p, "m2")?.act === "accept", "auto: over on one stack, short on another, netting to 0 - both accepted as moved");
  check(act(p, "pk")?.act === "accept" && act(p, "pk").cause === "Pocket / unit difference", "auto: bags match, 5 kg over - accepted as a pocket / unit difference");
  check(act(p, "wl")?.act === "exception" && act(p, "wl").dept === "Warehouse", "auto: bags match, 30 kg under on a K lot (Ibero's own) - weight-loss exception for Warehouse");
  check(act(p, "wl2")?.act === "exception" && act(p, "wl2").dept === "Logistics", "auto: the same on any other lot (52NC0005) - weight-loss exception for Logistics");
  check(act(p, "tp1")?.group === "site:AGL" && act(p, "tp2")?.group === "site:AGL", "auto: third-party lots short - one AGL exception between them");
  check(act(p, "nx")?.act === "exception" && act(p, "nx").rule === "Found, not in XBS", "auto: counted, not in XBS - exception");
  check(act(p, "rc")?.act === "recount", "auto: unexplained difference - blind recount");
  const uo = planAutoDecisions([v("uo", { countedUnits: 11, countedKg: 603 })], [], tp, AUTO_DEFAULTS);
  check(act(uo, "uo")?.act === "accept" && act(uo, "uo").rule === "Same weight, different bag count", "auto: one unit more but only 3 kg more - accepted, no recount");
  check(!act(p, "old"), "auto: a variance someone already decided is left alone");
  check(act(p, "nx")?.priority === "High" && !act(p, "nx").group, "auto: 36.6 bags found, not in XBS - High, its own exception");
  check(act(p, "wl")?.priority === "Low" && !act(p, "wl").group, "auto: 30 kg weight loss (0.5 bags) - Low, but its own exception (not on the low-priority list)");
  const mid = planAutoDecisions([v("md", { expectedUnits: 0, expectedKg: 0, countedUnits: 5, countedKg: 300, cause: "Mapping error" })], [], tp, AUTO_DEFAULTS);
  check(act(mid, "md")?.priority === "Medium" && !act(mid, "md").group, "auto: 5 bags - Medium, its own exception");
  check(planAutoDecisions(vs, [], tp, { ...AUTO_DEFAULTS, on: false }).length === 0, "auto: switched off - nothing decided");
  const f = (units, recount) => ({ lineId: String(Math.random()), site: "IBR", stack: "A-01-1", batch: "rc", outturn: "rc", grade: "", units, kg: units * 60, by: "x", at: "", other: false, recount });
  const sent = [v("rc", { countedUnits: 8, countedKg: 480, state: "recount", decided: true })];
  check(act(planAutoDecisions(sent, [f(8), f(8, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "exception", "auto: recount repeats the first count - exception");
  check(act(planAutoDecisions(sent, [f(9), f(8, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "review", "auto: recount disagrees with the first count - back to the supervisor");
  check(!act(planAutoDecisions(sent, [f(8)], tp, AUTO_DEFAULTS), "rc"), "auto: recount not in yet - waits");
  // A lot in XBS that the first count didn't find (no lines), recounted.
  const none = [v("rc", { countedUnits: 0, countedKg: 0, state: "recount", decided: true })];
  check(act(planAutoDecisions(none, [f(0, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "exception", "auto: not found, recount finds nothing either - exception");
  check(act(planAutoDecisions(none, [f(3, "R-001")], tp, AUTO_DEFAULTS), "rc")?.act === "review", "auto: not found, recount finds some - back to the supervisor");
  check(!act(planAutoDecisions(none, [], tp, AUTO_DEFAULTS), "rc"), "auto: not found, recount not in yet - waits");
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

// Physical count import (count-import.ts): the old app's CSV.
{
  const sites = [
    { code: "IBR", name: "Ibero Export Warehouse", shortName: "Ibero", thirdParty: false },
    { code: "AGL", name: "AGL", shortName: "AGL", thirdParty: true },
    { code: "KCCE", name: "Kenya Co-op Coffee Exporters", shortName: "KCCE", thirdParty: true },
    { code: "KPCU", name: "New KPCU", shortName: "New KPCU", thirdParty: true },
  ];
  const lot = (id, outturn, grade, zone, site, kg) => ({ id, batch: id, outturn, grade, zone, site, bfp: false, kg });
  const lots = [
    lot("b1", "49MM0018", "AA", "A-01-1", "IBR", 600), lot("b2", "49MM0018", "AB", "A-01-1", "IBR", 1200),
    lot("b3", "KDI6207", "BULK", "A-02-1", "IBR", 600), lot("b4", "47CL1001", "C", "C-03/04-1", "IBR", 1681),
    lot("b5", "X1", "C", "C-04-1", "IBR", 60), lot("b6", "X2", "C", "C/D-03/04-1", "IBR", 60),
    lot("b7", "43KF0015", "AB", "TEMP-0-0", "KCCE", 120), lot("b8", "K1", "AA", "TEMP-0-0", "KPCU", 300), lot("b9", "G1", "AA", "TEMP-0-0", "AGL", 600),
  ];
  const csv = [
    "Outturn,Warehouse,Grade,Bags,Pockets,Units,Physical Weight,Location,Zone,Receive Location,Receive Zone,Created,Created By",
    "49MM0018,IBERO EXPORT WAREHOUSE,AB,20,0,20,1200,A-01,1,,,Sept-30, 2026 4:00 PM,Ibero - Clerk - Ann",
    "49MM0018,IBERO EXPORT WAREHOUSE,AA,10,0,10,600,A-01,1,,,11/02/2026 09:08,Ibero - Clerk - Ann",
    "KDI6207,IBERO EXPORT WAREHOUSE,BULK,10,0,10,600,G-14,0,,,11/02/2026 09:10,Ibero - Clerk - Ann",
    "47SL1007,IBERO EXPORT WAREHOUSE,C,27,61,28,1681,C-04,1,,,11/02/2026 09:20,Ibero - Clerk - Ann",
    "X1,IBERO EXPORT WAREHOUSE,C,0,30,1,30,C-04,1,,,11/02/2026 09:21,Ibero - Clerk - Ann",
    "X1,IBERO EXPORT WAREHOUSE,C,0,30,1,30,C-04,1,,,11/02/2026 09:22,Ibero - Clerk - Bob",
    "43KF0015,KENYA CO-OPERATIVE COFFEE EXPORTERS,AB,2,0,2,120,,,,,11/02/2026 10:00,TP - Clerk - Cy",
    "Q1,NOWHERE LTD,AA,1,0,1,60,A-01,1,,,11/02/2026 10:00,x - y - z",
  ].join("\r\n");
  const p = planCountImport(csv, "2026-10-31", sites, lots, { siteChoices: { KPCU: "notCounted" }, notCountedReason: "too little to count" });
  const line = (o, g) => p.lines.find((l) => l.outturn === o && l.grade === g);
  check(line("49MM0018", "AB")?.lot?.id === "b2" && line("49MM0018", "AA")?.lot?.id === "b1", "count import: each grade goes to its own lot of the outturn");
  check(line("49MM0018", "AB")?.at === "2026-09-30T13:00:00.000Z" && line("49MM0018", "AA")?.at === "2026-11-02T06:08:00.000Z", "count import: both old-app date formats, Nairobi time");
  check(line("KDI6207", "BULK")?.stack === "G-14-1" && line("KDI6207", "BULK").found && p.notes.some((n) => n.includes("zone 0")), "count import: zone 0 read as zone 1, with a note");
  check(line("47SL1007", "C")?.stack === "C-04-1" && !line("47SL1007", "C").lot, "count import: a lot not in XBS goes on the XBS stack at its bay and zone (row before between-rows)");
  check(line("X1", "C")?.rows.length === 2 && line("X1", "C").pocketBags === 2 && line("X1", "C").clerks.length === 2, "count import: the same lot on one stack is one line");
  check(line("43KF0015", "AB")?.site === "KCCE" && line("43KF0015", "AB").stack === "Area 1", "count import: third party by the first word of XBS's name, one area per clerk");
  check(p.errors.length === 1 && p.errors[0].includes("NOWHERE"), "count import: an unknown warehouse is an error (the load is refused)");
  check(p.stacks.some((s) => s.site === "KCCE" && s.finished) && p.stacks.some((s) => s.site === "KPCU" && s.notCounted && s.comment.includes("too little")), "count import: counted third party finished; not-counted one marked with its reason");
  check(p.sites.find((s) => s.site === "AGL")?.choice === "open" && !p.stacks.some((s) => s.site === "AGL"), "count import: a third party left out of the file stays open by default");
  check(p.stacks.some((s) => s.name === "A-02-1" && s.empty) && p.stacks.some((s) => s.name === "C-03/04-1" && s.empty), "count import: Ibero XBS stacks nobody recorded are submitted empty");
  let threw = false;
  try {
    planCountImport("a,b\n1,2", "2026-10-31", sites, lots);
  } catch {
    threw = true;
  }
  check(threw, "count import: a file that isn't the old app's export is refused");
}

// Wrong lot number (Oct 2026: 51MH1001 counted at Ibero, XBS 51MG1001 at AGL).
{
  const x = (o, i, wh, z, kg, b = `${o}-${i}`) => ({ t: "W", wh, z, b, o, i, bg: Math.floor(kg / 60), pk: kg % 60, u: Math.ceil(kg / 60), kg, bl: false });
  const xl = [x("51MG1001", "AA", "AGL", undefined, 438), x("KCS8283", "CLEAN 1", "IBR", "A-04-1", 2809), x("KCS8266", "CLEAN 1", "IBR", "B-06-1", 5160), x("KCH1002", "BULK", "IBR", "A-01-1", 350)];
  const f = (o, grade, stack, kg) => ({ lineId: o, site: "IBR", stack, batch: `FOUND:${o}`, outturn: o, grade, units: Math.ceil(kg / 60), kg, by: "Caroline", at: "11:00", other: false });
  const tps = new Set(["AGL"]);
  const subs = [{ site: "IBR", stack: "C-11-1" }, { site: "IBR", stack: "B-06-1" }, { site: "IBR", stack: "A-04-1" }, { site: "IBR", stack: "A-01-1" }, { site: "IBR", stack: "B-14-1" }];
  const counted = [f("51MH1001", "AA", "C-11-1", 440), f("KCS8286", "CLEAN 1", "B-06-1", 4440), f("KCS8283", "CLEAN 1", "A-04-1", 2809), f("KCS8266", "CLEAN 1", "B-06-1", 5160), f("KCH1003", "BULK", "B-14-1", 350)];
  const ds = draftVariances(counted, xl, subs, tps, (c) => c);
  const d = (o) => ds.find((v) => v.outturn === o);
  check(d("51MH1001")?.why.startsWith("Wrong lot number? Probably 51MG1001.") && d("51MH1001").why.includes("transfer"), `wrong lot number: 51MH1001 is probably 51MG1001 at AGL (${d("51MH1001")?.why.slice(0, 60)})`);
  check(d("KCS8286")?.cause === "Mapping error" && !d("KCS8286").why.startsWith("Wrong lot"), "wrong lot number: a number close to others but with no weight match stays found-not-in-XBS");
  check(d("KCH1003")?.why.startsWith("Wrong lot number? Probably KCH1002.") && d("KCH1002")?.countedUnits === 0, "wrong lot number: at the same site, the likely lot is short");
  const av = ds.map((v, i) => ({ id: `v${i}`, key: v.key, site: v.site, stack: v.stack, outturn: v.outturn, expectedUnits: v.expectedUnits, countedUnits: v.countedUnits, expectedKg: v.expectedKg, countedKg: v.countedKg, cause: v.cause, suggestion: v.why, state: "open", decided: false }));
  const ap = planAutoDecisions(av, [], tps, AUTO_DEFAULTS);
  const a = (o) => ap.find((p) => p.id === av.find((v) => v.outturn === o)?.id);
  check(a("KCH1003")?.act === "accept" && a("KCH1002")?.act === "accept" && a("KCH1002").rule === "Wrong lot number", "wrong lot number: same site and short by the same weight - both accepted, no recount");
  check(a("51MH1001")?.act === "exception" && a("51MH1001").rule === "Wrong lot number" && a("51MH1001").why.includes("51MG1001"), "wrong lot number: the likely lot at another site - exception naming it");
  check(a("KCS8286")?.act === "exception" && a("KCS8286").rule === "Found, not in XBS", "wrong lot number: no likely lot - found, not in XBS as before");
  const two = draftVariances([f("KCS8285", "CLEAN 1", "B-06-1", 2809)], [...xl, x("KCS8284", "CLEAN 1", "IBR", "D-01-1", 2810)], subs, tps, (c) => c);
  check(!two[0]?.why.startsWith("Wrong lot"), "wrong lot number: two likely lots - no guess");
  // Moved by weight: the units don't net, the weight does.
  const mv = (id, stack, eu, ek, cu, ck) => ({ id, key: id, site: "IBR", stack, outturn: "KDI6002", expectedUnits: eu, countedUnits: cu, expectedKg: ek, countedKg: ck, cause: "Split lot", state: "open", decided: false });
  const w1 = planAutoDecisions([mv("a", "B-14-1", 10, 687, 0, 0), mv("b", "B-13-13", 0, 0, 12, 681)], [], tps, AUTO_DEFAULTS);
  check(w1.length === 2 && w1.every((p) => p.act === "accept") && w1[0].why.includes("-6 kg"), `moved by weight: 10 units / 687 kg there, 12 units / 681 kg here - accepted as moved (${w1[0]?.why.slice(0, 90)})`);
  const w2 = planAutoDecisions([mv("a", "B-14-1", 10, 687, 0, 0), mv("b", "B-13-13", 0, 0, 12, 640)], [], tps, AUTO_DEFAULTS);
  check(w2.every((p) => p.act === "recount"), "moved by weight: 47 kg apart - not a move, recounts");
}

// XBS stock transfer + ticket reports (evidence for weight losses).
{
  const G = ["Instruction Details", ...Array(13).fill(null), "Issued Details", ...Array(5).fill(null), "Transferred Details", ...Array(6).fill(null), "Loss Gain", null, null, null, "Loss (Missing Bag)", null, null, "Balance To Transfer", "Stock Transfer Status"];
  const H = ["Number", "Instruction Type", "Date", "Instucted By", "Outturn Number", "Batch No.", "Item Name", "Season", "Units", "Bags", "Pockets", "Qty.", "From WareHouse - Zone", "To Warehouse -Zone", "Transaction No.", "Transaction Date", "Units", "Bags", "Pockets", "Qty.", "Transaction No.", "Transaction Date", "Units", "Bags", "Pockets", "Qty.", "Warehouse-Zone", "Units", "Qty.", "Variance(%)", "Reason", "Units", "Qty.", "Reason", "Qty.", "Stock Transfer Status"];
  const line = (o) => { const r = Array(H.length).fill(null); for (const [k, v] of Object.entries(o)) r[Number(k)] = v; return r; };
  const tx = "ALEGR-003675\r\n( TN-007867 )";
  const data = [
    ["Report Name:", "Stock Transfer Instruction Summary"], ["Report Generated On:", "04-Nov-2026  -  12:17:45"], [], G, H,
    line({ 0: "2020/2021-002358", 1: "Stock Transfer Across Location<BR />( Transfer)", 2: 46322, 4: "52NC0003", 5: "B-3", 6: "UG1", 11: 360, 12: "AGL-TEMP-0-0", 13: "-", 34: 360, 35: "Pending" }),
    line({ 4: "52NC0005", 5: "B-14", 6: "AB", 11: 7528, 12: "AGL-TEMP-0-0", 13: "-", 14: tx, 15: 46325, 19: 7500, 20: tx, 21: 46325, 25: 7521.5, 26: "IBERO EXPORT WAREHOUSE-D-04-1", 28: 21.5, 34: 28, 35: "Pending" }),
  ];
  const u = transferUpload("XBS - Stock Transfer Instruction Summary - 04-Nov-2026  -  121745.xlsx", [data]);
  const l = u.transfers[1];
  check(u.kind === "transfers" && u.transfers.length === 2 && u.reportedAt === "2026-11-04T09:17:45.000Z", "transfers: both lines read, report time from Generated On (EAT)");
  check(l.instruction === "2020/2021-002358" && l.type === "Stock Transfer Across Location" && l.instructedOn === "2026-10-27" && l.fromZone === "AGL-TEMP-0-0", "transfers: the instruction's columns carry down to its other lines; Excel serial dates");
  check(l.instructedKg === 7528 && l.issuedKg === 7500 && l.receivedKg === 7521.5 && l.gainKg === 21.5 && l.balanceKg === 28 && l.ticket === "TN-007867" && l.toZone === "IBERO EXPORT WAREHOUSE-D-04-1" && l.receivedOn === "2026-10-30", "transfers: repeated Qty. columns read by group (instructed, issued, received, gain, balance), ticket from the receipt");
  check(u.transfers[0].toZone === "" && u.transfers[0].ticket === undefined, "transfers: not received yet - no zone, no ticket");
  const TH = ["No.", "Arrival Date", "Status", "Ticket Type", "Item", "Units", "Net Weight", "Vehicle No.", "Gross Qty.", "Variance Qty."];
  const tk = transferUpload("XBS - Ticket Summary - 04-Nov-2026  -  124512.xlsx", [[TH,
    ["TN-007867", new Date("2026-10-30T00:00:00Z"), "Approved", "Inbound\n( Stock Transfer)", "PB", 265, 15801.5, "KAC 921B", 16023, 17],
    ["TN-007867", new Date("2026-10-30T00:00:00Z"), "Approved", "Inbound\n( Stock Transfer)", "AB", 265, 15801.5, "KAC 921B", 16023, 17]]]);
  check(tk.kind === "tickets" && tk.tickets.length === 1 && tk.tickets[0].netKg === 15801.5 && tk.tickets[0].varianceKg === 17 && tk.tickets[0].items.join() === "PB,AB" && tk.reportedAt === "2026-11-04T09:45:12.000Z", "tickets: one per ticket (rows per item), weights once, time from the file name");
  let bad = false;
  try { transferUpload("x.xlsx", [[["a", "b"]]]); } catch { bad = true; }
  check(bad, "transfers: another file is refused");
}

// Evidence on weight losses from the transfer + ticket reports (only what the numbers prove).
{
  const T = (o) => ({ row: 1, instruction: "I-1", type: "Stock Transfer Across Location", outturn: "52NC0005", batch: "B-14", grade: "AB", fromZone: "AGL-TEMP-0-0", toZone: "IBERO EXPORT WAREHOUSE-D-04-1", instructedKg: 7528, issuedKg: 7500, receivedKg: 7521.5, receivedOn: "2026-10-30", gainKg: 21.5, missingKg: 0, balanceKg: 28, status: "Pending", ticket: "TN-1", ...o });
  const other = T({ outturn: "52NC0006", batch: "B-2", grade: "AB", issuedKg: 8269, receivedKg: 8263, toZone: "IBERO EXPORT WAREHOUSE-D-04-2", balanceKg: 0, status: "Completed" });
  const tk = (net) => [{ ticket: "TN-1", type: "Inbound", status: "Approved", arrivedOn: "2026-10-30", netKg: net, grossQtyKg: 0, varianceKg: 0, units: 0, vehicle: "", items: [] }];
  const lot = (o) => ({ siteName: "IBERO EXPORT WAREHOUSE", stack: "D-04-1", outturn: "52NC0005", grade: "AB", batch: "B-14", expectedKg: 7521.5, countedKg: 7500, ...o });
  const o = { countDate: "2026-10-31", short: (w) => (w === "IBERO EXPORT WAREHOUSE" ? "Ibero" : w) };
  const e1 = weightLossEvidence(lot({}), [T({}), other], tk(15801.5), o);
  check(e1?.findings.join() === "Receipt over-posted" && e1.text.includes("posted 21.5 kg above what AGL sent (TN-1, 30 Oct)") && e1.text.includes("the same as was sent") && e1.text.includes("no loss on the truck") && e1.text.includes("28 kg of 52NC0005 AB") && e1.text.startsWith("Evidence"), `evidence: receipt over-posted, weighbridge no loss, pocket pending (${e1?.text.slice(0, 80)})`);
  check(!weightLossEvidence(lot({ countedKg: 7450 }), [T({}), other], tk(15801.5), o), "evidence: the shortfall isn't what the receipt is over - nothing proven, no evidence");
  check(!weightLossEvidence(lot({ outturn: "KCS8447", batch: "KCS8447-CLEAN 1", grade: "CLEAN 1", stack: "C-07-1" }), [T({}), other], tk(15801.5), o), "evidence: a lot on no transfer - no evidence");
  const e3 = weightLossEvidence(lot({ expectedKg: 7500, countedKg: 7440 }), [T({ receivedKg: 7500 }), other], tk(15700), o);
  check(e3?.findings.join() === "Lost on the truck" && e3.text.includes("15,700 kg against 15,769 kg sent"), `evidence: the truck weighed less than was sent - lost on the way (${e3?.findings})`);
  const e4 = weightLossEvidence(lot({ expectedKg: 7540, countedKg: 7500 }), [T({ receivedKg: 7540 }), other], tk(15769), o);
  check(e4?.findings.join() === "Receipt over-posted,Receipts above the truck" && e4.text.includes("15,803 kg, 34 kg more than the truck weighed"), `evidence: receipt above what was sent, and receipts above what the truck weighed - both said (${e4?.findings})`);
  check(!weightLossEvidence(lot({}), [T({ receivedOn: "2026-09-15" }), other], tk(15801.5), o), "evidence: a transfer more than 30 days before the count isn't used");
  check(!weightLossEvidence(lot({}), [T({ toZone: "IBERO EXPORT WAREHOUSE-D-04-3" }), other], tk(15801.5), o), "evidence: received on another stack - not this lot's evidence");
}

// The blind recount sheet the warehouse returns.
{
  const head = ["Recount", "Location", "Bay", "Zone", "Outturn", "Grade", "Batch (XBS)", "Full bags", "Pocket kg", "Total kg", "Not found", "Recounted by", "When", "Comment"];
  const r = (name, o, ...fill) => [name, "B-14-2", "B-14", 2, o, "BULK", `${o}-BULK`, ...fill];
  const sheet = [["Blind recount sheet - Monthly Stock Take 31/10/2026"], [], head,
    r("R-001", "KDI6212", 0, 23, 23, "No", "J. Mwangi", "05/11/2026 10:30", ""),
    r("R-002", "51KP0080", 102, 0, 6120, "No", "J. Mwangi", "05/11/2026 10:40", ""),
    r("R-003", "KCS8007", null, null, null, "Yes", "A. Otieno", "05/11/2026 11:00", "not on the stack"),
    r("R-004", "KCS8008", null, null, null, null, null, null, null),
    r("R-005", "KCS8529", 115, 50, 6940, "No", "", "5 Nov", ""),
    r("R-006", "WRONG01", 9, 0, 540, "No", "x", "", ""),
    r("R-007", "KCS8378", 128, 70, null, "No", "x", "", ""),
    ["17 recounts. Return the filled sheet to the stock take team."]];
  const rows = parseRecountSheet(sheet);
  check(rows?.length === 7 && rows[0].pocketKg === 23 && rows[3].fullBags === undefined && rows[2].notFound, "recount sheet: R- rows read, blanks kept as not filled (not 0), Not found");
  const t = (name, outturn, open = true) => ({ id: `id-${name}`, name, outturn, stack: "B-14-2", open, packKg: 60 });
  const targets = [t("R-001", "KDI6212"), t("R-002", "51KP0080", false), t("R-003", "KCS8007"), t("R-004", "KCS8008"), t("R-005", "KCS8529"), t("R-006", "KCS8464"), t("R-007", "KCS8378"), t("R-008", "KDI6082")];
  const p = planRecountAnswers(rows, targets);
  const ans = (n) => p.answers.find((a) => a.recount === n);
  check(ans("R-001")?.units === 1 && ans("R-001").kg === 23 && ans("R-001").at === "2026-11-05T07:30:00.000Z" && ans("R-001").by === "J. Mwangi", "recount sheet: a pocket only is 1 unit, its weight; Nairobi time");
  check(ans("R-003")?.notFound && ans("R-003").units === 0 && ans("R-003").kg === 0 && ans("R-003").comment === "not on the stack", "recount sheet: not found is a 0 line, with the comment");
  check(p.notFilled.join() === "R-004" && !ans("R-004"), "recount sheet: a row nobody filled stays open");
  check(!ans("R-002") && p.notes.some((x) => x.includes("R-002 is already answered")), "recount sheet: an answered recount is not answered twice");
  check(ans("R-005")?.kg === 6940 && p.notes.some((x) => x.includes("R-005") && x.includes("total is used")) && p.notes.some((x) => x.includes("R-005") && x.includes("Recounted by")) && p.notes.some((x) => x.includes("\"5 Nov\"")), "recount sheet: the total is used when it differs from bags x 60 + pocket, with notes (no name, time unreadable)");
  check(p.errors.some((x) => x.includes("WRONG01") && x.includes("KCS8464")) && !ans("R-006"), "recount sheet: an outturn that isn't the recount's is refused");
  check(p.errors.some((x) => x.includes("R-007") && x.includes("70 kg")), "recount sheet: a pocket of a full bag or more is refused");
  check(p.missing.join() === "R-008", "recount sheet: an open recount missing from the sheet is listed");
  check(planRecountAnswers(rows, [t("R-001", "KDI6212")]).errors.some((x) => x.includes("no recount R-003")), "recount sheet: an R-number this stock take doesn't have is refused");
  check(parseRecountSheet([["a", "b"]]) === undefined, "recount sheet: another file isn't read as one");
}

// The 537 in several files (one per month): a line in two files is kept once.
{
  const H = ["Mandant", "FIBU2", "FIBU3", "Kurz-Name", "Profil", "BookDat", "VouchDat", "VouchNo", "Symbol", "P.Ctr.", "Gruppe", "S.Ctr.", "EK-Sack", "EK-KG", "EK 60", "EK-Wert", "VK-Sack", "VK-KG", "VK 60", "VK-Wert", "P.Ctr. Date", "S.Ctr. Date"];
  const L = (day, vouch, pctr, vkKg, value) => ["CC", "D", 1002500, "NKG BERO I", "955", day, day, vouch, 21, pctr, 0, 3787498, 0, 0, 0, 0, vkKg / 60, vkKg, 999, value, 20260617, 20260402];
  const sep = parse537([H, L(20260926, 2608500, 90532, 19200, 101587.97), L(20260930, 2608501, 90536, 19200, 101587.97)]);
  const oct = parse537([H, L(20260930, 2608501, 90536, 19200, 101587.97), L(20261026, 2608594, 90537, 19200, 101587.96), L(20261026, 2608594, 90537, 19200, 101587.96)]);
  check(sep.length === 2 && sep[0].sell60 === 320, "537: 60 kg bags worked out from the kg (the hand-made column, here 999, is ignored)");
  const add = newContractLines(oct, sep);
  check(add.duplicates === 1 && add.fresh.length === 2 && add.fresh.every((l) => l.voucher === "2608594"), "537: a line also in a file already loaded is skipped; a line repeated within one file is kept");
  check(newContractLines(oct, [...sep, ...add.fresh]).fresh.length === 0, "537: loading the same file again adds nothing");
  check(lookbackStart("2026-10-31") === "2026-08-01" && lookbackStart("2026-01-31") === "2025-11-01", "537: the afloat look-back is the month of the count and the two before (across a year end)");
}

// XBS shipped report: the CSV has the SI in its own column, the Excel export inside "SO No.".
{
  const d = new Date("2026-10-12T00:00:00Z");
  const xl = parseShipped([["Stuffing Date", "PO Date", "Reference Contract No.", "SO No.", "Dispatch Batch No.", "Seller", "PO No.", "Parent Batch No.", "Bags", "Qty in Kgs"],
    [d, d, "90497", "3787675 - 5645C ( 5750 )", "KDI6191-BULK", "IBERO KENYA", "12695", "x", 2, 120], [d, d, "90497", "3787675 - 5645A ( 5748 )", "KDI6191-BULK", "IBERO KENYA", "12695", "x", 5, 300]]);
  check(xl?.length === 1 && xl[0].salesContract === "3787675" && xl[0].si === "5645" && xl[0].bags === 7 && xl[0].lots === 2, "shipped report (Excel): contract and SI from \"SO No.\", lots summed per contract + SI + date");
  const csv = parseShipped([["Stuffing Date", "SO No.", "", "Qty in Kgs"], ["21-Sep-26", "3787605", "- 5622 ( 5689 )", "600"]]);
  check(csv?.length === 1 && csv[0].salesContract === "3787605" && csv[0].si === "5622" && csv[0].stuffedOn === "2026-09-21", "shipped report (CSV): SI from the column after \"SO No.\"");
}

console.log("\nPlan (seed " + plan.seed + "):");
for (const r of plan.rows) console.log(`  ${r.name.padEnd(9)} ${String(r.bags).padStart(6)} bags  ${r.areas.map((a) => a.label).join(" · ")}`);
for (const w of plan.warnings) console.log("  note: " + w);
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
