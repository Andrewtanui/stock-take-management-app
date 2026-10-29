// Level 2 by contract: BRIC's Kenya stock (Comtras P526, held per purchase contract) explained with
// the Comtras 537 contract journal, and the journal's posting-timing lines around the count date.
// Pure, so the August figures can be tested. Used by the BRIC by contract panel on Reconciliation.
//
// "Invoiced onward after the count" = the part of a contract's BRIC stock that was invoiced to a
// buyer after the cut-off (capped at what BRIC holds). It is a cross-check for coffee afloat, not a
// calculation of it: coffee still in a warehouse at the count and shipped later counts here too.
// The 537 has no stuffing date; XBS's shipped-per-contract report would make it exact.
// August 2026: 36,417.4 bags against Finance's afloat 36,076 (0.9% apart).

import type { ComtrasLine } from "./comtras-parse";
import type { ContractLine } from "./contracts-parse";

export interface BricContract {
  contract: string;
  lineType: "Inventory" | "Longs";
  quality: string;
  /** Counterparty on the P526 line (the supplier). */
  counterparty: string;
  /** BRIC bags at the count (60 kg). */
  bric: number;
  /** In the 537 at all (the export may start after the contract did). */
  inJournal: boolean;
  /** Purchases invoiced on this contract in the 537, and the first booking date. */
  bought: number;
  boughtFirst?: string;
  /** Sales invoiced against this purchase contract, by the cut-off and after it. */
  soldBy: number;
  soldAfter: number;
  firstSaleAfter?: string;
  /** min(BRIC, sold after): BRIC stock at the count that was invoiced onward after it. */
  invoicedAfter: number;
  buyers: string[];
}

/** A journal line dated on or before the count but booked after it: it belongs to the month that was counted. */
export interface TimingLine {
  line: ContractLine;
  kind: "Purchase credit note" | "Sales credit note" | "Purchase invoice" | "Sales invoice" | "Correction";
  /** 60 kg bags, signed as in the journal (credit notes negative). */
  bags: number;
  contract: string;
}

const KIND: Record<number, TimingLine["kind"]> = { 11: "Purchase invoice", 21: "Sales invoice", 65: "Purchase credit note", 71: "Sales credit note" };
const kenya = (l: ComtrasLine) => /kenya/i.test(l.origin);

export function bricByContract(comtras: ComtrasLine[], journal: ContractLine[], cutOff: string) {
  const held = comtras.filter((l) => kenya(l) && (l.lineType === "Inventory" || l.lineType === "Longs"));
  const byPurchase = new Map<string, ContractLine[]>();
  for (const l of journal) if (l.purchaseContract) byPurchase.set(l.purchaseContract, [...(byPurchase.get(l.purchaseContract) ?? []), l]);

  // One row per contract and line type (a contract can hold inventory and longs).
  const rows = new Map<string, BricContract>();
  for (const l of held) {
    const key = `${l.contract}|${l.lineType}`;
    const had = rows.get(key);
    if (had) {
      had.bric += l.bags60;
      continue;
    }
    const lines = byPurchase.get(l.contract) ?? [];
    const sales = lines.filter((x) => x.sell60 !== 0);
    const after = sales.filter((x) => x.bookedOn > cutOff);
    const buys = lines.filter((x) => x.buy60 !== 0).sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
    rows.set(key, {
      contract: l.contract,
      lineType: l.lineType as "Inventory" | "Longs",
      quality: l.quality,
      counterparty: l.counterparty,
      bric: l.bags60,
      inJournal: lines.length > 0,
      bought: buys.reduce((s, x) => s + x.buy60, 0),
      boughtFirst: buys[0]?.bookedOn,
      soldBy: sales.filter((x) => x.bookedOn <= cutOff).reduce((s, x) => s + x.sell60, 0),
      soldAfter: after.reduce((s, x) => s + x.sell60, 0),
      firstSaleAfter: after.map((x) => x.bookedOn).sort()[0],
      invoicedAfter: 0,
      buyers: [...new Set(after.map((x) => x.counterparty))],
    });
  }
  const contracts = [...rows.values()];
  // Spread a contract's later sales over its inventory first, then its longs.
  const left = new Map<string, number>();
  for (const c of contracts.sort((a, b) => (a.lineType === b.lineType ? 0 : a.lineType === "Inventory" ? -1 : 1))) {
    const avail = left.get(c.contract) ?? Math.max(0, c.soldAfter);
    c.invoicedAfter = Math.min(Math.max(0, c.bric), avail);
    left.set(c.contract, avail - c.invoicedAfter);
  }
  contracts.sort((a, b) => b.bric - a.bric);

  // Posting timing: dated on or before the count date, booked after it.
  const timing: TimingLine[] = journal
    .filter((l) => l.voucherDate && l.voucherDate <= cutOff && l.bookedOn > cutOff)
    .map((l) => ({ line: l, kind: KIND[l.docType] ?? "Correction", bags: l.buy60 !== 0 ? l.buy60 : l.sell60, contract: l.purchaseContract || l.salesContract }))
    .sort((a, b) => Math.abs(b.bags) - Math.abs(a.bags));

  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
  const bric = sum(contracts, (c) => c.bric);
  const invoicedAfter = sum(contracts, (c) => c.invoicedAfter);
  return {
    contracts,
    timing,
    totals: {
      bric,
      linked: sum(contracts.filter((c) => c.inJournal), (c) => c.bric),
      notInJournal: contracts.filter((c) => !c.inJournal).length,
      invoicedAfter,
      /** BRIC stock not invoiced onward after the count: expected in the warehouses or the other bridge items. */
      rest: bric - invoicedAfter,
      timingBags: sum(timing, (t) => t.bags),
    },
  };
}
