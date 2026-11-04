// Part lots across the count date (L4): lots XBS holds at the snapshot that are likely to be partly
// gone, or only partly arrived, by the time they are counted. Listed before the count so the warehouse
// can send its delivery, collection and stuffing notes with the count instead of after it.
// Pure, so the lists can be tested. Used by Pre-count checks.
//
// Worked back from what August and September 2026 would have shown before their counts:
// - latest auction sale at third parties: Aug Sale 37, 3,749 bags in XBS, of which 1,720 were not
//   found (Finance's Sale 37 + Maxa + broker's account items); Sep Sale 41, 2,714 bags;
// - direct-sale lots just received at third parties: Aug 773 bags at AGL - Finance's DS item exactly;
// - lots blocked to a contract the tracker shows as stuffed: Sep 3787606, 1,208 bags stuffed 12 Sep and
//   still in XBS on 30 Sep; lots blocked to an open contract: Aug 3,361 bags at Ibero, most stuffed
//   in the first week of September.

import { cancelled, stuffingDates } from "./afloat";
import type { ShipmentLine } from "./shipments-parse";
import type { XbsStuffing } from "./xbs-shipped-parse";
import { RECENT_DAYS, saleOf, saleRank } from "./recon-items";
import type { Check, Site, SiteCode, XbsLine } from "./types";

export interface ContractStates {
  /** Some shipment stuffed by the count, not all sailed. */
  stuffed: Set<string>;
  /** Every shipment cancelled. */
  cancelled: Set<string>;
  /** Every shipment that isn't cancelled sailed by the count. */
  shipped: Set<string>;
  /** In the tracker, nothing stuffed yet. */
  open: Set<string>;
}

/** Each sales contract's state at the count, from the shipment tracker (XBS stuffing dates where loaded). */
export function contractStates(tracker: ShipmentLine[], cutOff: string, xbs: XbsStuffing[] = []): ContractStates {
  const by = new Map<string, ShipmentLine[]>();
  for (const l of stuffingDates(tracker, xbs).lines) by.set(l.salesContract, [...(by.get(l.salesContract) ?? []), l]);
  const out: ContractStates = { stuffed: new Set(), cancelled: new Set(), shipped: new Set(), open: new Set() };
  for (const [c, ls] of by) {
    const live = ls.filter((l) => !cancelled(l));
    if (!live.length) out.cancelled.add(c);
    else if (live.every((l) => l.sailedOn && l.sailedOn <= cutOff)) out.shipped.add(c);
    else if (live.some((l) => l.stuffedOn && l.stuffedOn <= cutOff)) out.stuffed.add(c);
    else out.open.add(c);
  }
  return out;
}

const bagsOf = (l: XbsLine) => Math.round((l.kg / 60) * 100) / 100;
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/**
 * The part-lot checks for the snapshot `lines`. `open` = contracts the tracker shows as not stuffed
 * yet (left out when no tracker is loaded).
 */
export function partLotChecks(lines: XbsLine[], sites: Site[], open?: Set<string>): Check[] {
  const W = lines.filter((l) => l.t === "W");
  const tp = new Set<SiteCode>(sites.filter((s) => s.thirdParty).map((s) => s.code));
  const short = (c: SiteCode) => sites.find((s) => s.code === c)?.short ?? c;
  const where = (l: XbsLine) => (tp.has(l.wh) ? short(l.wh) : `${short(l.wh)} ${l.z ?? ""}`.trim());
  const rows = (xs: XbsLine[], info: (l: XbsLine) => string) =>
    xs.map((l) => ({ ref: l.o, where: where(l), info: info(l), bags: bagsOf(l) }));
  const perSite = (xs: XbsLine[]) =>
    [...new Set(xs.map((l) => l.wh))].map((w) => `${short(w)} ${Math.round(sum(xs.filter((l) => l.wh === w), bagsOf)).toLocaleString("en-GB")}`).join(", ");

  const top = Math.max(0, ...W.map((l) => saleRank(l.b) ?? 0));
  const latest = top ? W.filter((l) => tp.has(l.wh) && saleRank(l.b) === top) : [];
  const sale = top % 1000;
  const ds = W.filter((l) => tp.has(l.wh) && saleOf(l.b)?.startsWith("DS") && (l.d ?? Infinity) <= RECENT_DAYS);
  const blocked = open ? W.filter((l) => l.so && open.has(l.so)) : [];

  const out: Check[] = [
    {
      id: "latest-sale", severity: "medium", owner: "Logistics",
      title: `Sale ${sale} lots at third parties`,
      detail: `The latest auction is being collected and delivered across the count date, so some of these lots will be partly or wholly gone when counted. Ask each warehouse for its delivery and collection notes up to count day (${perSite(latest)} bags in XBS).`,
      count: latest.length, bags: Math.round(sum(latest, bagsOf)), unit: "lots",
      rows: rows(latest, (l) => `Sale ${sale} · ${l.i}${l.g ? " · " + l.g : ""}${l.bl ? " · blocked" : ""}`),
    },
    {
      id: "ds-arriving", severity: "medium", owner: "Logistics",
      title: "Direct-sale lots just received at third parties",
      detail: `In XBS for ${RECENT_DAYS} days or less. Deliveries are still arriving, so the bags may not be at the warehouse yet on count day. Confirm what has physically arrived (${perSite(ds)} bags in XBS).`,
      count: new Set(ds.map((l) => saleOf(l.b))).size, bags: Math.round(sum(ds, bagsOf)), unit: "delivery slips",
      rows: rows(ds, (l) => `${saleOf(l.b)} · ${l.i} · ${l.d ?? "?"} days`),
    },
  ];
  if (open)
    out.push({
      id: "being-stuffed", severity: "medium", owner: "Warehouse",
      title: "Blocked to a contract not yet stuffed",
      detail: "These lots may be pulled for stuffing on count day. Note every lot taken out before or during the count, with its stuffing order, so a short isn't chased as a loss.",
      count: new Set(blocked.map((l) => l.so)).size, bags: Math.round(sum(blocked, bagsOf)), unit: "contracts",
      rows: rows(blocked, (l) => `Contract ${l.so} · ${l.i}`),
    });
  return out;
}
