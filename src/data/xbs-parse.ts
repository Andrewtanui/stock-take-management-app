// Reads the two XBS "Current Stock – Batch Wise Detail" Excel reports
// (Type: Warehouse, and Type: Blocked for Processing) into XBS lines.
// Pure parsing — the file reading lives in readXbsFiles() so this can be
// tested outside the browser.

import type { SiteCode, XbsLine } from "./types";

type Cell = string | number | boolean | Date | null | undefined;

export interface ParsedReport {
  file: string;
  type: "W" | "B";
  generatedAt?: Date;
  rows: Record<string, Cell>[];
}

const text = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).trim();
const num = (c: Cell) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);
const opt = (c: Cell) => text(c) || undefined;

/** "02-Mar-2026  -  08:52:30" → Date (East Africa Time, UTC+3). */
function reportTime(s: string): Date | undefined {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*-\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return new Date(Date.UTC(+m[3], mon, +m[1], +m[4] - 3, +m[5], +m[6]));
}

/** Splits one sheet into its header block (Type, Generated On) and data rows keyed by column name. */
export function parseReport(file: string, data: Cell[][]): ParsedReport {
  const meta = new Map<string, string>();
  let headerAt = -1;
  for (let i = 0; i < data.length; i++) {
    const r = data[i] ?? [];
    if (r.some((c) => text(c) === "Batch No.") && r.some((c) => text(c) === "Outturn No")) {
      headerAt = i;
      break;
    }
    const k = text(r[0]).replace(/:$/, "");
    if (k) meta.set(k, text(r[1]));
  }
  if (headerAt < 0) throw new Error(`${file} doesn't look like an XBS "Current Stock – Batch Wise Detail" report (no Batch No. / Outturn No columns).`);
  const type = meta.get("Type") ?? "";
  if (!/warehouse|blocked/i.test(type)) throw new Error(`${file}: unknown report type "${type}". Expected Warehouse or Blocked for Processing.`);
  const header = (data[headerAt] ?? []).map(text);
  const rows = data
    .slice(headerAt + 1)
    .filter((r) => r && r.some((c) => text(c)))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  return { file, type: /blocked/i.test(type) ? "B" : "W", generatedAt: reportTime(meta.get("Report Generated On") ?? ""), rows };
}

/** Matches an XBS warehouse name ("MITCHEL COTTS FREIGHT KENYA LIMITED") to a site by its first word. */
export function siteResolver(sites: { code: SiteCode; name: string }[]) {
  const first = (s: string) => s.trim().toUpperCase().split(/\s+/)[0];
  const byWord = new Map<string, SiteCode>();
  for (const s of sites) byWord.set(first(s.name), s.code);
  return (xbsName: string) => byWord.get(first(xbsName));
}

/** Turns parsed reports into XBS lines: Warehouse report first, then Blocked for Processing. */
export function toLines(reports: ParsedReport[], resolve: (name: string) => SiteCode | undefined) {
  const unknown = new Set<string>();
  const lines: XbsLine[] = [];
  for (const rep of [...reports].sort((a, b) => (a.type === b.type ? 0 : a.type === "W" ? -1 : 1))) {
    for (const r of rep.rows) {
      const whName = text(r["Warehouse"]);
      const wh = resolve(whName);
      if (!wh) {
        unknown.add(whName);
        continue;
      }
      const basket = text(r["Secondary Basket"]);
      const bm = basket.match(/^(\S+)\s*\(([^)]*)\)/s);
      lines.push({
        t: rep.type,
        wh,
        z: opt(r["Zone"]),
        b: text(r["Batch No."]),
        o: text(r["Outturn No"]),
        i: text(r["Item Name"]),
        bc: bm ? bm[1] : opt(basket),
        bn: bm ? bm[2].trim() : undefined,
        bg: num(r["Bags"]),
        pk: num(r["Pockets"]),
        u: num(r["Units"]),
        kg: num(r["Qty."]),
        g: opt(r["Grower Marks"]),
        wr: opt(r["Warrant No"]),
        c: opt(r["Certification"]),
        cs: opt(r["Cup Score"]),
        // Everything in the Blocked for Processing report is blocked; that report has no Blocked column.
        bl: rep.type === "B" || /^yes$/i.test(text(r["Blocked"])),
        so: opt(r["SO No."]),
        in: opt(r["Instruction No."]),
        d: r["Stock In Day(s)"] == null || text(r["Stock In Day(s)"]) === "" ? undefined : num(r["Stock In Day(s)"]),
        cy: opt(r["Inventory Type"]),
      });
    }
  }
  return { lines, unknownWarehouses: [...unknown] };
}

export interface XbsUpload {
  files: string[];
  snapshotAt?: Date;
  lines: XbsLine[];
  unknownWarehouses: string[];
}

/** Reads the chosen .xlsx files in the browser. */
export async function readXbsFiles(files: File[], sites: { code: SiteCode; name: string }[]): Promise<XbsUpload> {
  const { readSheet } = await import("read-excel-file/browser");
  const reports: ParsedReport[] = [];
  for (const f of files) reports.push(parseReport(f.name, (await readSheet(f)) as Cell[][]));
  const types = new Set(reports.map((r) => r.type));
  if (!types.has("W") || !types.has("B"))
    throw new Error("Choose both reports: Current Stock (Type: Warehouse) and Current Stock (Type: Blocked for Processing).");
  const { lines, unknownWarehouses } = toLines(reports, siteResolver(sites));
  const times = reports.map((r) => r.generatedAt?.getTime()).filter((t): t is number => !!t);
  return { files: reports.map((r) => r.file), snapshotAt: times.length ? new Date(Math.min(...times)) : undefined, lines, unknownWarehouses };
}
