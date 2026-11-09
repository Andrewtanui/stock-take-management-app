// Evidence on a weight-loss exception from XBS's stock transfer and weighbridge (ticket) reports.
// Pure: works on the lot and the two reports, writes nothing. A statement is made only when the
// numbers prove it; when nothing is proven there is no evidence (and no comment). Agreed 4 Nov 2026.
//
//   Receipt over-posted   the lot came in on a transfer whose receipt was posted above what was sent,
//                         by what XBS is over the count (52NC0005: AGL sent 7,500 kg on TN-007867,
//                         Ibero posted 7,521.5, counted 7,500)
//   Lost on the truck     the weighbridge net of a ticket the lot came on is below what was sent on it
//   Receipts above truck  the receipts posted on that ticket are above what the truck weighed
// With one of those, two facts are added: what the weighbridge shows, and any balance of the
// instruction still to transfer.

import type { TransferLine, WeighTicket } from "./transfers-parse";

export interface EvidenceLot {
  /** XBS warehouse name of the site, as in the transfer report ("IBERO EXPORT WAREHOUSE"). */
  siteName: string;
  stack: string;
  outturn: string;
  grade: string;
  batch: string;
  expectedKg: number;
  countedKg: number;
}

export interface Evidence {
  /** Short rule names of what was proven, most likely first. */
  findings: string[];
  /** The comment: what was proven, from which reports, and how to resolve it. */
  text: string;
}

/** Weights agree within this (XBS keeps 0.1 kg, pockets are weighed to the kilo). */
const TOL_KG = 1;
/** Transfers received this many days before the count date (or on it) are looked at. */
const LOOKBACK_DAYS = 30;

const kg = (x: number) => `${x.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
const up = (s: string) => s.trim().toUpperCase();
/** "AGL-TEMP-0-0" -> "AGL"; "IBERO EXPORT WAREHOUSE-D-04-1" -> "IBERO EXPORT WAREHOUSE". */
export const warehouseOf = (zone: string) => zone.replace(/-[A-Z/]+-[\d/]+-\d+$/i, "").trim();
const dmy = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const stamp = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }) : "";

export function weightLossEvidence(
  lot: EvidenceLot,
  transfers: TransferLine[],
  tickets: WeighTicket[],
  o: { countDate: string; transfersAt?: string; ticketsAt?: string; short?: (warehouse: string) => string },
): Evidence | undefined {
  const short = o.short ?? ((w: string) => w);
  const gap = lot.expectedKg - lot.countedKg; // what XBS is over the count
  if (gap < TOL_KG) return undefined;
  const from = new Date(Date.parse(`${o.countDate}T00:00:00Z`) - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const here = `${up(lot.siteName)}-${up(lot.stack)}`;
  const sameLot = (t: TransferLine) => up(t.batch) === up(lot.batch) || (up(t.outturn) === up(lot.outturn) && up(t.grade) === up(lot.grade));
  const mine = transfers.filter(
    (t) =>
      t.receivedKg > 0 &&
      up(t.toZone) === here &&
      sameLot(t) &&
      !!t.receivedOn &&
      t.receivedOn >= from &&
      t.receivedOn <= o.countDate,
  );
  if (!mine.length) return undefined;

  const sent = mine.reduce((a, t) => a + t.issuedKg, 0);
  const received = mine.reduce((a, t) => a + t.receivedKg, 0);
  const senders = [...new Set(mine.map((t) => short(warehouseOf(t.fromZone))))].join(", ");
  const tns = [...new Set(mine.map((t) => t.ticket).filter((x): x is string => !!x))];
  const when = [...new Set(mine.map((t) => dmy(t.receivedOn)))].join(", ");
  const onTickets = tns.length ? `${tns.join(", ")}, ${when}` : when;
  const lines: string[] = [];
  const findings: string[] = [];

  // Receipt over-posted: received above sent by what XBS is over the count.
  const over = received - sent;
  if (over >= TOL_KG && Math.abs(gap - over) <= TOL_KG) {
    findings.push("Receipt over-posted");
    lines.push(
      `Most likely: the receipt was posted ${kg(over)} above what ${senders} sent (${onTickets}). ${senders} sent ${kg(sent)}; ${short(lot.siteName)} posted ${kg(received)}; the count found ${kg(lot.countedKg)}${Math.abs(lot.countedKg - sent) <= TOL_KG ? ", the same as was sent" : ""}. Resolve: correct the receipt in XBS.`,
    );
  }

  // The weighbridge, per ticket the lot came on: everything sent and received on that truck.
  for (const tn of tns) {
    const t = tickets.find((x) => x.ticket === tn);
    if (!t || t.netKg <= 0) continue;
    const onTruck = transfers.filter((x) => x.ticket === tn);
    const truckSent = onTruck.reduce((a, x) => a + x.issuedKg, 0);
    const truckReceived = onTruck.reduce((a, x) => a + x.receivedKg, 0);
    if (truckSent > 0 && t.netKg < truckSent - TOL_KG) {
      findings.push("Lost on the truck");
      lines.push(
        `${findings.length === 1 ? "Most likely: w" : "W"}eight lost on the way. On ${tn} the weighbridge net was ${kg(t.netKg)} against ${kg(truckSent)} sent (${kg(truckSent - t.netKg)} less, all lots on the truck). Resolve: claim from the transporter or ${senders}.`,
      );
    } else if (truckReceived > 0 && t.netKg < truckReceived - TOL_KG) {
      findings.push("Receipts above the truck");
      lines.push(
        `${findings.length === 1 ? "Most likely: r" : "R"}eceipts over-posted. The receipts on ${tn} total ${kg(truckReceived)}, ${kg(truckReceived - t.netKg)} more than the truck weighed (${kg(t.netKg)} net). Resolve: correct the receipts in XBS.`,
      );
    } else if (findings.length) {
      lines.push(`The weighbridge shows no loss on the truck: ${tn} weighed ${kg(t.netKg)} net against ${kg(truckSent)} sent.`);
    }
  }
  if (!findings.length) return undefined;

  // Anything of the same instructions still to transfer.
  const instructions = new Set(mine.map((t) => t.instruction));
  const pending = transfers.filter((t) => instructions.has(t.instruction) && t.balanceKg > 0 && sameLot(t) && !/complete/i.test(t.status));
  for (const t of pending)
    lines.push(`Also: ${kg(t.balanceKg)} of ${t.outturn} ${t.grade} on instruction ${t.instruction} is still at ${short(warehouseOf(t.fromZone))}, pending transfer.`);

  const src = [o.transfersAt && `stock transfers of ${stamp(o.transfersAt)}`, o.ticketsAt && `ticket summary of ${stamp(o.ticketsAt)}`].filter(Boolean).join(", ");
  return { findings, text: `${EVIDENCE_MARK} (XBS ${src || "stock transfers"}): ${lines.join(" ")}` };
}

/** Start of an evidence comment: Level 1 adds one per exception, once. */
export const EVIDENCE_MARK = "Evidence";
