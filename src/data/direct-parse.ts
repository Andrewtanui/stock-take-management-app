// Reads Trading's direct purchase workbook (Daniel's): one row per outturn and grade bought on a
// direct contract (905xx), with its baskets, warrant and the weight received. Pure apart from
// reading the file, so it can be tested.
//
// Two layouts exist:
// - the running list from season 2026-27 ("Direct Overview Season 2026-2027.xlsx"): one sheet,
//   one header row, a CONTRACT column;
// - the season 2025-26 file: an Overview sheet plus one sheet per contract ("90577&78"), each
//   with its own headers and the contract written as "CC-90577" or "Contract | 90581" above it.
// Both are read the same way: find header rows (an OUTTURN column), take every row below whose
// outturn looks like "43KN0035", and keep the contract the row names or the last one written above.

import { isoDate } from "./shipments-parse";

export interface DirectLot {
  /** Order in the upload (1, 2, ...), the key in Dataverse. */
  row: number;
  sheet: string;
  contract: string;
  /** From the Overview sheet, when the contract is listed there. */
  contractDate?: string;
  grower: string;
  outturn: string;
  grade: string;
  bags: number;
  /** The odd last bag, in kg. */
  pocketKg: number;
  kg: number;
  cert: string;
  primary: string;
  secondary: string;
  warrant: string;
  warrantKg: number;
  receivedKg: number;
  warehouse: string;
  receivedOn?: string;
}

export interface DirectUpload {
  file: string;
  lots: DirectLot[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/[,\s]/g, "")) || 0);
const key = (c: Cell | undefined) => text(c).toLowerCase().replace(/\s+/g, " ");
const OUTTURN = /^\d{2}[A-Z]{2}\d{4}$/;
const id = (c: Cell | undefined) => text(c).replace(/\.0+$/, "");
const contractOf = (c: Cell | undefined) => /^(?:CC-)?(9\d{4})$/.exec(id(c))?.[1];

/** Header names per field, as they appear across the sheets (lower case). */
const HEADERS: Record<string, string[]> = {
  outturn: ["outturn", "outturn no."],
  grower: ["grower name", "grower mark", "mark", "marks"],
  grade: ["grade"],
  bags: ["bags"],
  pocket: ["pocket", "pkt", "pkts", "pockets(kg)"],
  kg: ["weight", "kgs", "kilos", "net", "total kg"],
  cert: ["cert"],
  primary: ["primary", "prim basket", "primary basket"],
  secondary: ["secondary", "sec basket", "seconday", "secondary basket"],
  contract: ["contract", "contracts"],
  warrant: ["warrants no.", "warrant no.", "warrant no", "warrants", "warrant"],
  warrantKg: ["warrant weight", "warrant weights", "warrants weight"],
  receivedKg: ["received weights", "delivered weights", "received weight"],
  warehouse: ["warehouse", "whse"],
  receivedOn: ["date received", "received on"],
};

type Columns = Partial<Record<keyof typeof HEADERS, number>>;
function columnsOf(row: Cell[]): Columns | null {
  const h = row.map(key);
  if (!h.some((x) => HEADERS.outturn.includes(x))) return null;
  const cols: Columns = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const i = h.findIndex((x) => names.includes(x));
    if (i >= 0) cols[field as keyof typeof HEADERS] = i;
  }
  // "WARRANTS" over a number column and "WARRANT WEIGHTS" next to it: the first is the number.
  return cols;
}

/** Contract numbers written above a block: "CC-90577", or "Contract" followed by 90581. */
function contractMark(row: Cell[]): string | undefined {
  for (let i = 0; i < row.length; i++) {
    const t = text(row[i]);
    if (/^CC-9\d{4}$/.test(t)) return t.slice(3);
    if (/^contract$/i.test(t)) {
      const next = contractOf(row[i + 1]);
      if (next) return next;
    }
  }
  return undefined;
}

/**
 * The contract a sheet's name gives: "90583" -> 90583. A sheet for two contracts ("90579&80",
 * "90589-91") gives "90579/90580" until a row or a "CC-905xx" mark above it says which one.
 */
const sheetContract = (sheet: string) => {
  const m = /^(9\d{4})(?:\s*[&-]\s*(\d{1,2}))?/.exec(sheet.trim());
  if (!m) return "";
  return m[2] ? `${m[1]}/${m[1].slice(0, 5 - m[2].length)}${m[2]}` : m[1];
};

/** One sheet -> lots. */
export function parseDirectSheet(sheet: string, rows: Cell[][]): Omit<DirectLot, "row" | "contractDate">[] {
  const out: Omit<DirectLot, "row" | "contractDate">[] = [];
  let cols: Columns | null = null;
  let current = sheetContract(sheet);
  for (const r of rows) {
    if (!r) continue;
    const mark = contractMark(r);
    if (mark) current = mark;
    const header = columnsOf(r);
    if (header) {
      cols = header;
      continue;
    }
    if (!cols) continue;
    const at = (f: keyof typeof HEADERS) => (cols![f] == null ? null : r[cols![f]!]);
    const outturn = text(at("outturn")).toUpperCase();
    if (!OUTTURN.test(outturn)) continue;
    out.push({
      sheet,
      // A quality code (10027) in the contract column is resolved from the Overview in parseDirect.
      contract: contractOf(at("contract")) ?? (/^10\d{3}$/.test(id(at("contract"))) ? `q${id(at("contract"))}` : current),
      grower: text(at("grower")),
      outturn,
      grade: text(at("grade")).toUpperCase(),
      bags: num(at("bags")),
      pocketKg: num(at("pocket")),
      kg: num(at("kg")),
      cert: text(at("cert")),
      primary: text(at("primary")),
      secondary: text(at("secondary")),
      warrant: text(at("warrant")).replace(/\.0+$/, ""),
      warrantKg: num(at("warrantKg")),
      receivedKg: num(at("receivedKg")),
      warehouse: text(at("warehouse")).toUpperCase(),
      receivedOn: isoDate(at("receivedOn")),
    });
  }
  return out;
}

export interface OverviewRow {
  contract: string;
  date?: string;
  grower: string;
  quality: string;
}

/** The Overview sheet: contract, date, grower and quality code per contract. */
export function overviewRows(rows: Cell[][]): OverviewRow[] {
  const at = rows.findIndex((r) => r?.some((c) => key(c) === "contract date") && r.some((c) => key(c) === "contract"));
  if (at < 0) return [];
  const h = rows[at].map(key);
  const [d, c, g, q] = ["contract date", "contract", "grower", "quality"].map((x) => h.indexOf(x));
  return rows.slice(at + 1).flatMap((r) => {
    const contract = contractOf(r?.[c]);
    return contract ? [{ contract, date: isoDate(r[d]), grower: g < 0 ? "" : text(r[g]), quality: q < 0 ? "" : id(r[q]) }] : [];
  });
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** A row with a quality code where the contract belongs: the one Overview contract for that grower and quality. */
function byGrowerAndQuality(overview: OverviewRow[], grower: string, quality: string) {
  const g = letters(grower);
  const hits = overview.filter((o) => o.quality === quality && letters(o.grower) && g.startsWith(letters(o.grower)));
  return new Set(hits.map((h) => h.contract)).size === 1 ? hits[0].contract : "";
}

/** All sheets -> lots, numbered in order. A sheet copied twice ("90595&6 (2)") isn't counted twice. */
export function parseDirect(sheets: { sheet: string; data: Cell[][] }[]): DirectLot[] {
  const overview = sheets.find((s) => /^overview$/i.test(s.sheet.trim()));
  const contracts = overview ? overviewRows(overview.data) : [];
  const dates = new Map(contracts.filter((o) => o.date).map((o) => [o.contract, o.date!]));
  const seen = new Set<string>();
  const lots: DirectLot[] = [];
  for (const s of sheets) {
    if (s === overview) continue;
    for (const parsed of parseDirectSheet(s.sheet, s.data)) {
      const l = parsed.contract.startsWith("q") ? { ...parsed, contract: byGrowerAndQuality(contracts, parsed.grower, parsed.contract.slice(1)) } : parsed;
      const k = [l.contract, l.outturn, l.grade, l.bags, l.kg].join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      lots.push({ ...l, row: lots.length + 1, contractDate: dates.get(l.contract) ?? dates.get(l.contract.split("/")[0]) });
    }
  }
  return lots;
}

/** Totals for the upload panel. "By the count date" uses the date received, else the contract date. */
export function directTotals(lots: DirectLot[], cutOff?: string) {
  const when = (l: DirectLot) => l.receivedOn ?? l.contractDate;
  const by = lots.filter((l) => !cutOff || (when(l) ?? "") <= cutOff);
  return {
    lots: lots.length,
    contracts: new Set(lots.map((l) => l.contract)).size,
    outturns: new Set(lots.map((l) => l.outturn)).size,
    kg: lots.reduce((s, l) => s + (l.receivedKg || l.warrantKg || l.kg), 0),
    byCutOff: by.length,
    withWarehouse: lots.filter((l) => l.warehouse).length,
    withReceivedDate: lots.filter((l) => l.receivedOn).length,
    noContractDate: lots.filter((l) => !l.contractDate && !l.receivedOn).length,
    noContract: lots.filter((l) => !l.contract).length,
  };
}

/** Reads the workbook: every sheet with an OUTTURN header. */
export async function readDirect(file: File): Promise<DirectUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  const lots = parseDirect(sheets);
  if (!lots.length) throw new Error(`${file.name} doesn't look like the direct purchase list (no sheet with an OUTTURN column and outturns like 43KN0035).`);
  return { file: file.name, lots };
}
