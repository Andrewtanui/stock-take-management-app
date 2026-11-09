// Reads two XBS reports used as evidence on weight-loss exceptions:
//   "Stock Transfer Instruction Summary": per instruction and batch, what was instructed (L), issued
//     (sent, T) and received (posted at the receiving warehouse, Z), with the weighbridge ticket;
//   "Ticket Summary": per weighbridge ticket, what the truck weighed (net of truck and bag tare).
// Pure parsing; the file reading is in readTransferFiles() so this can be tested outside the browser.

type Cell = string | number | boolean | Date | null | undefined;

const text = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
const num = (c: Cell) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);
/** A date cell: a Date, an ISO text, or an Excel serial day (the transfer report: 46325 = 30 Oct 2026). */
const day = (c: Cell) =>
  c instanceof Date
    ? c.toISOString().slice(0, 10)
    : typeof c === "number" && c > 30000 && c < 80000
      ? new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000).toISOString().slice(0, 10)
      : /^\d{4}-\d{2}-\d{2}/.test(text(c))
        ? text(c).slice(0, 10)
        : undefined;

export interface TransferLine {
  row: number;
  instruction: string;
  type: string;
  instructedOn?: string;
  outturn: string;
  batch: string;
  grade: string;
  /** "AGL-TEMP-0-0" */
  fromZone: string;
  /** Where it was received: "IBERO EXPORT WAREHOUSE-D-04-1" (empty until received). */
  toZone: string;
  instructedKg: number;
  issuedKg: number;
  issuedOn?: string;
  receivedKg: number;
  receivedOn?: string;
  /** Received less issued, as XBS works it out (Loss Gain). */
  gainKg: number;
  missingKg: number;
  /** Still to transfer. */
  balanceKg: number;
  status: string;
  /** Weighbridge ticket "TN-007867", from the receipt (or issue) transaction. */
  ticket?: string;
}

export interface WeighTicket {
  ticket: string;
  type: string;
  status: string;
  arrivedOn?: string;
  /** Net Weight: first weight less the truck's and the bags' tare - the coffee on the truck. */
  netKg: number;
  /** Gross Qty.: the receipts posted on the ticket plus the bags' tare. */
  grossQtyKg: number;
  /** Variance Qty.: the net weight less the receipts posted. */
  varianceKg: number;
  units: number;
  vehicle: string;
  items: string[];
}

export interface TransferUpload {
  /** "transfers" or "tickets": which report. */
  kind: "transfers" | "tickets";
  file: string;
  /** When XBS produced the report (East Africa Time read as UTC+3). */
  reportedAt?: string;
  transfers: TransferLine[];
  tickets: WeighTicket[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "04-Nov-2026  -  12:17:45" or a file name's "04-Nov-2026  -  124512" -> ISO (EAT, UTC+3). */
export function reportTime(s: string): string | undefined {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*-\s*(\d{2}):?(\d{2}):?(\d{2})/);
  if (!m) return undefined;
  const mon = MONTHS.indexOf(m[2].toLowerCase());
  return mon < 0 ? undefined : new Date(Date.UTC(+m[3], mon, +m[1], +m[4] - 3, +m[5], +m[6])).toISOString();
}

const ticketOf = (c: Cell) => /TN-\d+/.exec(text(c))?.[0];

/**
 * The transfer report: a two-row header (group, then column), names repeat across groups (four
 * "Qty."), so columns are found by "group|name". An instruction's own columns are filled on its first
 * line only. Returns undefined if the sheet isn't this report.
 */
export function parseTransfers(data: Cell[][]): { lines: TransferLine[]; reportedAt?: string } | undefined {
  const at = data.findIndex((r) => text(r?.[0]) === "Number" && (r ?? []).some((c) => text(c) === "Outturn Number"));
  if (at < 1) return undefined;
  const groups = (data[at - 1] ?? []).map(text);
  const names = (data[at] ?? []).map(text);
  const col = new Map<string, number>();
  names.forEach((nm, i) => {
    let g = "";
    for (let j = i; j >= 0 && !g; j--) g = groups[j] ?? "";
    const k = `${g}|${nm}`;
    if (!col.has(k)) col.set(k, i);
  });
  const need = {
    instruction: "Instruction Details|Number",
    type: "Instruction Details|Instruction Type",
    instructedOn: "Instruction Details|Date",
    outturn: "Instruction Details|Outturn Number",
    batch: "Instruction Details|Batch No.",
    grade: "Instruction Details|Item Name",
    instructedKg: "Instruction Details|Qty.",
    fromZone: "Instruction Details|From WareHouse - Zone",
    toZone: "Instruction Details|To Warehouse -Zone",
    issuedTx: "Issued Details|Transaction No.",
    issuedOn: "Issued Details|Transaction Date",
    issuedKg: "Issued Details|Qty.",
    receivedTx: "Transferred Details|Transaction No.",
    receivedOn: "Transferred Details|Transaction Date",
    receivedKg: "Transferred Details|Qty.",
    receivedZone: "Transferred Details|Warehouse-Zone",
    gainKg: "Loss Gain|Qty.",
    missingKg: "Loss (Missing Bag)|Qty.",
    balanceKg: "Balance To Transfer|Qty.",
    status: "Stock Transfer Status|Stock Transfer Status",
  } as const;
  const C = {} as Record<keyof typeof need, number>;
  for (const [k, v] of Object.entries(need)) {
    const i = col.get(v);
    if (i === undefined) throw new Error(`The stock transfer report has no "${v.replace("|", " · ")}" column.`);
    C[k as keyof typeof need] = i;
  }
  let reportedAt: string | undefined;
  for (const r of data.slice(0, at)) if (/report generated on/i.test(text(r?.[0]))) reportedAt = reportTime(text(r?.[1]));

  const lines: TransferLine[] = [];
  // The instruction's own columns carry down to its other lines.
  const carry: Partial<Record<"instruction" | "type" | "instructedOn" | "outturn" | "fromZone" | "toZone", Cell>> = {};
  data.slice(at + 1).forEach((r, i) => {
    if (!r || !r.some((c) => text(c))) return;
    for (const k of ["instruction", "type", "instructedOn", "outturn", "fromZone", "toZone"] as const) if (text(r[C[k]])) carry[k] = r[C[k]];
    const batch = text(r[C.batch]);
    if (!batch) return;
    const dash = (c: Cell) => (text(c) === "-" ? "" : text(c));
    lines.push({
      row: at + 2 + i,
      instruction: text(carry.instruction),
      type: text(carry.type).split("<")[0].trim(),
      instructedOn: day(carry.instructedOn),
      outturn: text(r[C.outturn]) || text(carry.outturn),
      batch,
      grade: text(r[C.grade]),
      fromZone: dash(r[C.fromZone]) || dash(carry.fromZone),
      toZone: dash(r[C.receivedZone]) || dash(r[C.toZone]) || dash(carry.toZone),
      instructedKg: num(r[C.instructedKg]),
      issuedKg: num(r[C.issuedKg]),
      issuedOn: day(r[C.issuedOn]),
      receivedKg: num(r[C.receivedKg]),
      receivedOn: day(r[C.receivedOn]),
      gainKg: num(r[C.gainKg]),
      missingKg: num(r[C.missingKg]),
      balanceKg: num(r[C.balanceKg]),
      status: text(r[C.status]),
      ticket: ticketOf(r[C.receivedTx]) ?? ticketOf(r[C.issuedTx]),
    });
  });
  return { lines, reportedAt };
}

/** The ticket report: one row per item on the truck, the weights repeated on each. One per ticket. */
export function parseTickets(data: Cell[][]): WeighTicket[] | undefined {
  const at = data.findIndex((r) => text(r?.[0]) === "No." && (r ?? []).some((c) => text(c) === "Net Weight"));
  if (at < 0) return undefined;
  const h = (data[at] ?? []).map(text);
  const c = (name: string) => {
    const i = h.indexOf(name);
    if (i < 0) throw new Error(`The ticket summary has no "${name}" column.`);
    return i;
  };
  const C = { no: 0, arrived: c("Arrival Date"), status: c("Status"), type: c("Ticket Type"), item: c("Item"), net: c("Net Weight"), units: c("Units"), gross: c("Gross Qty."), variance: c("Variance Qty."), vehicle: c("Vehicle No.") };
  const by = new Map<string, WeighTicket>();
  for (const r of data.slice(at + 1)) {
    const no = text(r?.[C.no]);
    if (!no) continue;
    const t = by.get(no) ?? {
      ticket: no,
      type: text(r[C.type]).replace(/\s+/g, " "),
      status: text(r[C.status]),
      arrivedOn: day(r[C.arrived]),
      netKg: num(r[C.net]),
      grossQtyKg: num(r[C.gross]),
      varianceKg: num(r[C.variance]),
      units: num(r[C.units]),
      vehicle: text(r[C.vehicle]),
      items: [],
    };
    const item = text(r[C.item]);
    if (item && !t.items.includes(item)) t.items.push(item);
    by.set(no, t);
  }
  return [...by.values()];
}

/** Reads one report (either kind) in the browser. */
export async function readTransferFile(file: File): Promise<TransferUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  return transferUpload(file.name, sheets.map((s) => s.data));
}

export function transferUpload(file: string, sheets: Cell[][][]): TransferUpload {
  for (const data of sheets) {
    const t = parseTransfers(data);
    if (t) {
      if (!t.lines.length) throw new Error(`${file} has no transfer lines.`);
      return { kind: "transfers", file, reportedAt: t.reportedAt ?? reportTime(file), transfers: t.lines, tickets: [] };
    }
    const k = parseTickets(data);
    if (k) {
      if (!k.length) throw new Error(`${file} has no tickets.`);
      // The ticket report has no "Generated On" line; its time is in the file name.
      return { kind: "tickets", file, reportedAt: reportTime(file), transfers: [], tickets: k };
    }
  }
  throw new Error(`${file} doesn't look like XBS's Stock Transfer Instruction Summary or Ticket Summary.`);
}
