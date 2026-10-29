// Reads Trade / Logistics' shipment tracker ("Kenya_Operational_PL.xlsx", sheet KENYA) exported to
// Excel: one row per sales contract + shipping instruction, with the stuffing and sailing dates.
// Pure apart from reading the file, so the totals can be tested.
//
// "Sale Contract Ref" is the same number as the 537's S.Ctr. and XBS's "sales contract blocked to",
// which is how a shipment links to an invoice and to a lot in the warehouse. ETA at the port of
// discharge is filled on only a few rows, so arrival can't come from this file.

export interface ShipmentLine {
  /** Row in the sheet (1 = header), so a line can be found in the file again. */
  row: number;
  salesContract: string;
  purchaseContract: string;
  si: string;
  buyer: string;
  bags: number;
  qualityCode: string;
  quality: string;
  packaging: string;
  destination: string;
  /** ISO dates. */
  contractDate?: string;
  stuffedOn?: string;
  sailedOn?: string;
  etaPod?: string;
  bl: string;
  vessel: string;
  /** Open · Closed · Cancelled, as Trade keys it. */
  status: string;
  usdValue: number;
}

export interface ShipmentUpload {
  file: string;
  lines: ShipmentLine[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);
const id = (c: Cell | undefined) => text(c).replace(/\.0+$/, "").replace(/\s+/g, "");
/** y-m-d -> "yyyy-mm-dd" if it is a real calendar date. */
const real = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : undefined;
};
/**
 * Excel dates come as Date. Typed ones are mixed in the same column: "19.10.2026", "27/02/2025",
 * "11/18/2026", "09-28-2026", "2026-10-19", or a date serial as text ("45672"). Day first unless
 * that can't be (a first part over 12). Anything else ("APS", "Approved") = none.
 */
export const isoDate = (c: Cell | undefined): string | undefined => {
  if (c instanceof Date) return isNaN(c.getTime()) ? undefined : c.toISOString().slice(0, 10);
  const s = text(c);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (ymd) return real(+ymd[1], +ymd[2], +ymd[3]);
  const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (parts) {
    const [a, b, y] = [+parts[1], +parts[2], +parts[3]];
    return b > 12 ? real(y, a, b) : real(y, b, a);
  }
  const serial = /^\d{5}(\.\d+)?$/.test(s) ? Math.floor(Number(s)) : 0;
  if (serial > 30000 && serial < 60000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  return undefined;
};

/** One sheet's rows -> shipments, or null if the sheet isn't the tracker. */
export function parseTracker(rows: Cell[][]): ShipmentLine[] | null {
  const at = rows.findIndex((r) => r?.some((c) => text(c) === "Sale Contract Ref") && r.some((c) => text(c) === "Actual Stuffing Date"));
  if (at < 0) return null;
  const h = rows[at].map((x) => text(x).toLowerCase());
  const col = (name: string, required = true) => {
    const i = h.indexOf(name.toLowerCase());
    if (i < 0 && required) throw new Error(`The shipment tracker has no "${name}" column.`);
    return i;
  };
  const c = {
    sc: col("Sale Contract Ref"), pc: col("Purchase Contract Ref"), si: col("SI No."), buyer: col("Buyer"), bags: col("Bags"),
    code: col("Quality Code"), quality: col("Quality Basket / Grade"), pack: col("Packaging Type"), dest: col("Destination Country", false),
    contract: col("Contract Date"), stuffed: col("Actual Stuffing Date"), sailed: col("Actual Sailing Date"), eta: col("ETA POD", false),
    bl: col("B/L No"), vessel: col("Vessel", false), status: col("Contract Status (Open / Cancelled / Closed)", false), usd: col("USD Value of Shipment", false),
  };
  const at_ = (r: Cell[], i: number) => (i < 0 ? null : r[i]);
  const out: ShipmentLine[] = [];
  rows.slice(at + 1).forEach((r, i) => {
    const sc = id(at_(r, c.sc));
    if (!sc) return;
    out.push({
      row: at + i + 2,
      salesContract: sc,
      purchaseContract: id(at_(r, c.pc)),
      si: id(at_(r, c.si)),
      buyer: text(at_(r, c.buyer)),
      bags: num(at_(r, c.bags)),
      qualityCode: id(at_(r, c.code)),
      quality: text(at_(r, c.quality)),
      packaging: text(at_(r, c.pack)),
      destination: text(at_(r, c.dest)),
      contractDate: isoDate(at_(r, c.contract)),
      stuffedOn: isoDate(at_(r, c.stuffed)),
      sailedOn: isoDate(at_(r, c.sailed)),
      etaPod: isoDate(at_(r, c.eta)),
      bl: text(at_(r, c.bl)),
      vessel: text(at_(r, c.vessel)),
      status: text(at_(r, c.status)),
      usdValue: num(at_(r, c.usd)),
    });
  });
  return out;
}

/** First day of the month `months` before the cut-off's month ("2026-08-31", 2 -> "2026-06-01"). */
const monthsBefore = (cutOff: string, months: number) => {
  const d = new Date(`${cutOff.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/**
 * Totals for the upload panel, around the count date. "Recent" = stuffed in the count's month or the
 * two before: older rows without a sailing date are gaps in the tracker, not coffee still in Kenya.
 */
export function shipmentTotals(lines: ShipmentLine[], cutOff?: string) {
  const bags = (keep: (l: ShipmentLine) => boolean) => lines.filter(keep).reduce((s, l) => s + l.bags, 0);
  const stuffed = lines.map((l) => l.stuffedOn).filter(Boolean).sort() as string[];
  const by = (d?: string) => !!d && (!cutOff || d <= cutOff);
  const since = cutOff ? monthsBefore(cutOff, 2) : "";
  const recent = (l: ShipmentLine) => by(l.stuffedOn) && l.stuffedOn! >= since;
  return {
    from: stuffed[0],
    to: stuffed[stuffed.length - 1],
    shipments: lines.length,
    salesContracts: new Set(lines.map((l) => l.salesContract)).size,
    open: lines.filter((l) => /^open/i.test(l.status)).length,
    noStuffingDate: lines.filter((l) => !l.stuffedOn).length,
    since,
    /** Stuffed in the three months up to the count date. */
    stuffedRecently: bags(recent),
    /** Of those, not yet sailed on the count date: out of the warehouse, still in Kenya. */
    stuffedNotSailed: bags((l) => recent(l) && !by(l.sailedOn)),
  };
}

/** Reads the tracker workbook: the KENYA sheet, or the first sheet that looks like it. */
export async function readTracker(file: File): Promise<ShipmentUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  const ordered = [...sheets].sort((a, b) => Number(b.sheet === "KENYA") - Number(a.sheet === "KENYA"));
  for (const s of ordered) {
    const lines = parseTracker(s.data);
    if (lines?.length) return { file: file.name, lines };
  }
  throw new Error(`${file.name} doesn't look like the shipment tracker (no sheet with "Sale Contract Ref" and "Actual Stuffing Date" columns).`);
}
