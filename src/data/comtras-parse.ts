// Reads the Comtras P526 report (BRIC's position: Inventory, Longs and Shorts per contract line)
// exported to Excel. Pure apart from reading the file, so the totals can be tested.
//
// Finance's month-end "Total BRIC (Comtras)" is the Kenya stock position:
// Arabica Kenya Inventory + Arabica Kenya Longs (August 2026: 62,060.70 + 2,631.07 = 64,691.77).
// Other origins (e.g. Arabica Ethiopia) and Shorts are kept for audit but aren't part of it.

export type ComtrasLineType = "Inventory" | "Longs" | "Short";

export interface ComtrasLine {
  contract: string;
  lineType: ComtrasLineType;
  /** "Arabica Kenya", "Arabica Ethiopia"… */
  origin: string;
  /** Comtras quality code; matches our secondary basket codes where they're the same basket. */
  quality: string;
  bags60: number;
  kg: number;
  counterparty: string;
}

export interface ComtrasUpload {
  file: string;
  lines: ComtrasLine[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);

/** One sheet's rows -> P526 lines, or null if the sheet isn't a P526 contract list. */
export function parseP526(rows: Cell[][]): ComtrasLine[] | null {
  const at = rows.findIndex((r) => r?.some((c) => text(c) === "QualCode") && r.some((c) => text(c) === "LineText"));
  if (at < 0) return null;
  const h = rows[at].map(text);
  const col = (name: string) => h.indexOf(name);
  const [ctr, type, origin, qual, kgs, match] = ["Ctr.No.", "LineText", "Variety", "QualCode", "kgs", "Matchcode"].map(col);
  // The 60 kg column is spelt differently between exports ("60Kg Bags", "60 Kgs Bag").
  const bags60 = h.findIndex((x) => /^60\s*kgs?\s*bags?$/i.test(x));
  if (type < 0 || qual < 0 || (bags60 < 0 && kgs < 0)) return null;
  const out: ComtrasLine[] = [];
  for (const r of rows.slice(at + 1)) {
    const t = text(r?.[type]);
    if (t !== "Inventory" && t !== "Longs" && t !== "Short") continue;
    out.push({
      contract: text(r[ctr]),
      lineType: t,
      origin: text(r[origin]),
      quality: text(r[qual]),
      bags60: bags60 >= 0 ? num(r[bags60]) : num(r[kgs]) / 60,
      kg: num(r[kgs]),
      counterparty: text(r[match]),
    });
  }
  return out;
}

/** Finance's BRIC total and what goes into it. */
export function bricTotals(lines: ComtrasLine[]) {
  const sum = (f: (l: ComtrasLine) => boolean) => lines.filter(f).reduce((s, l) => s + l.bags60, 0);
  const kenya = (l: ComtrasLine) => /kenya/i.test(l.origin);
  const inventory = sum((l) => l.lineType === "Inventory" && kenya(l));
  const longs = sum((l) => l.lineType === "Longs" && kenya(l));
  return {
    inventory,
    longs,
    bric: inventory + longs,
    otherOrigins: sum((l) => l.lineType !== "Short" && !kenya(l)),
    shorts: sum((l) => l.lineType === "Short"),
  };
}

/** Reads the P526 workbook (the contract list is on its own sheet, after a pivot). */
export async function readP526(file: File): Promise<ComtrasUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  for (const s of sheets) {
    const lines = parseP526(s.data);
    if (lines?.length) return { file: file.name, lines };
  }
  throw new Error(`${file.name} doesn't look like a Comtras P526 report (no sheet with QualCode / LineText columns).`);
}
