// The BRIC bridge filled in by the Hub: each reconciling item worked out from its source, for
// Finance to accept, change or leave out instead of typing it. Pure, so the figures can be tested.
// Used by the BRIC bridge on Reconciliation.
//
// Rules worked back from Finance's August and September 2026 bridges:
// - afloat (tracker + 537, see afloat.ts): Jul 41,584, Aug 36,076, Sep 19,060 - Finance's to the bag;
// - the count's items (recon-items.ts): direct-sale lots received after the count, the latest
//   auction sale not delivered, XBS data corrections, short weights, counted not in XBS, count
//   errors. Aug: 773.21, 1,719.78 (Finance 1,663.57 + Maxa 23.55 + broker 32.67), 29.57, 16.70;
// - Kenyan longs: the P526 Kenya "Longs" lines less the direct-sale item, which BRIC holds as longs
//   (Aug 2,631.07 - 773.21 = 1,857.86, Finance 1,858). Sep: Finance 1,335 from 1,346.93 - to confirm.
// The franchise is what is left; Finance types it.

import { AFLOAT_DEFAULT, afloatBags, afloatShipments, type AfloatGroup } from "./afloat";
import type { ComtrasLine } from "./comtras-parse";
import type { ContractLine } from "./contracts-parse";
import type { ShipmentLine } from "./shipments-parse";
import type { XbsStuffing } from "./xbs-shipped-parse";
import { countItems, type CountItemKind } from "./recon-items";
import type { ReconItem, Site, Variance, XbsLine } from "./types";

export interface Proposal {
  /**
   * Typed items can be swapped for this one ("Replace typed"). Off for every line until Finance confirms
   * the rules: on 27 Oct replacing her afloat and longs over-explained August by 2,653 bags.
   */
  replaces?: boolean;
  /** Stable key: the label the item gets on the bridge, so an accepted one is recognised. */
  label: string;
  kind: ReconItem["kind"];
  bags: number;
  inXbs: boolean;
  /** Where the figure comes from, in plain words (saved as the item's note). */
  source: string;
  /** Lines behind it, for the "how" text. */
  detail: string;
  /** Already on the bridge under this label, or the same kind of item typed by Finance. */
  onBridge?: ReconItem;
  similar?: ReconItem[];
}

export interface ProposalInput {
  cutOff?: string;
  comtras?: ComtrasLine[];
  journal?: ContractLine[];
  shipments?: ShipmentLine[];
  /** XBS stuffing dates; they replace the tracker's where XBS has the shipment. */
  xbsStuffing?: XbsStuffing[];
  variances: Variance[];
  /** The stock take's XBS snapshot (batch numbers, blocked, days in stock). */
  lines: XbsLine[];
  sites: Site[];
  items: ReconItem[];
  /** Finance's afloat rule; until she confirms it, the panel's defaults. */
  afloat?: { groups: AfloatGroup[]; months: number };
}

export const LABELS = {
  afloat: "Stuffed coffee, afloat (tracker + 537)",
  longs: "Kenyan longs (P526)",
};

/** Typed items that look like the same item, by Finance's own words for them. */
const ALIKE: Record<CountItemKind, RegExp> = {
  "Direct sale not counted": /\bDS\s?\d/i,
  "Sale not delivered": /\bsale\b|\bS_?\d+\b/i,
  "Data correction": /correction/i,
  "Short weights": /short\s*weight/i,
  "Counted, not in XBS": /duplicate|not in xbs|off system/i,
  "Count error": /recount|count error/i,
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function bridgeProposals(p: ProposalInput): Proposal[] {
  const out: Proposal[] = [];
  const has = (label: string) => p.items.find((i) => i.label === label);
  const alike = (test: (i: ReconItem) => boolean) => p.items.filter(test);

  // Afloat: shipments stuffed before the count, not invoiced by it.
  if (p.cutOff && p.shipments?.length && p.journal?.length) {
    const rule = p.afloat ?? { groups: AFLOAT_DEFAULT, months: 2 };
    const a = afloatShipments(p.shipments, p.journal, p.cutOff, rule.months, p.xbsStuffing);
    const n = a.rows.filter((x) => rule.groups.includes(x.group)).length;
    out.push({
      label: LABELS.afloat,
      kind: "Coffee afloat",
      bags: r2(afloatBags(a.totals, rule.groups)),
      inXbs: true,
      source: `Shipment tracker + 537: ${n} shipments stuffed ${a.since} to ${p.cutOff}, not invoiced by the count (${rule.groups.join(", ").toLowerCase()}).`,
      detail: rule.groups.map((g) => `${g}: ${Math.round(a.totals[g].bags)}`).join(" · "),
      onBridge: has(LABELS.afloat),
      similar: alike((i) => i.kind === "Coffee afloat" && i.label !== LABELS.afloat),
    });
  }

  // The count's items: each lot's difference against XBS, sorted by Finance's rules.
  const thirdParty = new Set(p.sites.filter((x) => x.thirdParty).map((x) => x.code));
  const items = countItems(p.variances, p.lines, thirdParty);
  const ds = items.find((i) => i.kind === "Direct sale not counted");

  // Kenyan longs: contracted coffee BRIC holds as Longs (Kenya lines of the P526), less the
  // direct-sale lots not counted, which are those longs already in XBS (their own item below).
  const longs = (p.comtras ?? []).filter((l) => l.lineType === "Longs" && /kenya/i.test(l.origin));
  if (longs.length) {
    const p526 = longs.reduce((s, l) => s + l.bags60, 0);
    out.push({
      label: LABELS.longs,
      kind: "Reconciling item",
      bags: r2(p526 - (ds?.bags ?? 0)),
      inXbs: true,
      source: `Comtras P526: ${longs.length} Kenya "Longs" lines, ${r2(p526)} bags${ds ? `, less ${ds.bags} of direct-sale lots in XBS not counted (their own item)` : ""}.`,
      detail: `Contracts ${[...new Set(longs.map((l) => l.contract))].slice(0, 8).join(", ")}${longs.length > 8 ? "…" : ""}.`,
      onBridge: has(LABELS.longs),
      similar: alike((i) => i.label !== LABELS.longs && /\blongs?\b/i.test(i.label)),
    });
  }

  for (const i of items)
    out.push({
      label: i.label,
      kind: "Reconciling item",
      bags: i.bags,
      inXbs: false,
      source: `Level 1, ${i.lots.length} lot${i.lots.length === 1 ? "" : "s"}: ${i.kind.toLowerCase()}.`,
      detail: i.lots
        .slice(0, 8)
        .map((l) => `${l.outturn} ${l.grade} (${l.site}) ${l.bags}`)
        .join(" · ") + (i.lots.length > 8 ? ` · and ${i.lots.length - 8} more` : ""),
      onBridge: has(i.label),
      similar: alike((x) => x.label !== i.label && x.kind === "Reconciling item" && ALIKE[i.kind].test(x.label)),
    });
  return out;
}

