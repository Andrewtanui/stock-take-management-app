// Reads the warehouse's two sub-product registers (Excel), the book side of Ibero's off-system stock -
// Finance's "Subproducts" line on the BRIC bridge. Pure apart from reading the file, so the totals can
// be tested.
// - Sub-products report ("… SUB PRODUCTS REPORT IBERO KENYA"): ex-office sweepings, one row per date
//   and Type 1/2/3 (G-09), and the clean sweepings, one running row (B-14). The workbook keeps old
//   months' sheets and cumulative / bulked summaries; the running sheet is the one with the newest dates.
// - Franchise inventory ("FRANCHISE INVENTORY 2025-2026"): franchise gains per contract and KDI (what is
//   left after a contract is bulked, B-14) and the gains bulked into KIB lots (E/F-13; "Available" or
//   "USED(KDI…)").
// Sep 2026, rows to the 30 Sep count: ex-office 102.30 + sweepings 126 + gains 119.67 + bulked available
// 80 = 427.97, Finance's 428 (the warehouse's own sheet: EX_OFFICE 102, SWEEPINGS 126, FRANCHISE 200).

export type SubProductKind = "Ex-office sweepings" | "Clean sweepings" | "Franchise gains" | "Franchise bulked";
export const SUBPRODUCT_KINDS: SubProductKind[] = ["Ex-office sweepings", "Clean sweepings", "Franchise gains", "Franchise bulked"];
export type SubProductRegister = "Sub-products report" | "Franchise inventory";

export interface SubProductRow {
  kind: SubProductKind;
  /** ISO date the row was booked, if it has one. */
  on?: string;
  /** KDI no. (gains), KIB no. (bulked) or the type ("TYPE 1", "CLEAN SWEEPINGS"). */
  ref: string;
  contract?: string;
  quality?: string;
  bags: number;
  pockets: number;
  kg: number;
  location?: string;
  /** "Awaiting bulking", "Available", "USED(KDI6085)"… */
  status?: string;
  /** Where in the file: sheet and row (1-based). */
  sheet: string;
  row: number;
}

export interface SubProductUpload {
  file: string;
  register: SubProductRegister;
  sheets: string[];
  rows: SubProductRow[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);

/** "16.06.2026", "31.12.20", an Excel date -> ISO; anything else (e.g. a stray serial) -> undefined. */
export function registerDate(c: Cell | undefined) {
  if (c instanceof Date) return isNaN(c.getTime()) || c.getUTCFullYear() < 2000 ? undefined : c.toISOString().slice(0, 10);
  const m = text(c).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return undefined;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) ? d.toISOString().slice(0, 10) : undefined;
}

/** Header columns by name (trimmed, any case); the first match of each. */
function header(r: Cell[]) {
  const h = r.map((c) => text(c).toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.startsWith(n)));
  return { col, isHeader: h.includes("date") && h.some((x) => x.startsWith("kilos")) };
}

/** The running ex-office and sweepings rows of one sheet of the sub-products report. */
function reportSheet(sheet: string, data: Cell[][]): SubProductRow[] {
  const out: SubProductRow[] = [];
  let c: Record<string, number> | undefined;
  data.forEach((r, i) => {
    const h = header(r ?? []);
    if (h.isHeader) {
      c = { date: h.col("date"), desc: h.col("description"), type: h.col("type"), quality: h.col("quality"), bags: h.col("bags"), pkts: h.col("pkts"), kg: h.col("kilos"), loc: h.col("location"), note: h.col("comments") };
      return;
    }
    if (!c) return;
    const desc = text(r?.[c.desc]);
    const kind: SubProductKind | undefined = /clean/i.test(desc) && /sweep/i.test(desc) ? "Clean sweepings" : /ex\s*-?\s*office/i.test(desc) ? "Ex-office sweepings" : undefined;
    const on = registerDate(r?.[c.date]);
    if (!kind || !on || num(r?.[c.kg]) <= 0) return;
    out.push({
      kind,
      on,
      ref: kind === "Clean sweepings" ? "CLEAN SWEEPINGS" : text(r?.[c.type]).toUpperCase().replace(/\s+/g, " "),
      quality: text(r?.[c.quality]) || undefined,
      bags: num(r?.[c.bags]),
      pockets: num(r?.[c.pkts]),
      kg: num(r?.[c.kg]),
      location: text(r?.[c.loc]) || undefined,
      status: text(r?.[c.note]) || undefined,
      sheet,
      row: i + 1,
    });
  });
  return out;
}

/** KDI no. as the warehouse's stocktake sheet writes it: 6088 -> KDI6088, "5390/KCH1002" -> KDI5390. */
const kdi = (c: Cell | undefined) => {
  const d = text(c).match(/\d+/)?.[0];
  return d ? `KDI${d}` : "";
};

/** Franchise gains (KDI) or bulked (KIB) rows of one sheet of the franchise inventory. */
function franchiseSheet(sheet: string, data: Cell[][], kind: "Franchise gains" | "Franchise bulked"): SubProductRow[] {
  const out: SubProductRow[] = [];
  let c: Record<string, number> | undefined;
  data.forEach((r, i) => {
    const h = header(r ?? []);
    if (h.isHeader) {
      c = { date: h.col("date"), contract: h.col("contract no"), ref: h.col(kind === "Franchise gains" ? "kdi no" : "kib no"), quality: h.col("quality"), bags: h.col("bags"), pkts: h.col("pkts"), kg: h.col("kilos"), loc: h.col("location") };
      return;
    }
    if (!c || c.ref < 0) return;
    const on = registerDate(r?.[c.date]);
    const kg = num(r?.[c.kg]);
    if (!on || kg <= 0) return;
    const loc = text(r?.[c.loc]);
    // Bulked lots: the location says "USED(KDI6085)" once used; else the status sits in the next column.
    const status = kind === "Franchise bulked" ? (/^used/i.test(loc) ? loc : text(r?.[c.loc + 1]) || undefined) : undefined;
    out.push({
      kind,
      on,
      ref: kind === "Franchise gains" ? kdi(r?.[c.ref]) : text(r?.[c.ref]).toUpperCase().replace(/\s+/g, ""),
      contract: text(r?.[c.contract]).replace(/\.0+$/, "") || undefined,
      quality: text(r?.[c.quality]) || undefined,
      bags: num(r?.[c.bags]),
      pockets: num(r?.[c.pkts]),
      kg,
      location: /^used/i.test(loc) ? undefined : loc || undefined,
      status,
      sheet,
      row: i + 1,
    });
  });
  return out;
}

/** Either register from its sheets, or null if the workbook is neither. */
export function parseSubProducts(file: string, sheets: { sheet: string; data: Cell[][] }[]): SubProductUpload | null {
  const gains = sheets.filter((s) => /franchise\s+gains/i.test(s.sheet) && !/bulked/i.test(s.sheet));
  const bulked = sheets.filter((s) => /franchise\s+bulked\s*$/i.test(s.sheet.trim()));
  if (gains.length || bulked.length) {
    const rows = [...gains.flatMap((s) => franchiseSheet(s.sheet, s.data, "Franchise gains")), ...bulked.flatMap((s) => franchiseSheet(s.sheet, s.data, "Franchise bulked"))];
    return { file, register: "Franchise inventory", sheets: [...gains, ...bulked].map((s) => s.sheet), rows };
  }
  // The sub-products report: the running sheet is the one with the newest row (old months' sheets and
  // the cumulative / bulked summaries would count the same coffee twice).
  const candidates = sheets
    .filter((s) => !/cumulative|bulked/i.test(s.sheet))
    .map((s) => ({ s, rows: reportSheet(s.sheet, s.data) }))
    .filter((x) => x.rows.length);
  if (!candidates.length) return null;
  const newest = (rows: SubProductRow[]) => rows.reduce((m, r) => (r.on! > m ? r.on! : m), "");
  const best = candidates.sort((a, b) => newest(b.rows).localeCompare(newest(a.rows)))[0];
  return { file, register: "Sub-products report", sheets: [best.s.sheet], rows: best.rows };
}

/** Reads either register from an Excel file. */
export async function readSubProducts(file: File): Promise<SubProductUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  const u = parseSubProducts(file.name, sheets);
  if (!u) throw new Error(`${file.name} doesn't look like the sub-products report or the franchise inventory (no ex-office, sweepings or franchise rows).`);
  if (!u.rows.length) throw new Error(`${file.name} has no rows with a date and kilos.`);
  return u;
}

/** A franchise bulked lot that has been used is no longer stock. */
export const inStock = (r: SubProductRow) => !(r.kind === "Franchise bulked" && /^used/i.test(r.status ?? ""));

/** The book at the count: 60 kg bags per kind, rows dated on or before the count and still in stock. */
export function subProductBook(rows: SubProductRow[], cutOff: string) {
  const book = Object.fromEntries(SUBPRODUCT_KINDS.map((k) => [k, { bags: 0, rows: 0 }])) as Record<SubProductKind, { bags: number; rows: number }>;
  for (const r of rows) {
    if ((r.on && r.on > cutOff) || !inStock(r)) continue;
    book[r.kind].bags += r.kg / 60;
    book[r.kind].rows++;
  }
  for (const k of SUBPRODUCT_KINDS) book[k].bags = Math.round(book[k].bags * 100) / 100;
  return book;
}
