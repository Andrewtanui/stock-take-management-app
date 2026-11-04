// Sub-products (Ibero's off-system stock): the warehouse's registers against what was counted, per kind
// and per lot, and the figure for Finance's "Subproducts" line on the BRIC bridge. Pure, so the figures
// can be tested. Used by Reconciliation (panel and bridge proposal).
//
// Count side: "other stock" lines from the counter app - Ex-office stock (grade = TYPE 1-3), Sweepings,
// Franchise (outturn = KDI no. for gains, KIB no. for bulked). Book side: subproducts-parse.ts.
// The line is the register's book, as Finance takes it (Sep 2026: 427.97 for her 428); the count checks it.

import { SUBPRODUCT_KINDS, inStock, type SubProductKind, type SubProductRow } from "./subproducts-parse";
import { currentCounts } from "./reports";
import type { Check, CountRow } from "./types";

export interface SubProductLot {
  kind: SubProductKind;
  /** KDI / KIB no., TYPE 1-3 or CLEAN SWEEPINGS. */
  ref: string;
  bookKg: number;
  countedKg: number;
  location?: string;
  /** Register status ("Awaiting bulking", "Available"). */
  status?: string;
}

const up = (x: string) => x.trim().toUpperCase().replace(/\s+/g, " ");

/** The sub-product kind of a counted line, or undefined for other stock that isn't one. */
export function kindOf(c: Pick<CountRow, "other" | "category" | "outturn">): SubProductKind | undefined {
  if (!c.other) return undefined;
  if (c.category === "Ex-office stock") return "Ex-office sweepings";
  if (c.category === "Sweepings") return "Clean sweepings";
  if (c.category === "Franchise") return /^KIB/i.test(c.outturn) ? "Franchise bulked" : "Franchise gains";
  return undefined;
}

/** The lot a line or register row belongs to: per KDI/KIB for franchise, per type for ex-office, one for sweepings. */
const refOf = (kind: SubProductKind, ref: string) => (kind === "Clean sweepings" ? "CLEAN SWEEPINGS" : up(ref).replace(/^(KDI|KIB) /, "$1"));

export function compareSubProducts(rows: SubProductRow[], counts: CountRow[], cutOff?: string) {
  const lots = new Map<string, SubProductLot>();
  const lot = (kind: SubProductKind, ref: string) => {
    const k = `${kind}|${refOf(kind, ref)}`;
    const x = lots.get(k) ?? { kind, ref: refOf(kind, ref), bookKg: 0, countedKg: 0 };
    lots.set(k, x);
    return x;
  };
  for (const r of rows) {
    if ((cutOff && r.on && r.on > cutOff) || !inStock(r)) continue;
    const x = lot(r.kind, r.ref);
    x.bookKg += r.kg;
    x.location ??= r.location;
    x.status ??= r.status;
  }
  let counted = 0;
  for (const c of currentCounts(counts)) {
    const kind = kindOf(c);
    if (!kind) continue;
    lot(kind, kind === "Ex-office sweepings" ? c.grade : c.outturn).countedKg += c.kg;
    counted++;
  }
  const all = [...lots.values()].sort((a, b) => SUBPRODUCT_KINDS.indexOf(a.kind) - SUBPRODUCT_KINDS.indexOf(b.kind) || a.ref.localeCompare(b.ref));
  const kinds = SUBPRODUCT_KINDS.map((kind) => {
    const xs = all.filter((x) => x.kind === kind);
    return { kind, book: xs.reduce((a, x) => a + x.bookKg, 0) / 60, counted: xs.reduce((a, x) => a + x.countedKg, 0) / 60, lots: xs.length };
  });
  const book = kinds.reduce((a, k) => a + k.book, 0);
  return { kinds, lots: all, book, counted: kinds.reduce((a, k) => a + k.counted, 0), countLines: counted, hasBook: rows.length > 0 };
}

/** Days a sub-product may wait to be bulked or sold before it is flagged (setting SubProductAgeDays; D6). */
export const SUBPRODUCT_AGE_DEFAULT = 90;

/**
 * Pre-count checks on the registers: franchise gains not bulked, bulked franchise lots not sold and
 * ex-office sweepings not bulked, each older than `limit` days at `today` (Sep 2026: all 80 bulked bags
 * "Available" since Feb-Jun; KDI5390 a gain since Oct 2025).
 */
export function subProductChecks(rows: SubProductRow[], today: string, limit = SUBPRODUCT_AGE_DEFAULT): Check[] {
  const age = (r: SubProductRow) => (r.on ? Math.round((Date.parse(today) - Date.parse(r.on)) / 86_400_000) : 0);
  const old = (kind: SubProductKind) => rows.filter((r) => r.kind === kind && r.on && r.on <= today && inStock(r) && age(r) > limit).sort((a, b) => age(b) - age(a));
  const bags = (rs: SubProductRow[]) => Math.round(rs.reduce((a, r) => a + r.kg, 0) / 60);
  const rowsOf = (rs: SubProductRow[]) =>
    rs.map((r) => ({ ref: r.ref, where: r.location ?? "", info: `${age(r)} days · ${r.on}${r.contract ? ` · contract ${r.contract}` : ""}${r.status ? ` · ${r.status}` : ""}`, bags: Math.round((r.kg / 60) * 100) / 100 }));
  const gains = old("Franchise gains");
  const bulked = old("Franchise bulked");
  const ex = old("Ex-office sweepings");
  return [
    {
      id: "franchise-gains", severity: "low", owner: "Warehouse",
      title: `Franchise gains not bulked in ${limit} days`,
      detail: "Left over from contracts long gone, still in the franchise register. Bulk them, or find out why they are held.",
      count: gains.length, bags: bags(gains), unit: "lots", rows: rowsOf(gains),
    },
    {
      id: "franchise-bulked", severity: "low", owner: "Trading",
      title: `Bulked franchise lots unsold for ${limit} days`,
      detail: "KIB lots of franchise gains marked Available. Sell or use them, so they stop sitting off system.",
      count: bulked.length, bags: bags(bulked), unit: "lots", rows: rowsOf(bulked),
    },
    {
      id: "ex-office", severity: "low", owner: "Quality",
      title: `Ex-office sweepings awaiting bulking for ${limit} days`,
      detail: "Graded Type 1-3 and waiting at G-09. Bulk them with Quality, so the sub-products report stays short.",
      count: ex.length, bags: bags(ex), unit: "rows", rows: rowsOf(ex),
    },
  ];
}
