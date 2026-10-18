// Random, balanced counter allocation. Pure - no data access - so it can be
// tested and the same inputs + seed always give the same plan (audit).
//
// 1. Areas from the stock take's XBS lines, weighted by expected bags:
//    Ibero rows, the stacks between two rows, each third-party site.
// 2. Anything bigger than a fair share is split: a row into bay sections, a
//    third-party site into team places (several counters, same site).
// 3. Biggest area first goes to the eligible counter with the least work;
//    the counter order is shuffled with the seed, so ties fall randomly.
//    Hard rules: no home rows / home warehouse, third parties only for counters
//    cleared to travel. Soft rule: avoid last stock take's area (rotation).
//    Soft rule: keep each counter at one warehouse where the workload allows.
// 4. Many random attempts; the best wins: nothing unassigned, fewest rotation
//    repeats, fewest people at two warehouses, then the most even workload.

import { IBERO_BAYS, IBERO_ROWS, parseZone, sectionRows, sectionToken, sortSections } from "../shared/sections";
import type { SiteCode } from "./types";

export interface AllocLine {
  wh: SiteCode;
  z?: string;
  bg: number;
}

export interface AllocCounter {
  id: string;
  name: string;
  /** Rows they work in day to day (never allocated to them when the rule is on). */
  homeRows?: string[];
  /** Their own warehouse; a third-party site here is not allocated to them. */
  homeSite?: SiteCode;
  /** May go to third-party sites. Undefined = no profile yet (allowed, flagged). */
  thirdPartyOk?: boolean;
  /** Area keys they had last stock take ("IBR:D1-7", "AGL"). */
  lastAreas?: string[];
  /** True when the counter has no profile: rules needing one are skipped. */
  noProfile?: boolean;
  /** Keeps the areas in `fixed` but gets nothing new (e.g. left early, during a rebalance). */
  closed?: boolean;
}

export interface AllocRules {
  homeArea: boolean;
  rotation: boolean;
  thirdPartyClearance: boolean;
}

export interface Area {
  /** "IBR:D1-7", "IBR:C/D", "AGL", "AGL#2" (second place in a team at AGL). */
  key: string;
  site: SiteCode;
  /** Section token at Ibero; empty for a third-party site (whole site). */
  section: string;
  bags: number;
  label: string;
}

export interface PlanRow {
  counterId: string;
  name: string;
  areas: Area[];
  bags: number;
}

export interface Plan {
  seed: number;
  rows: PlanRow[];
  unassigned: Area[];
  /** (busiest − lightest) ÷ average, in %. */
  spreadPct: number;
  rotationRepeats: number;
  /** Counters who have areas at more than one warehouse. */
  multiSite: number;
  warnings: string[];
  rules: AllocRules;
}

/* ---------- seeded random (mulberry32) ---------- */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rand: () => number) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- areas ---------- */

/** Bags per bay for each Ibero row and each between-rows pair, from XBS. */
function iberoBays(lines: AllocLine[]) {
  const units = new Map<string, { row: string; rowTo: string; bays: number[] }>();
  for (const l of lines) {
    if (l.wh !== "IBR" || !l.z) continue;
    const z = parseZone(l.z);
    if (!z) continue;
    const k = `${z.row}/${z.rowTo}`;
    const u = units.get(k) ?? { row: z.row, rowTo: z.rowTo, bays: Array(IBERO_BAYS + 1).fill(0) };
    u.bays[z.bay] += l.bg; // a stack counts in its first bay - the same rule sections use
    units.set(k, u);
  }
  return [...units.values()].sort((a, b) => IBERO_ROWS.indexOf(a.row) - IBERO_ROWS.indexOf(b.row) || (a.row === a.rowTo ? -1 : 1));
}

/** Splits bays 1–14 into `parts` contiguous ranges with roughly equal bags. */
function splitBays(bays: number[], parts: number) {
  const total = bays.reduce((a, b) => a + b, 0);
  const out: { from: number; to: number; bags: number }[] = [];
  let from = 1;
  let acc = 0;
  for (let b = 1; b <= IBERO_BAYS; b++) {
    acc += bays[b];
    const left = parts - out.length;
    if (left > 1 && acc >= total / parts && b < IBERO_BAYS) {
      out.push({ from, to: b, bags: acc });
      from = b + 1;
      acc = 0;
    }
  }
  out.push({ from, to: IBERO_BAYS, bags: acc });
  return out.filter((r) => r.bags > 0);
}

const words = (site: SiteCode, section: string, siteName: (c: SiteCode) => string) => {
  if (site !== "IBR") return siteName(site);
  const s = section.match(/^([A-G])(?:\/([A-G]))?(?:(\d+)-(\d+))?$/);
  if (!s) return section;
  const rows = s[2] ? `Ibero between rows ${s[1]} and ${s[2]}` : `Ibero row ${s[1]}`;
  return s[3] ? `${rows}, bays ${s[3]}–${s[4]}` : rows;
};

/** The areas to hand out, split so none is much bigger than a fair share. */
export function buildAreas(lines: AllocLine[], counters: number, thirdParty: Set<SiteCode>, siteName: (c: SiteCode) => string): Area[] {
  const total = lines.reduce((a, l) => a + l.bg, 0);
  const fair = counters > 0 ? total / counters : total;
  const areas: Area[] = [];
  for (const u of iberoBays(lines)) {
    const bags = u.bays.reduce((a, b) => a + b, 0);
    if (!bags) continue;
    const parts = Math.max(1, Math.min(IBERO_BAYS, Math.ceil(bags / (fair * 1.15))));
    for (const r of splitBays(u.bays, parts)) {
      const section = parts === 1 ? sectionToken(u.row, u.rowTo) : sectionToken(u.row, u.rowTo, r.from, r.to);
      areas.push({ key: `IBR:${section}`, site: "IBR", section, bags: r.bags, label: words("IBR", section, siteName) });
    }
  }
  const bySite = new Map<SiteCode, number>();
  for (const l of lines) if (thirdParty.has(l.wh)) bySite.set(l.wh, (bySite.get(l.wh) ?? 0) + l.bg);
  for (const [site, bags] of bySite) {
    if (!bags) continue;
    // Nearest whole team: rounding up would leave every site counter lighter than the rest.
    const team = Math.max(1, Math.round(bags / fair));
    for (let i = 1; i <= team; i++)
      areas.push({ key: i === 1 ? site : `${site}#${i}`, site, section: "", bags: bags / team, label: team > 1 ? `${siteName(site)} (team of ${team})` : siteName(site) });
  }
  return areas;
}

/* ---------- allocation ---------- */

const baseKey = (a: Area) => a.key.replace(/#\d+$/, "");

function eligible(c: AllocCounter, a: Area, rules: AllocRules, thirdParty: Set<SiteCode>) {
  if (rules.homeArea && !c.noProfile) {
    // Home rows are Ibero rows; they apply unless the counter's home warehouse is a third party.
    if (a.site === "IBR" && (c.homeSite ?? "IBR") === "IBR" && sectionRows(a.section).some((r) => c.homeRows?.includes(r))) return false;
    if (a.site !== "IBR" && c.homeSite === a.site) return false;
  }
  if (rules.thirdPartyClearance && thirdParty.has(a.site) && c.thirdPartyOk === false) return false;
  return true;
}

function attempt(areas: Area[], counters: AllocCounter[], rules: AllocRules, thirdParty: Set<SiteCode>, seed: number, fixed: Map<string, Area[]>) {
  const rand = rng(seed);
  const order = shuffle(counters, rand);
  const load = new Map(order.map((c) => [c.id, (fixed.get(c.id) ?? []).reduce((s, a) => s + a.bags, 0)]));
  const given = new Map(order.map((c) => [c.id, [...(fixed.get(c.id) ?? [])]]));
  const unassigned: Area[] = [];
  let repeats = 0;
  // Slack for keeping someone at one warehouse: a quarter of a fair share.
  const slack = (areas.reduce((s, a) => s + a.bags, 0) / Math.max(1, counters.length)) * 0.25;
  // Biggest first; equal sizes in random order.
  const queue = shuffle(areas, rand).sort((a, b) => b.bags - a.bags);
  for (const a of queue) {
    const ok = order.filter((c) => !c.closed && eligible(c, a, rules, thirdParty) && !given.get(c.id)!.some((g) => baseKey(g) === baseKey(a)));
    if (!ok.length) {
      unassigned.push(a);
      continue;
    }
    const fresh = rules.rotation ? ok.filter((c) => !c.lastAreas?.includes(baseKey(a))) : ok;
    const pool = fresh.length ? fresh : ok;
    if (rules.rotation && !fresh.length) repeats++;
    // Prefer counters already at this warehouse (or with nothing yet), so nobody travels
    // between sites mid-count - unless that would load them far more than the lightest.
    const min = Math.min(...pool.map((c) => load.get(c.id)!));
    const sameSite = pool.filter((c) => given.get(c.id)!.every((g) => g.site === a.site));
    const sameMin = sameSite.length ? Math.min(...sameSite.map((c) => load.get(c.id)!)) : Infinity;
    const from = sameMin <= min + slack ? sameSite : pool;
    const best = Math.min(...from.map((c) => load.get(c.id)!));
    const pick = from.find((c) => load.get(c.id)! === best)!; // `order` is shuffled, so ties are random
    given.get(pick.id)!.push(a);
    load.set(pick.id, load.get(pick.id)! + a.bags);
  }
  const loads = order.filter((c) => !c.closed).map((c) => load.get(c.id)!);
  const avg = loads.reduce((s, x) => s + x, 0) / Math.max(1, loads.length);
  const spreadPct = avg ? ((Math.max(...loads) - Math.min(...loads)) / avg) * 100 : 0;
  const multiSite = order.filter((c) => new Set(given.get(c.id)!.map((g) => g.site)).size > 1).length;
  return { order, given, load, unassigned, repeats, spreadPct, multiSite };
}

/**
 * Allocates areas to the counters present. `fixed` keeps areas already
 * handed out (e.g. counted ones during a rebalance) with their counter.
 */
export function allocate(input: {
  lines: AllocLine[];
  counters: AllocCounter[];
  rules: AllocRules;
  thirdParty: Set<SiteCode>;
  siteName: (c: SiteCode) => string;
  seed?: number;
  attempts?: number;
  /** Areas to hand out instead of building them from the lines (rebalance). */
  areas?: Area[];
  fixed?: { counterId: string; area: Area }[];
}): Plan {
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rules = input.rules;
  const warnings: string[] = [];
  if (!input.counters.length) return { seed, rows: [], unassigned: [], spreadPct: 0, rotationRepeats: 0, multiSite: 0, warnings: ["No counters present."], rules };
  const areas = input.areas ?? buildAreas(input.lines, input.counters.length, input.thirdParty, input.siteName);
  const fixed = new Map<string, Area[]>();
  for (const f of input.fixed ?? []) fixed.set(f.counterId, [...(fixed.get(f.counterId) ?? []), f.area]);

  // Many tries from one seed; keep the most even plan (fewest rotation repeats on a tie).
  const tries = input.attempts ?? 200;
  const next = rng(seed);
  let best: (ReturnType<typeof attempt> & { seed: number }) | null = null;
  for (let i = 0; i < tries; i++) {
    const s = i === 0 ? seed : Math.floor(next() * 2 ** 31);
    const r = attempt(areas, input.counters, rules, input.thirdParty, s, fixed);
    // Unassigned areas worst, then rotation repeats, then people at two warehouses, then unevenness.
    const score = (x: typeof r) => x.unassigned.length * 1e6 + x.repeats * 1e3 + x.multiSite * 15 + x.spreadPct;
    if (!best || score(r) < score(best)) best = { ...r, seed: s };
  }
  const b = best!;
  for (const c of input.counters) if (c.noProfile) warnings.push(`${c.name} has no counter profile: home-area and third-party rules weren't applied to them.`);
  if (b.unassigned.length) warnings.push(`${b.unassigned.length} area(s) had no eligible counter: ${b.unassigned.map((a) => a.label).join(", ")}.`);
  if (b.repeats) warnings.push(`${b.repeats} area(s) went to someone who had them last time (no one else was eligible).`);
  if (b.multiSite) warnings.push(`${b.multiSite} counter(s) work at two warehouses, to keep the workload even.`);
  const rows: PlanRow[] = b.order
    .map((c) => ({ counterId: c.id, name: c.name, areas: b.given.get(c.id)!, bags: Math.round(b.load.get(c.id)!) }))
    .sort((x, y) => x.name.localeCompare(y.name));
  return { seed: b.seed, rows, unassigned: b.unassigned, spreadPct: Math.round(b.spreadPct * 10) / 10, rotationRepeats: b.repeats, multiSite: b.multiSite, warnings, rules };
}

/** Rules a set of areas breaks for a counter (used to flag a supervisor's swap). */
export function ruleBreaks(c: AllocCounter, areas: Area[], rules: AllocRules, thirdParty: Set<SiteCode>) {
  const out: string[] = [];
  for (const a of areas) {
    if (!eligible(c, a, { ...rules, thirdPartyClearance: false }, thirdParty)) out.push(`${a.label} is ${c.name}'s home area`);
    else if (!eligible(c, a, rules, thirdParty)) out.push(`${c.name} isn't cleared for third-party sites (${a.label})`);
    else if (rules.rotation && c.lastAreas?.includes(baseKey(a))) out.push(`${c.name} had ${a.label} last time`);
  }
  return out;
}

/** The assignment fields for one counter's areas at one site. */
export function assignmentFor(areas: Area[]) {
  const sections = sortSections([...new Set(areas.filter((a) => a.site === "IBR").map((a) => a.section))]);
  return { sections: sections.join(","), bags: Math.round(areas.reduce((s, a) => s + a.bags, 0)) };
}

/**
 * Who does a blind recount: a different counter, present today, not the one who
 * counted, not someone whose home area it is (and cleared for third parties).
 * Fewest open recounts first, so the load is spread; then random.
 */
export function pickRecounter(o: {
  site: SiteCode;
  stack: string;
  exclude: string[];
  counters: AllocCounter[];
  openRecounts: Record<string, number>;
  rules: AllocRules;
  thirdParty: Set<SiteCode>;
  rand?: () => number;
}): AllocCounter | undefined {
  const z = o.site === "IBR" ? parseZone(o.stack) : null;
  const area: Area = { key: "", site: o.site, section: z ? sectionToken(z.row, z.rowTo) : "", bags: 0, label: o.stack || o.site };
  const ok = o.counters.filter((c) => !o.exclude.includes(c.id) && eligible(c, area, o.rules, o.thirdParty));
  if (!ok.length) return undefined;
  const least = Math.min(...ok.map((c) => o.openRecounts[c.id] ?? 0));
  const pool = ok.filter((c) => (o.openRecounts[c.id] ?? 0) === least);
  return pool[Math.floor((o.rand ?? Math.random)() * pool.length)];
}
