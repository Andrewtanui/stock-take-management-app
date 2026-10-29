// Reads XBS's "All Party Shipped Quantity Per Contract" report (CSV or Excel): one line per lot
// stuffed into a container, with the stuffing date, the sales contract (SO No.) and the shipping
// instruction. Summed here per sales contract + SI + stuffing date - the warehouse's own record of
// when coffee left, which corrects the shipment tracker (Sep 2026: 3787605 keyed 18 Aug in the
// tracker, stuffed 21 Sep in XBS). Pure apart from reading the file, so the totals can be tested.

export interface XbsStuffing {
  salesContract: string;
  /** Shipping instruction number ("- 5622 ( 5689 )" -> "5622"). */
  si: string;
  /** ISO date. */
  stuffedOn: string;
  /** 60 kg bags (kg / 60). */
  bags: number;
  lots: number;
}

export interface XbsStuffingUpload {
  file: string;
  rows: XbsStuffing[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "21-Sep-26", "21-Sept-2026", an Excel date or "2026-09-21" -> "2026-09-21". */
export function stuffingDate(c: Cell | undefined) {
  if (c instanceof Date) return isNaN(c.getTime()) ? undefined : c.toISOString().slice(0, 10);
  const t = text(c);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})$/);
  if (!m) return undefined;
  const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mon < 0) return undefined;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, mon, Number(m[1])));
  return d.getUTCMonth() === mon ? d.toISOString().slice(0, 10) : undefined;
}

/** The SI from XBS's instruction column: "- 5622 ( 5689 )" -> "5622"; "5552A" -> "5552". */
export const siNumber = (s: string) => s.match(/\d+/)?.[0] ?? "";

/** Sums the report's lot lines per sales contract + SI + stuffing date, or null if it isn't the report. */
export function parseShipped(rows: Cell[][]): XbsStuffing[] | null {
  const at = rows.findIndex((r) => r?.some((c) => text(c) === "Stuffing Date") && r.some((c) => text(c) === "SO No."));
  if (at < 0) return null;
  const head = rows[at].map(text);
  const col = (name: string) => head.indexOf(name);
  const c = { date: col("Stuffing Date"), so: col("SO No."), kg: col("Qty in Kgs") };
  // The SI has no heading: it is the column right after "SO No." ("- 5622 ( 5689 )").
  const siCol = c.so + 1;
  if (c.kg < 0) throw new Error('The XBS shipped report has no "Qty in Kgs" column.');
  const sum = new Map<string, XbsStuffing>();
  for (const r of rows.slice(at + 1)) {
    const so = text(r?.[c.so]).replace(/\.0+$/, "");
    const stuffedOn = stuffingDate(r?.[c.date] ?? null);
    if (!/^\d+$/.test(so) || !stuffedOn) continue;
    const si = siNumber(text(r?.[siCol]));
    const k = `${so}|${si}|${stuffedOn}`;
    const x = sum.get(k) ?? { salesContract: so, si, stuffedOn, bags: 0, lots: 0 };
    x.bags += num(r?.[c.kg]) / 60;
    x.lots++;
    sum.set(k, x);
  }
  return [...sum.values()].map((x) => ({ ...x, bags: Math.round(x.bags * 100) / 100 })).sort((a, b) => a.stuffedOn.localeCompare(b.stuffedOn) || a.salesContract.localeCompare(b.salesContract));
}

/** A small CSV reader: commas, double quotes, quotes doubled inside quotes. */
export function csvRows(t: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), out.push(row);
  return out;
}

/** Reads the report from a CSV (as XBS exports it) or an Excel copy. */
export async function readShipped(file: File): Promise<XbsStuffingUpload> {
  let rows: XbsStuffing[] | null = null;
  if (/\.csv$/i.test(file.name)) {
    // XBS writes the CSV in Windows-1252; utf-8 would garble a few headings but no number or date.
    const bytes = await file.arrayBuffer();
    rows = parseShipped(csvRows(new TextDecoder("windows-1252").decode(bytes)));
  } else {
    // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
    const { default: readXlsxFile } = await import("read-excel-file/universal");
    const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
    for (const s of sheets) if ((rows = parseShipped(s.data))) break;
  }
  if (!rows) throw new Error(`${file.name} doesn't look like XBS's shipped report (no "Stuffing Date" and "SO No." columns).`);
  if (!rows.length) throw new Error(`${file.name} has no stuffed lots with a sales contract and a stuffing date.`);
  return { file: file.name, rows };
}
