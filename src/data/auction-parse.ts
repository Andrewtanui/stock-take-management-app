// Auction allocation report: coffee bought at a Nairobi Coffee Exchange auction ("Sale N"), with the
// invoice that posts it into Comtras. A sale bought within the delivery lead-time of the count — or
// invoiced to Comtras after the count — is in the BRIC total but not yet physically at Ibero, so it is
// a Level 2 reconciling item: the INBOUND twin of afloat (afloat = stuffed-not-invoiced, outbound).
//
// Worked example (Oct 2026, "Sale 4"): auctioned 27 Oct, count 31 Oct, invoiced (11070-11072) in Nov.
// Contracts 90567 / 90603 / 90533 = 662 / 3,243 / 559 = 4,464 bags, matching Finance's 4,463 to the bag
// and the Oct 537 purchase tranche booked 30 Oct (vouchers 74483 / 74484 / 74485).
//
// Pure apart from reading the file, so the figures can be tested.

type Cell = string | number | boolean | Date | null;
const text = (c: Cell | undefined) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).trim();
const num = (c: Cell | undefined) => (typeof c === "number" ? c : Number(text(c).replace(/,/g, "")) || 0);

/** A date cell to yyyy-mm-dd: a Date, an Excel serial number, or d/m/y or y-m-d text. "" if unreadable. */
export function toISODate(c: Cell | undefined): string {
  if (c == null || c === "") return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === "number") return new Date(Date.UTC(1899, 11, 30) + c * 86400000).toISOString().slice(0, 10);
  const s = String(c).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); // d/m/y (Kenya)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toISOString().slice(0, 10);
}

export interface AuctionLot {
  /** yyyy-mm-dd of the auction (Sale N). */
  auctionDate: string;
  /** Sale number as text, e.g. "4". */
  sale: string;
  /** Purchase contract (90xxx). */
  contract: string;
  /** Comtras invoice number. */
  invoice: string;
  /** Comtras posting date, when the report carries it (preferred signal). */
  invoiceDate?: string;
  kg: number;
  /** 60 kg bag equivalents. */
  bags: number;
}

/** Fallback window (days before the count) for "recent auction, not yet delivered" when no invoice date. */
export const PURCHASE_IN_TRANSIT_DAYS = 14;

const HEAD = /auction\s*date|auction\s*sale|contract\s*no|invoice\s*no|kilos?|bags/i;
const find = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h));

/** Reads the auction allocation sheet (rows of cells). Returns the lots, or null if no header is found. */
export function parseAuction(rows: Cell[][]): AuctionLot[] | null {
  const hi = rows.findIndex((r) => r.filter((c) => HEAD.test(text(c))).length >= 3);
  if (hi < 0) return null;
  const head = rows[hi].map(text);
  const col = {
    date: find(head, /auction\s*date/i),
    sale: find(head, /auction\s*sale|^sale/i),
    contract: find(head, /contract/i),
    invoice: find(head, /invoice\s*no|^invoice$/i),
    invoiceDate: find(head, /invoice\s*date|posting\s*date|posted/i),
    kg: find(head, /kilos?|^kg/i),
    bags: find(head, /bags/i),
  };
  const lots: AuctionLot[] = [];
  for (const r of rows.slice(hi + 1)) {
    const contract = text(r[col.contract]);
    const kg = num(r[col.kg]);
    if (!contract || (!kg && !num(r[col.bags]))) continue; // skip blanks / totals
    lots.push({
      auctionDate: toISODate(r[col.date]),
      sale: text(r[col.sale]),
      contract,
      invoice: text(r[col.invoice]),
      invoiceDate: col.invoiceDate >= 0 ? toISODate(r[col.invoiceDate]) || undefined : undefined,
      kg,
      bags: kg ? Math.round((kg / 60) * 100) / 100 : num(r[col.bags]),
    });
  }
  return lots;
}

export interface SaleInTransit {
  sale: string;
  bags: number;
  contracts: string[];
  invoices: string[];
  auctionDate: string;
  /** Why it was picked: "invoiced after the count" or "auctioned within N days". */
  why: string;
}

/**
 * Auction sales that are bought but not yet at Ibero at the count: invoiced to Comtras AFTER the count
 * date (preferred), or — when the report has no invoice date — auctioned within `days` of the count.
 * Grouped by sale, bags summed. These are BRIC-side reconciling items for Finance to accept.
 */
export function auctionInTransit(lots: AuctionLot[], cutOff: string, days = PURCHASE_IN_TRANSIT_DAYS): SaleInTransit[] {
  if (!cutOff) return [];
  const count = new Date(cutOff);
  const windowStart = new Date(count);
  windowStart.setDate(count.getDate() - days);
  const picked = lots.map((l) => {
    if (l.invoiceDate) return new Date(l.invoiceDate) > count ? { l, why: "invoiced after the count" } : null;
    const d = new Date(l.auctionDate);
    return d >= windowStart && d <= count ? { l, why: `auctioned within ${days} days of the count` } : null;
  }).filter((x): x is { l: AuctionLot; why: string } => !!x);

  const bySale = new Map<string, { l: AuctionLot; why: string }[]>();
  for (const x of picked) bySale.set(x.l.sale, [...(bySale.get(x.l.sale) ?? []), x]);
  return [...bySale.entries()].map(([sale, xs]) => ({
    sale,
    bags: Math.round(xs.reduce((s, x) => s + x.l.bags, 0) * 100) / 100,
    contracts: [...new Set(xs.map((x) => x.l.contract))],
    invoices: [...new Set(xs.map((x) => x.l.invoice).filter(Boolean))],
    auctionDate: xs[0].l.auctionDate,
    why: xs[0].why,
  })).sort((a, b) => b.bags - a.bags);
}
