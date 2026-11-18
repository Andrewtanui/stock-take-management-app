// Quick check of rebalanceAllocation: the dev screenshot bug (row B, 3 present, nothing counted)
// must now split evenly with nobody idle; and a mid-row handoff must re-share only the unreached bays.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const out = await build({
  stdin: { contents: `export * from "./src/data/allocate"; export * from "./src/shared/sections";`, resolveDir: fileURLToPath(root), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { rebalanceAllocation, allocate, parseZone } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const snap = JSON.parse(readFileSync(new URL("../src/data/xbs-2026-03-02.json", import.meta.url), "utf8"));
const all = (Array.isArray(snap) ? snap : snap.lines ?? Object.values(snap).find(Array.isArray)).filter((l) => l.t === "W" || l.t === "B");
// Scope = Ibero row B only (the dev screenshot's ad-hoc scope).
const lines = all.filter((l) => l.wh === "IBR" && typeof l.z === "string" && parseZone(l.z)?.row === "B" && parseZone(l.z)?.rowTo === "B").map((l) => ({ wh: l.wh, z: l.z, bg: l.bg }));
const thirdParty = new Set(["AGL", "KPCU", "MAXA", "MCF", "KCCE"]);
const siteName = (c) => ({ IBR: "Ibero" })[c] ?? c;
const RULES = { homeArea: false, rotation: false, thirdPartyClearance: true };
const nameOf = (id) => ({ c1: "Andrew", c2: "William", c3: "Jones" })[id] ?? id;
const present = [
  { id: "c1", name: "Andrew", homeSite: "IBR", thirdPartyOk: true },
  { id: "c2", name: "William", homeSite: "IBR", thirdPartyOk: true },
  { id: "c3", name: "Jones", homeSite: "IBR", thirdPartyOk: true },
];
const show = (p) => p.rows.map((r) => `${r.name.padEnd(8)} ${String(r.bags).padStart(5)}  ${r.areas.map((a) => a.section || a.site).join(",") || "—"}`).join("\n");
const totalB = lines.reduce((s, l) => s + l.bg, 0);
console.log(`Row B scope: ${lines.length} lines, ${Math.round(totalB)} bags, bays:`, [...new Set(lines.map((l) => parseZone(l.z).bay))].sort((a, b) => a - b).join(","));

console.log("\n== Case 1: nothing counted, 3 present (the bug) ==");
const p1 = rebalanceAllocation({ lines, counts: [], present, nameOf, rules: RULES, thirdParty, siteName, seed: 1 });
console.log(show(p1));
console.log(`spread ${p1.spreadPct}%  | idle counters: ${p1.rows.filter((r) => r.bags === 0).length}`);

console.log("\n== Case 2: mid-row handoff — Andrew counted bays 1-4, then leaves ==");
const counted = lines.filter((l) => parseZone(l.z).bay <= 4).map((l) => ({ counterId: "c1", site: "IBR", zone: l.z }));
const p2 = rebalanceAllocation({ lines, counts: counted, present: present.filter((c) => c.id !== "c1"), nameOf, rules: RULES, thirdParty, siteName, seed: 1 });
console.log(show(p2));
console.log(`spread ${p2.spreadPct}%  (Andrew gone: keeps bays 1-4, unreached bays shared by William + Jones)`);
