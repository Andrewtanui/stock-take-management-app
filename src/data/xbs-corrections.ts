// The XBS correction batch (L5): every change XBS needs after the count, in one list for the XBS owner,
// so differences that are XBS's to fix stop coming back every month (19IM0001 was in Aug and Sep).
// Pure, so the list can be tested. Used by Reconciliation.
//
// Only what XBS has wrong. Timing items (direct sales and auction lots delivered after the count) and
// count errors are left out: XBS is right about those.
// - Write off: blocked lot of LARGE bags or more not found (recon-items "Data correction").
// - Adjust weight: blocked residue under LARGE bags not found (Finance's short weights).
// - Check: not in XBS: counted, in XBS nowhere - a receipt to post, a duplicate count or coffee off
//   system (Finance called Sep's three duplicates, Aug's 20EM0003 "not in XBS"). One letter
//   away from an outturn XBS has there in the same grade is a typing error (Aug KC8181 for KCS8181):
//   left out, and counted in `typed`.
// - Move in XBS: an Ibero lot short at one stack and over at another; the transfer wasn't posted.
// - Post the gate-out / release the block: lot still blocked to a contract the tracker shows as
//   stuffed, shipped or cancelled at the count.
// Lots with a recount still open are held back until it is done.

import { countItems } from "./recon-items";
import { typos } from "./variance-rules";
import type { ContractStates } from "./part-lots";
import type { SiteCode, Variance, XbsLine } from "./types";

export type CorrectionAction = "Write off" | "Adjust weight" | "Check: not in XBS" | "Move in XBS" | "Post the gate-out" | "Release the block";
export const CORRECTION_ACTIONS: CorrectionAction[] = ["Write off", "Adjust weight", "Check: not in XBS", "Move in XBS", "Post the gate-out", "Release the block"];

export interface Correction {
  action: CorrectionAction;
  site: SiteCode;
  /** Stack(s) at Ibero; "from → to" for a move. */
  where?: string;
  outturn: string;
  grade: string;
  batch?: string;
  contract?: string;
  /** 60 kg bags XBS holds less what is there (positive = XBS too high). For a move, the bags moved. */
  bags: number;
  why: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const up = (x: string) => x.trim().toUpperCase();
const gradeOf = (g: string) => g.split(" · ")[0];

export function xbsCorrections(input: {
  variances: Variance[];
  lines: XbsLine[];
  thirdParty: Set<SiteCode>;
  ibero: SiteCode;
  contracts?: ContractStates;
}): { rows: Correction[]; held: number; typed: number } {
  const { lines, thirdParty, ibero, contracts } = input;
  const lotOf = (v: Pick<Variance, "site" | "outturn" | "grade">) => `${v.site}|${up(v.outturn)}|${up(gradeOf(v.grade))}`;
  const pending = new Set(input.variances.filter((v) => v.state === "recount").map(lotOf));
  const variances = input.variances.filter((v) => !pending.has(lotOf(v)));
  const rows: Correction[] = [];

  // Bags not found per lot (XBS less counted, netted over the lot's variances).
  const short = new Map<string, number>();
  for (const v of variances) short.set(lotOf(v), (short.get(lotOf(v)) ?? 0) + ((v.expectedKg ?? v.expected * 60) - (v.countedKg ?? v.counted * 60)) / 60);

  // Lots still blocked to a contract that has left (or been cancelled) by the count. First, so a lot
  // not found for that reason is a gate-out to post, not a write-off. A stuffed or shipped lot that
  // was counted in full is the tracker's mistake, not XBS's: only the bags not found are listed.
  if (contracts)
    for (const l of lines) {
      if (!l.so) continue;
      const state = contracts.stuffed.has(l.so) ? "stuffed" : contracts.shipped.has(l.so) ? "shipped" : contracts.cancelled.has(l.so) ? "cancelled" : undefined;
      if (!state) continue;
      const k = lotOf({ site: l.wh, outturn: l.o, grade: l.i });
      const gone = state === "cancelled" ? l.kg / 60 : Math.min(l.kg / 60, short.get(k) ?? 0);
      if (gone < 0.01) continue;
      // A lot on several XBS lines: each line takes its share of the shortfall once.
      if (state !== "cancelled") short.set(k, (short.get(k) ?? 0) - gone);
      rows.push({
        action: state === "cancelled" ? "Release the block" : "Post the gate-out",
        site: l.wh,
        where: l.wh === ibero ? l.z : undefined,
        outturn: l.o,
        grade: l.i,
        batch: l.b,
        contract: l.so,
        bags: r2(gone),
        why: state === "cancelled" ? "Blocked to a contract cancelled in the shipment tracker." : `Blocked to contract ${l.so}, which the shipment tracker shows as ${state} by the count.`,
      });
    }

  const byContract = new Set(rows.map((r) => lotOf({ site: r.site, outturn: r.outturn, grade: r.grade })));

  const ACTION = { "Data correction": "Write off", "Short weights": "Adjust weight", "Counted, not in XBS": "Check: not in XBS" } as const;
  const WHY = {
    "Data correction": "Blocked in XBS, not found at the count: XBS holds coffee that is gone.",
    "Short weights": "Blocked residue, not found at the count.",
    "Counted, not in XBS": "Counted, but XBS has it nowhere: post the receipt if it came in, or confirm a duplicate count or coffee off system.",
  } as const;
  const inXbs = new Map<string, Set<string>>();
  for (const l of lines) {
    const k = `${l.wh}|${up(l.i)}`;
    inXbs.set(k, (inXbs.get(k) ?? new Set()).add(up(l.o)));
  }
  const typedFor = (site: SiteCode, outturn: string, grade: string) =>
    [...(inXbs.get(`${site}|${up(grade)}`) ?? [])].some((o) => o !== up(outturn) && typos(o, up(outturn)) <= 1);
  let typed = 0;
  for (const item of countItems(variances, lines, thirdParty)) {
    if (!(item.kind in ACTION)) continue;
    const kind = item.kind as keyof typeof ACTION;
    for (const l of item.lots)
      if (kind === "Counted, not in XBS" && typedFor(l.site, l.outturn, l.grade)) typed++;
      else if (!byContract.has(lotOf(l)))
        rows.push({ action: ACTION[kind], site: l.site, outturn: l.outturn, grade: l.grade, batch: l.batch, bags: r2(l.bags), why: WHY[kind] });
  }

  // Ibero lots moved between stacks: short at one, over at another, same outturn and grade.
  const byLot = new Map<string, Variance[]>();
  for (const v of variances) if (v.site === ibero) byLot.set(lotOf(v), [...(byLot.get(lotOf(v)) ?? []), v]);
  const kg = (v: Variance) => (v.countedKg ?? v.counted * 60) - (v.expectedKg ?? v.expected * 60);
  for (const vs of byLot.values()) {
    const from = vs.filter((v) => kg(v) <= -30);
    const to = vs.filter((v) => kg(v) >= 30);
    if (!from.length || !to.length) continue;
    const moved = Math.min(-from.reduce((a, v) => a + kg(v), 0), to.reduce((a, v) => a + kg(v), 0)) / 60;
    rows.push({
      action: "Move in XBS",
      site: ibero,
      where: `${from.map((v) => v.zone).join(", ")} → ${to.map((v) => v.zone).join(", ")}`,
      outturn: vs[0].outturn,
      grade: gradeOf(vs[0].grade),
      batch: vs.find((v) => v.batch)?.batch,
      bags: r2(moved),
      why: "Found at another stack: the transfer wasn't posted in XBS.",
    });
  }

  // One row per lot, action, place and contract (a lot can be on several XBS lines).
  const merged = new Map<string, Correction>();
  for (const r of rows) {
    const k = [r.action, r.site, r.where, up(r.outturn), up(r.grade), r.contract].join("|");
    const m = merged.get(k);
    if (m) m.bags = r2(m.bags + r.bags);
    else merged.set(k, { ...r });
  }
  const out = [...merged.values()];
  const order = (c: Correction) => CORRECTION_ACTIONS.indexOf(c.action);
  out.sort((a, b) => order(a) - order(b) || Math.abs(b.bags) - Math.abs(a.bags));
  return { rows: out, held: pending.size, typed };
}
