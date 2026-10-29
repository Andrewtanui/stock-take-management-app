// Physical vs XBS vs Comtras for the Reconciliation page, the Overview tile and
// the Sign-off table. Same rules as the Reports page:
//   - quantities in 60 kg equivalents (kg ÷ 60)
//   - only stock that has been counted is compared (submitted Ibero stacks,
//     third-party sites whose count has started); the rest is "not counted",
//     never assumed to match XBS
//   - Comtras is shown only when a Comtras extract is loaded; it is never a
//     copy of XBS
// Physical lots are placed in a basket through their XBS line (batch, else
// outturn); lots XBS doesn't know go to "No basket".

import { allLines, basketMap, comtrasPosition, SITES } from "./repository";
import { comparable, currentCounts } from "./reports";
import type { BasketMap, CountRow, PrimaryBasket, ReconItem, Site, StackInfo, XbsLine } from "./types";

export interface ReconInput {
  counts: CountRow[];
  stacks: StackInfo[];
  baskets?: BasketMap[];
}

/** Comtras quality codes that aren't secondary baskets in the mapping roll up here. */
export const NOT_MAPPED = "Not mapped";

export interface ReconRow {
  key: string;
  label: string;
  primary?: PrimaryBasket | typeof NOT_MAPPED;
  /** XBS for the whole basket / warehouse. */
  xbsWhole: number;
  /** XBS for the part that has been counted — what Physical is compared with. */
  xbs: number;
  physical: number;
  /** Comtras, when an extract is loaded. */
  comtras?: number;
  /** Share of xbsWhole that has been compared (0–1). */
  cover: number;
}

const eq = (kg: number) => kg / 60;
const NO_BASKET = "—";

function prepare(input: ReconInput) {
  const counts = currentCounts(input.counts).filter((c) => !c.other);
  const inScope = comparable(input, counts);
  const byBatch = new Map<string, XbsLine>();
  const byOutturn = new Map<string, XbsLine>();
  for (const l of allLines()) {
    if (!byBatch.has(l.b)) byBatch.set(l.b, l);
    if (!byOutturn.has(l.o)) byOutturn.set(l.o, l);
  }
  const basketOf = (c: CountRow) => (byBatch.get(c.batch) ?? byOutturn.get(c.outturn))?.bc ?? NO_BASKET;
  return { counts, inScope, basketOf };
}

const finish = (r: ReconRow): ReconRow => ({ ...r, cover: r.xbsWhole ? r.xbs / r.xbsWhole : r.physical ? 1 : 0 });

/** Rows by secondary basket and their primary-basket roll-up. */
/**
 * Comtras (BRIC) bags per quality code: Arabica Kenya inventory + longs, as in Finance's
 * "Total BRIC (Comtras)". Undefined until a P526 is loaded for the stock take.
 */
export function comtrasByCode() {
  const p = comtrasPosition();
  if (!p) return undefined;
  const m = new Map<string, number>();
  for (const l of p.lines) if (/kenya/i.test(l.origin) && l.lineType !== "Short") m.set(l.quality, (m.get(l.quality) ?? 0) + l.bags60);
  return m;
}

export function threeWay(input: ReconInput) {
  const { counts, inScope, basketOf } = prepare(input);
  const map = new Map((input.baskets?.length ? input.baskets : basketMap()).map((b) => [b.code, b]));
  const ctr = comtrasByCode();
  const hasComtras = !!ctr;

  const sec = new Map<string, ReconRow>();
  const row = (code: string) => {
    let r = sec.get(code);
    if (!r) {
      const b = map.get(code);
      r = { key: code, label: b ? `${code} ${b.name}` : "No basket", primary: b?.primary ?? "FAQ", xbsWhole: 0, xbs: 0, physical: 0, cover: 0 };
      sec.set(code, r);
    }
    return r;
  };
  for (const l of allLines()) {
    const r = row(l.bc ?? NO_BASKET);
    r.xbsWhole += eq(l.kg);
    if (inScope(l)) r.xbs += eq(l.kg);
  }
  for (const c of counts) row(basketOf(c)).physical += eq(c.kg);
  if (ctr) {
    // Comtras codes with no XBS stock (e.g. the primary codes 10057 / 10027) take their basket from
    // the mapping; codes the mapping doesn't have stay visible as "Not mapped", never dropped.
    for (const code of ctr.keys()) {
      if (sec.has(code)) continue;
      const b = map.get(code);
      sec.set(
        code,
        b
          ? { key: code, label: `${code} ${b.name}`, primary: b.primary, xbsWhole: 0, xbs: 0, physical: 0, cover: 0 }
          : { key: code, label: `${code} (in Comtras, not in the mapping)`, primary: NOT_MAPPED, xbsWhole: 0, xbs: 0, physical: 0, cover: 0 },
      );
    }
    for (const r of sec.values()) r.comtras = ctr.get(r.key) ?? 0;
  }

  const secondary = [...sec.values()].map(finish).sort((a, b) => a.key.localeCompare(b.key));
  const primaries = [...new Set(secondary.map((s) => s.primary!))];
  const primary = primaries.map((p) => {
    const xs = secondary.filter((s) => s.primary === p);
    return finish({
      key: p,
      label: p,
      xbsWhole: sum(xs, (x) => x.xbsWhole),
      xbs: sum(xs, (x) => x.xbs),
      physical: sum(xs, (x) => x.physical),
      comtras: hasComtras ? sum(xs, (x) => x.comtras ?? 0) : undefined,
      cover: 0,
    });
  });
  return { primary, secondary, hasComtras, totals: totalOf(secondary, hasComtras) };
}

/** The outturns behind one secondary basket. */
export function basketLines(input: ReconInput, basket: string) {
  const { counts, inScope, basketOf } = prepare(input);
  const rows = new Map<string, { outturn: string; grade: string; where: string; xbs: number; physical: number; compared: boolean; counted: boolean }>();
  const get = (wh: string, o: string, grade: string, where: string) => {
    const k = `${wh}|${o}`;
    const r = rows.get(k) ?? { outturn: o, grade, where, xbs: 0, physical: 0, compared: false, counted: false };
    rows.set(k, r);
    return r;
  };
  for (const l of allLines()) {
    if ((l.bc ?? NO_BASKET) !== basket) continue;
    const site = SITES.find((s) => s.code === l.wh);
    const r = get(l.wh, l.o, l.i, `${site?.short ?? l.wh}${l.z && l.z !== "TEMP-0-0" ? " " + l.z : ""}`);
    if (inScope(l)) {
      r.xbs += eq(l.kg);
      r.compared = true;
    }
  }
  for (const c of counts) {
    if (basketOf(c) !== basket) continue;
    const site = SITES.find((s) => s.code === c.site);
    const r = get(c.site, c.outturn, c.grade, `${site?.short ?? c.site} ${c.stack}`);
    r.physical += eq(c.kg);
    r.counted = true;
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      note: !r.compared && !r.counted ? "Not counted yet" : r.counted && !r.compared ? "Counted here, XBS has it elsewhere or not at all" : r.compared && !r.counted ? "Expected here, not found" : "",
    }))
    .sort((a, b) => Math.abs(b.physical - b.xbs) - Math.abs(a.physical - a.xbs) || a.outturn.localeCompare(b.outturn));
}

/** Physical vs XBS per warehouse, in units and 60 kg equivalents, for the sign-off table. */
export function byWarehouse(input: ReconInput): { site: Site; status: string; cover: number; xbsWhole: number; xbs: number; physical: number; xbsUnits: number; physUnits: number }[] {
  const { counts, inScope } = prepare(input);
  return SITES.map((s) => {
    const ls = allLines().filter((l) => l.wh === s.code);
    const mine = ls.filter(inScope);
    const cs = counts.filter((c) => c.site === s.code);
    const xbsWhole = eq(sum(ls, (l) => l.kg));
    const xbs = eq(sum(mine, (l) => l.kg));
    const cover = xbsWhole ? xbs / xbsWhole : 0;
    return {
      site: s,
      status: !cs.length && !mine.length ? "Not counted" : cover < 0.995 ? "Partly counted" : "Counted",
      cover,
      xbsWhole,
      xbs,
      physical: eq(sum(cs, (c) => c.kg)),
      xbsUnits: sum(mine, (l) => l.u),
      physUnits: sum(cs, (c) => c.units),
    };
  }).filter((r) => r.xbsWhole > 0 || r.physical > 0);
}

/** Headline: net physical − XBS over the counted stock, and how much of XBS that covers. */
export function netVariance(input: ReconInput) {
  const t = threeWay(input).totals;
  return { ...t, pct: t.xbs ? ((t.physical - t.xbs) / t.xbs) * 100 : 0, counted: t.xbs > 0 || t.physical > 0 };
}

function totalOf(rows: ReconRow[], hasComtras: boolean) {
  const xbsWhole = sum(rows, (r) => r.xbsWhole);
  const xbs = sum(rows, (r) => r.xbs);
  const physical = sum(rows, (r) => r.physical);
  return {
    xbsWhole,
    xbs,
    physical,
    comtras: hasComtras ? sum(rows, (r) => r.comtras ?? 0) : undefined,
    gross: sum(rows, (r) => Math.abs(r.physical - r.xbs)),
    cover: xbsWhole ? xbs / xbsWhole : 0,
  };
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/**
 * Finance's bridge from the Comtras (BRIC) total to the Ibero stock position, in two columns
 * (physical count and XBS), as on the signed month-end page:
 *   Total BRIC - (Ibero count results + coffee afloat) = difference;
 *   difference - reconciling items = the BRIC vs Ibero stock position still unexplained
 *   (Finance's "franchise"). Afloat counts in both columns; an item counts in the XBS column
 *   only when it says so (e.g. Kenyan longs).
 */
export function bricBridge(input: ReconInput, items: ReconItem[]) {
  const ctr = comtrasByCode();
  if (!ctr) return undefined;
  const bric = [...ctr.values()].reduce((a, b) => a + b, 0);
  const sites = byWarehouse(input);
  const counted = { physical: sum(sites, (s) => s.physical), xbs: sum(sites, (s) => s.xbsWhole) };
  const afloatItems = items.filter((i) => i.kind === "Coffee afloat");
  const afloat = sum(afloatItems, (i) => i.bags);
  const totalIbero = { physical: counted.physical + afloat, xbs: counted.xbs + afloat };
  const difference = { physical: bric - totalIbero.physical, xbs: bric - totalIbero.xbs };
  const recon = items.filter((i) => i.kind === "Reconciling item");
  const itemsTotal = { physical: sum(recon, (i) => i.bags), xbs: sum(recon.filter((i) => i.inXbs), (i) => i.bags) };
  const position = { physical: difference.physical - itemsTotal.physical, xbs: difference.xbs - itemsTotal.xbs };
  return { bric, sites, counted, afloatItems, afloat, totalIbero, difference, recon, itemsTotal, position };
}
