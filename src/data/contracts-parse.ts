// Reads the Comtras "537" contract invoicing journal (D537CCPDF) exported to Excel: one row per
// booked invoice or credit-note line, against a purchase contract and/or a sales contract. Pure
// apart from reading the file, so the totals can be tested.
//
// The journal is per company (Mandant): CC = Kenya, GG = Tanzania, DD = Uganda. Only Kenya's
// lines belong to this stock take; a file with other companies' lines is refused.
// FIBU2 D = customer side (VK, a sale), K = supplier side (EK, a purchase). P.Ctr. is the
// purchase contract (90xxx), S.Ctr. the sales contract (3787xxx): the same number XBS shows as
// "sales contract blocked to", which is how an invoice links to a lot in the warehouse.

/** Comtras document types (Symbol) seen in the journal. Others are kept as "Other (n)". */
export const DOC_TYPES: Record<number, string> = {
  11: "Purchase invoice",
  15: "Purchase correction",
  21: "Sales invoice",
  25: "Sales correction",
  61: "Purchase credit (correction)",
  65: "Purchase credit note",
  71: "Sales credit note",
  75: "Sales credit (correction)",
};

export const KENYA = "CC";
const COMPANIES: Record<string, string> = { CC: "Kenya", GG: "Tanzania", DD: "Uganda" };

export interface ContractLine {
  /** Row in the sheet (1 = header), so a line can be found in the file again. */
  row: number;
  side: "Customer" | "Supplier";
  account: string;
  counterparty: string;
  profile: string;
  /** ISO dates. */
  bookedOn: string;
  voucherDate: string;
  voucher: string;
  docType: number;
  purchaseContract: string;
  purchaseContractDate?: string;
  salesContract: string;
  salesContractDate?: string;
  /** Purchase (EK) and sale (VK); credit notes are negative. */
  buyBags: number;
  buyKg: number;
  buy60: number;
  buyValue: number;
  sellBags: number;
  sellKg: number;
  sell60: number;
  sellValue: number;
}

export interface ContractUpload {
  file: string;
  lines: ContractLine[];
}

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);
/** Comtras writes dates as yyyymmdd numbers; 0 = none. */
const ymd = (c: Cell | undefined) => {
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = text(c).replace(/\.0+$/, "");
  return /^\d{8}$/.test(s) && s !== "00000000" ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined;
};
const id = (c: Cell | undefined) => {
  const s = text(c).replace(/\.0+$/, "");
  return s === "0" ? "" : s;
};

/** One sheet's rows -> journal lines, or null if the sheet isn't a 537 journal. */
export function parse537(rows: Cell[][]): ContractLine[] | null {
  const at = rows.findIndex((r) => r?.some((c) => text(c) === "Mandant") && r.some((c) => text(c) === "S.Ctr.") && r.some((c) => text(c) === "P.Ctr."));
  if (at < 0) return null;
  const h = rows[at].map(text);
  const col = (name: string) => {
    const i = h.findIndex((x) => x.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`The 537 journal has no "${name}" column.`);
    return i;
  };
  const c = {
    mandant: col("Mandant"), side: col("FIBU2"), account: col("FIBU3"), name: col("Kurz-Name"), profile: col("Profil"),
    booked: col("BookDat"), vouchDate: col("VouchDat"), voucher: col("VouchNo"), symbol: col("Symbol"),
    pctr: col("P.Ctr."), sctr: col("S.Ctr."), pdate: col("P.Ctr. Date"), sdate: col("S.Ctr. Date"),
    buyBags: col("EK-Sack"), buyKg: col("EK-KG"), buy60: col("EK 60KG Bags"), buyValue: col("EK-Wert"),
    sellBags: col("VK-Sack"), sellKg: col("VK-KG"), sell60: col("VK 60KG BAGS"), sellValue: col("VK-Wert"),
  };
  const out: ContractLine[] = [];
  const others = new Map<string, number>();
  rows.slice(at + 1).forEach((r, i) => {
    if (!r?.some((x) => text(x))) return;
    const mandant = text(r[c.mandant]);
    if (mandant !== KENYA) {
      others.set(mandant, (others.get(mandant) ?? 0) + 1);
      return;
    }
    out.push({
      row: at + i + 2,
      side: text(r[c.side]) === "K" ? "Supplier" : "Customer",
      account: id(r[c.account]),
      counterparty: text(r[c.name]),
      profile: text(r[c.profile]),
      bookedOn: ymd(r[c.booked]) ?? "",
      voucherDate: ymd(r[c.vouchDate]) ?? "",
      voucher: id(r[c.voucher]),
      docType: num(r[c.symbol]),
      purchaseContract: id(r[c.pctr]),
      purchaseContractDate: ymd(r[c.pdate]),
      salesContract: id(r[c.sctr]),
      salesContractDate: ymd(r[c.sdate]),
      buyBags: num(r[c.buyBags]),
      buyKg: num(r[c.buyKg]),
      buy60: num(r[c.buy60]),
      buyValue: num(r[c.buyValue]),
      sellBags: num(r[c.sellBags]),
      sellKg: num(r[c.sellKg]),
      sell60: num(r[c.sell60]),
      sellValue: num(r[c.sellValue]),
    });
  });
  if (others.size) {
    const list = [...others].map(([m, n]) => `${n} line${n === 1 ? "" : "s"} for ${COMPANIES[m] ?? m} (${m || "no company"})`).join(", ");
    throw new Error(`This 537 has ${list}. Load Kenya's journal only (company CC).`);
  }
  return out;
}

/** Totals for the upload panel: what was bought and sold, and how much was booked by the cut-off. */
export function contractTotals(lines: ContractLine[], cutOff?: string) {
  const sum = (f: (l: ContractLine) => number, keep: (l: ContractLine) => boolean = () => true) => lines.filter(keep).reduce((s, l) => s + f(l), 0);
  const byCutOff = (l: ContractLine) => !cutOff || l.bookedOn <= cutOff;
  const dates = lines.map((l) => l.bookedOn).filter(Boolean).sort();
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    bought: sum((l) => l.buy60),
    sold: sum((l) => l.sell60),
    boughtByCutOff: sum((l) => l.buy60, byCutOff),
    soldByCutOff: sum((l) => l.sell60, byCutOff),
    purchaseContracts: new Set(lines.map((l) => l.purchaseContract).filter(Boolean)).size,
    salesContracts: new Set(lines.map((l) => l.salesContract).filter(Boolean)).size,
    counterparties: new Set(lines.map((l) => l.counterparty)).size,
  };
}

/** Reads the 537 workbook (the journal is on its own sheet, next to any pivots). */
export async function read537(file: File): Promise<ContractUpload> {
  // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  for (const s of sheets) {
    const lines = parse537(s.data);
    if (lines?.length) return { file: file.name, lines };
  }
  throw new Error(`${file.name} doesn't look like a Comtras 537 journal (no sheet with Mandant / P.Ctr. / S.Ctr. columns).`);
}
