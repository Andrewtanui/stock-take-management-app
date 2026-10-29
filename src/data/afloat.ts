// Coffee afloat from the shipment tracker and the Comtras 537: coffee that left the warehouse (stuffed)
// by the count date but was not yet invoiced to the buyer then, so BRIC still holds it while XBS no
// longer does. Pure, so the figures can be tested. Used by the Afloat panel on Reconciliation.
//
// Finance's rule (worked back from F26 P08 "Coffee afloat", 36,076; matches July 41,584 and
// September 19,060 to the bag):
// shipments stuffed in the count's month and the two before it, less the bags sales-invoiced
// (537 symbol 21, 60 kg bags) on their sales contract by the count date; cancelled shipments out.
// A contract invoiced in part counts only the part not invoiced. Invoices are set against the
// contract's shipments oldest first, as the coffee left.
//
// Each shipment falls in one group; Finance (Njambi) decides which groups count as afloat:
// - invoiced by the count: sold, out of BRIC too - never afloat;
// - not sailed by the count: stuffed, still in Kenya (port / container yard);
// - sailed, not invoiced by the count: on the water;
// - not in the 537: no sales invoice on the contract at all and stuffed over NOT_IN_537_DAYS
//   before the count - invoiced before the export reaches; not counted unless Finance ticks it.
// Stuffing dates: XBS's shipped report where it has the shipment (the warehouse's own record), else
// the tracker's. A month the XBS report covers but that doesn't list a tracker shipment means the
// tracker date is wrong: that shipment is set aside and flagged. With XBS dates no hand exclusion
// is needed (Sep 2026: 3787605 tracker 18 Aug, XBS 21 Sep; 3787606 tracker Sep, not in XBS's Sep).

import type { ContractLine } from "./contracts-parse";
import type { ShipmentLine } from "./shipments-parse";
import { siNumber, type XbsStuffing } from "./xbs-shipped-parse";

export type AfloatGroup = "Not sailed" | "Sailed, not invoiced" | "Not in the 537" | "Invoiced by the count";
export const AFLOAT_GROUPS: AfloatGroup[] = ["Not sailed", "Sailed, not invoiced", "Not in the 537", "Invoiced by the count"];
/**
 * A shipment whose contract has no sales invoice anywhere in the 537 and that was stuffed longer ago
 * than this is taken as invoiced outside the export (the 537 holds contracts still open; ones fully
 * invoiced earlier drop out). Invoices come a median 41 days after stuffing; every uninvoiced shipment
 * Finance counted (Jul-Sep 2026) was 44 days old or less, every one they left out 56 or more.
 */
export const NOT_IN_537_DAYS = 50;
/** The groups counted as afloat, as Finance does. */
export const AFLOAT_DEFAULT: AfloatGroup[] = ["Not sailed", "Sailed, not invoiced"];

export interface AfloatShipment {
  /** The tracker's line, with the stuffing date XBS gives where it has one. */
  line: ShipmentLine;
  /** Where the stuffing date comes from; the tracker's own date when XBS differs. */
  dateFrom: "XBS" | "Tracker";
  trackerStuffedOn?: string;
  group: AfloatGroup;
  /** Bags of this shipment not invoiced by the count: what is afloat. */
  afloat: number;
  /** Bags of this shipment covered by sales invoices dated by the count. */
  invoiced: number;
  /** First sales invoice on the sales contract in the 537, if any. */
  firstInvoice?: string;
}

/** Sales invoices (document type 21) per sales contract: the earliest voucher date. */
export function firstSalesInvoice(journal: ContractLine[]) {
  const first = new Map<string, string>();
  for (const l of journal) {
    if (l.docType !== 21 || !l.salesContract || !l.voucherDate) continue;
    const had = first.get(l.salesContract);
    if (!had || l.voucherDate < had) first.set(l.salesContract, l.voucherDate);
  }
  return first;
}

/** Bags (60 kg) sales-invoiced per sales contract with a voucher date on or before the cut-off. */
export function invoicedBy(journal: ContractLine[], cutOff: string) {
  const sum = new Map<string, number>();
  for (const l of journal) {
    if (l.docType !== 21 || !l.salesContract || !l.voucherDate || l.voucherDate > cutOff) continue;
    sum.set(l.salesContract, (sum.get(l.salesContract) ?? 0) + l.sell60);
  }
  return sum;
}

/** Cancelled in the tracker: the status says so, or the B/L column does ("Cancelled"). */
export const cancelled = (l: ShipmentLine) => /cancel/i.test(l.status) || /cancel/i.test(l.bl);

/**
 * Sales contracts left out by hand, with the reason, when no XBS stuffing date is loaded for them
 * (an XBS date replaces this). Without it August is 1,280 over Finance's 36,076.
 */
export const AFLOAT_EXCLUDED: Record<string, string> = {
  "3787605": "Tracker says stuffed 18 Aug; XBS shipped report says 21 Sep. Finance leaves it out of August.",
};

export interface StuffingCheck {
  line: ShipmentLine;
  tracker?: string;
  xbs?: string;
  /** Tracker and XBS disagree, or XBS covers the tracker's month but doesn't list the shipment. */
  issue: "Different date" | "Not in XBS";
}

/**
 * The stuffing date of each tracker line: XBS's when the XBS report has the shipment (same sales
 * contract and SI number; the date whose bags are closest when it has several), else the tracker's.
 * A tracker date in a month the XBS report covers, for a shipment XBS doesn't list, is dropped.
 */
export function stuffingDates(shipments: ShipmentLine[], xbs: XbsStuffing[]) {
  const covered = new Set(xbs.map((x) => x.stuffedOn.slice(0, 7)));
  const byContract = new Map<string, XbsStuffing[]>();
  for (const x of xbs) byContract.set(x.salesContract, [...(byContract.get(x.salesContract) ?? []), x]);
  const lines: ShipmentLine[] = [];
  const from = new Map<ShipmentLine, { dateFrom: "XBS" | "Tracker"; tracker?: string }>();
  const checks: StuffingCheck[] = [];
  for (const l of shipments) {
    const all = byContract.get(l.salesContract) ?? [];
    const si = siNumber(l.si);
    const cand = (si && all.filter((x) => x.si === si).length ? all.filter((x) => x.si === si) : all).slice();
    let line = l;
    if (cand.length) {
      const best = cand.sort((a, b) => Math.abs(a.bags - l.bags) - Math.abs(b.bags - l.bags) || a.stuffedOn.localeCompare(b.stuffedOn))[0];
      line = { ...l, stuffedOn: best.stuffedOn };
      // XBS usually books the stuffing 1-5 days after the tracker's date (Sep 2026: 31 of 34); only a
      // gap that can move a shipment across a count is worth a flag.
      const gap = l.stuffedOn ? Math.abs(Date.parse(l.stuffedOn) - Date.parse(best.stuffedOn)) / 86_400_000 : Infinity;
      if (gap > 7 || l.stuffedOn?.slice(0, 7) !== best.stuffedOn.slice(0, 7)) checks.push({ line, tracker: l.stuffedOn, xbs: best.stuffedOn, issue: "Different date" });
      from.set(line, { dateFrom: "XBS", tracker: l.stuffedOn });
    } else if (l.stuffedOn && covered.has(l.stuffedOn.slice(0, 7)) && !cancelled(l)) {
      line = { ...l, stuffedOn: undefined };
      checks.push({ line: l, tracker: l.stuffedOn, issue: "Not in XBS" });
      from.set(line, { dateFrom: "Tracker", tracker: l.stuffedOn });
    } else from.set(line, { dateFrom: "Tracker" });
    lines.push(line);
  }
  return { lines, from, checks, covered: [...covered].sort() };
}

/** Day limits of the ageing buckets (setting AfloatAgeingDays; D6 to confirm). */
export const AGEING_DEFAULT = [30, 60];

/** Bags afloat by days since stuffing at the count: "0-30 days", "31-60 days", "Over 60 days". */
export function afloatAgeing(rows: AfloatShipment[], cutOff: string, groups: AfloatGroup[], limits = AGEING_DEFAULT) {
  const edges = [...limits].sort((a, b) => a - b);
  const buckets = [...edges.map((d, i) => ({ label: `${i ? edges[i - 1] + 1 : 0}-${d} days`, max: d })), { label: `Over ${edges[edges.length - 1]} days`, max: Infinity }].map((b) => ({ ...b, shipments: 0, bags: 0 }));
  for (const r of rows) {
    if (!groups.includes(r.group) || r.group === "Invoiced by the count" || r.afloat <= 0) continue;
    const days = Math.round((Date.parse(cutOff) - Date.parse(r.line.stuffedOn!)) / 86_400_000);
    const b = buckets.find((x) => days <= x.max)!;
    b.shipments++;
    b.bags += r.afloat;
  }
  return buckets;
}

/** First day of the month `months` before the cut-off's month ("2026-08-31", 2 -> "2026-06-01"). */
export function monthsBefore(cutOff: string, months: number) {
  const d = new Date(`${cutOff.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Shipments stuffed from `since` to the cut-off, each with its afloat bags and group. `months` = how
 * many months before the count's month to look back (2: June-August for an August count).
 */
export function afloatShipments(tracker: ShipmentLine[], journal: ContractLine[], cutOff: string, months = 2, xbs: XbsStuffing[] = []) {
  const since = monthsBefore(cutOff, months);
  const first = firstSalesInvoice(journal);
  const invoiced = invoicedBy(journal, cutOff);
  const dates = stuffingDates(tracker, xbs);
  const shipments = dates.lines;

  // Invoices are set against every shipment of the contract stuffed by the cut-off, oldest first, so
  // an invoice for coffee shipped before the look-back doesn't make a later shipment look sold.
  const left = new Map<ShipmentLine, number>();
  const byContract = new Map<string, ShipmentLine[]>();
  const excluded: ShipmentLine[] = [];
  for (const l of shipments) {
    if (!l.stuffedOn || l.stuffedOn > cutOff || cancelled(l)) continue;
    if (AFLOAT_EXCLUDED[l.salesContract] && dates.from.get(l)?.dateFrom !== "XBS") {
      if (l.stuffedOn >= since) excluded.push(l);
      continue;
    }
    byContract.set(l.salesContract, [...(byContract.get(l.salesContract) ?? []), l]);
  }
  for (const [contract, lines] of byContract) {
    let inv = Math.max(0, invoiced.get(contract) ?? 0);
    for (const l of [...lines].sort((a, b) => a.stuffedOn!.localeCompare(b.stuffedOn!) || a.row - b.row)) {
      const used = Math.min(l.bags, inv);
      inv -= used;
      // Under a bag left is rounding (tracker 1,667 bags, 537 1,666.67 of 60 kg): invoiced.
      left.set(l, l.bags - used < 1 ? 0 : l.bags - used);
    }
  }

  const rows: AfloatShipment[] = shipments
    .filter((l) => left.has(l) && l.stuffedOn! >= since)
    .map((line) => {
      const afloat = left.get(line)!;
      const old = (Date.parse(cutOff) - Date.parse(line.stuffedOn!)) / 86_400_000 > NOT_IN_537_DAYS;
      const group: AfloatGroup =
        afloat <= 0
          ? "Invoiced by the count"
          : old && !first.has(line.salesContract)
            ? "Not in the 537"
            : !line.sailedOn || line.sailedOn > cutOff
              ? "Not sailed"
              : "Sailed, not invoiced";
      const f = dates.from.get(line)!;
      return { line, dateFrom: f.dateFrom, trackerStuffedOn: f.tracker, group, afloat, invoiced: line.bags - afloat, firstInvoice: first.get(line.salesContract) };
    })
    .sort((a, b) => b.afloat - a.afloat || b.line.bags - a.line.bags);
  const totals = Object.fromEntries(AFLOAT_GROUPS.map((g) => [g, { shipments: 0, bags: 0 }])) as Record<AfloatGroup, { shipments: number; bags: number }>;
  for (const r of rows) {
    totals[r.group].shipments++;
    // Afloat groups add the bags still afloat; the invoiced group the bags sold by the count.
    totals[r.group].bags += r.group === "Invoiced by the count" ? r.invoiced : r.afloat;
  }
  // Date issues that touch this count: either date in the look-back.
  const near = (d?: string) => !!d && d >= since && d <= cutOff;
  const checks = dates.checks.filter((c) => near(c.tracker) || near(c.xbs));
  return { since, rows, totals, excluded, checks, xbsMonths: dates.covered };
}

/** Bags afloat for the chosen groups. */
export const afloatBags = (totals: Record<AfloatGroup, { bags: number }>, groups: AfloatGroup[]) =>
  groups.filter((g) => g !== "Invoiced by the count").reduce((s, g) => s + totals[g].bags, 0);
// "Not in the 537" is not in AFLOAT_DEFAULT: Finance can tick it if one of those is really afloat.
