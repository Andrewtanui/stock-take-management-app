// Level 2 reconciling items from the count: every lot's difference against XBS sorted into the items
// Finance puts on the BRIC bridge, by rules worked back from her August and September 2026 bridges.
// Pure, so the figures can be tested. Used by bridge-proposals.ts.
//
// Each lot (warehouse + outturn + grade) is netted over its variances first: Level 1 judges Ibero
// per stack, and a lot moved between stacks is no difference. Then, first match wins (bags = XBS
// less counted, 60 kg; positive = XBS has more):
// 1. Direct-sale lot not found at a third party (batch "…-DS10282-…"), in stock RECENT_DAYS or
//    less: received after that warehouse's count. BRIC holds it as longs, so it comes off the
//    longs. Aug: AGL 773.21 (exact).
// 2. A grade not found whose outturn was counted a bag or more over under another grade: the
//    same coffee entered under the wrong grade - a count error (6).
// 3. Lot from the latest auction sale not found at a third party: sold, not yet delivered or
//    collected. Aug: Sale 37 1,719.78 = Finance's 1,663.57 plus two AGL cases she split out by
//    hand (in Maxa 23.55, broker's account 32.67).
// 4. Blocked lot of LARGE bags or more not found: XBS still holds stock that is gone - an XBS data
//    correction. Aug and Sep: 19IM0001 29.57 (Finance 30).
// 5. Blocked lot under LARGE bags not found: residues - short weights. Aug 16.70 (Finance 17.65).
// 6. Counted, not in XBS (and no other grade of the outturn there): a typing error (Aug KC8181 for
//    KCS8181) or coffee off system. Finance: "duplicates in physical count" in Sep (68), franchise
//    off system in Aug - hers to call.
// 7. Anything else a bag or more apart: a count error to recount. Sep 6 (5.92); Aug 42KN0030
//    entered as 56 bags at 11 kg.
// Under a bag on a lot that was counted is weight: not an item, it stays in the franchise.

import type { SiteCode, Variance, XbsLine } from "./types";

/** Bags at or above which a blocked lot not found is a data correction, not short weight. */
export const LARGE = 5;

export type CountItemKind = "Direct sale not counted" | "Sale not delivered" | "Data correction" | "Short weights" | "Counted, not in XBS" | "Count error";

export interface CountItem {
  kind: CountItemKind;
  /** Label on the bridge, e.g. "Sale 37 not delivered (AGL, KPCU)". */
  label: string;
  /** 60 kg bags, positive when XBS holds more than was counted. */
  bags: number;
  lots: { site: SiteCode; outturn: string; grade: string; bags: number; batch?: string }[];
  /** Also an item in the XBS column: none of these are (they are count against XBS). */
  inXbs: false;
}

/** Days in stock up to which a direct-sale lot not found counts as received after the count. Aug: 1-4 days. */
export const RECENT_DAYS = 7;

/** Auction sale or direct sale in a batch number: "2025/2026-37-6723-KARII" -> "37", "…-DS10282-8-THIMU" -> "DS10282". */
export function saleOf(batch: string) {
  return batch.match(/^\d{4}\/\d{4}-(DS\d+|\d+)-/)?.[1];
}
/** Crop year and auction sale as one sortable number: "2025/2026-37-…" -> 2025037. */
const saleRank = (batch: string) => {
  const m = batch.match(/^(\d{4})\/\d{4}-(\d+)-/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : undefined;
};

const up = (x: string) => x.trim().toUpperCase();
/** "AA · THIMU" (as Level 1 stores it) -> "AA". */
const gradeOf = (g: string) => g.split(" · ")[0];
const key = (site: string, outturn: string, grade: string) => `${site}|${up(outturn)}|${up(gradeOf(grade))}`;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** One lot's difference: Level 1 judges Ibero per stack, so a lot moved between stacks nets out here. */
interface Lot {
  site: SiteCode;
  outturn: string;
  grade: string;
  batch?: string;
  expectedKg: number;
  countedKg: number;
}

/**
 * The count's reconciling items. `variances` = the lot differences from Level 1 (all states: a lot
 * still open is still a difference); `lines` = the stock take's XBS snapshot; `thirdParty` = codes.
 */
export function countItems(variances: Variance[], lines: XbsLine[], thirdParty: Set<SiteCode>): CountItem[] {
  const xbs = new Map<string, XbsLine[]>();
  const byBatch = new Map<string, XbsLine[]>();
  for (const l of lines) {
    xbs.set(key(l.wh, l.o, l.i), [...(xbs.get(key(l.wh, l.o, l.i)) ?? []), l]);
    byBatch.set(`${l.wh}|${up(l.b)}`, [...(byBatch.get(`${l.wh}|${up(l.b)}`) ?? []), l]);
  }
  const linesOf = (lot: Pick<Lot, "site" | "outturn" | "grade" | "batch">) =>
    (lot.batch && byBatch.get(`${lot.site}|${up(lot.batch)}`)) || xbs.get(key(lot.site, lot.outturn, lot.grade)) || [];

  // Net each lot's variances (batch where known, else outturn + grade).
  const lots = new Map<string, Lot>();
  for (const v of variances) {
    const ls = linesOf(v);
    const k = key(v.site, v.outturn, v.grade);
    const lot = lots.get(k) ?? { site: v.site, outturn: v.outturn, grade: gradeOf(v.grade), batch: ls[0]?.b ?? v.batch, expectedKg: 0, countedKg: 0 };
    lot.expectedKg += v.expectedKg ?? v.expected * 60;
    lot.countedKg += v.countedKg ?? v.counted * 60;
    lots.set(k, lot);
  }
  // The latest auction sale in the snapshot (newest crop year, highest sale): its lots are the ones
  // still being delivered.
  const ranks = lines.map((l) => saleRank(l.b)).filter((r): r is number => r !== undefined);
  const latest = ranks.length ? Math.max(...ranks) : undefined;

  const groups = new Map<string, Omit<CountItem, "label"> & { sites: Set<string>; sale?: string }>();
  const add = (kind: CountItemKind, v: Lot, bags: number, batch?: string, sale?: string) => {
    const g = groups.get(kind) ?? { kind, bags: 0, lots: [], inXbs: false as const, sites: new Set<string>(), sale };
    g.bags += bags;
    g.sites.add(v.site);
    g.lots.push({ site: v.site, outturn: v.outturn, grade: v.grade, bags: r2(bags), batch });
    groups.set(kind, g);
  };

  const outturns = new Set(lines.map((l) => `${l.wh}|${up(l.o)}`));
  // Outturns counted over XBS under some grade (or under a grade XBS doesn't have there): a grade of
  // the same outturn "not found" is most likely that coffee, entered under the wrong grade.
  const countedOtherGrade = new Set([...lots.values()].filter((v) => v.countedKg - v.expectedKg >= 60).map((v) => `${v.site}|${up(v.outturn)}`));

  for (const v of lots.values()) {
    const bags = (v.expectedKg - v.countedKg) / 60;
    const notFound = v.countedKg <= 0;
    // Under a bag is weight, except a lot not found at all (residues are Finance's short weights).
    if (Math.abs(bags) < 0.01 || (Math.abs(bags) < 1 && !notFound)) continue;
    const ls = linesOf(v);
    const batch = ls[0]?.b;
    const sale = batch ? saleOf(batch) : undefined;
    const tp = thirdParty.has(v.site);
    const recent = ls.some((l) => typeof l.d === "number" && l.d <= RECENT_DAYS);
    const otherGrade = outturns.has(`${v.site}|${up(v.outturn)}`);
    if (!ls.length || v.expectedKg <= 0) add(otherGrade ? "Count error" : "Counted, not in XBS", v, bags, v.batch);
    // A direct-sale lot that arrived days ago was not there to count: that beats a grade mix-up.
    else if (notFound && tp && sale?.startsWith("DS") && recent) add("Direct sale not counted", v, bags, batch);
    else if (notFound && countedOtherGrade.has(`${v.site}|${up(v.outturn)}`)) add("Count error", v, bags, batch);
    else if (notFound && tp && latest !== undefined && saleRank(batch!) === latest) add("Sale not delivered", v, bags, batch, sale);
    else if (notFound && ls.some((l) => l.bl)) add(bags >= LARGE ? "Data correction" : "Short weights", v, bags, batch);
    else add("Count error", v, bags, batch);
  }

  const ORDER: CountItemKind[] = ["Direct sale not counted", "Sale not delivered", "Data correction", "Short weights", "Counted, not in XBS", "Count error"];
  return ORDER.flatMap((kind) => {
    const g = groups.get(kind);
    if (!g || Math.abs(g.bags) < 0.01) return [];
    const where = [...g.sites].sort().join(", ");
    const label =
      kind === "Direct sale not counted"
        ? `Direct-sale lots not counted, received after the count (${where})`
        : kind === "Sale not delivered"
          ? `Sale ${g.sale} not delivered (${where})`
          : kind === "Data correction"
            ? `XBS data correction: ${g.lots.map((l) => l.outturn).join(", ")}`
            : kind === "Short weights"
              ? `Short weights (${where})`
              : kind === "Counted, not in XBS"
                ? `Counted, not in XBS (${where})`
                : `Count errors to recount (${where})`;
    return [{ kind, label, bags: r2(g.bags), lots: g.lots.sort((a, b) => Math.abs(b.bags) - Math.abs(a.bags)), inXbs: false as const }];
  });
}
