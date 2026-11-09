// Level 1 decisions the Hub takes on its own, so a supervisor only sees what the
// rules can't settle. Pure: works on variances and count facts, writes nothing.
// dataverse.ts applies the plan right after variances are refreshed.
//
// On a new, undecided variance:
//   A  the same outturn over and short across stacks/warehouses, netting to about 0
//        -> accepted: bags moved, XBS location to fix (Warehouse gets the list)
//        (or netting by weight, within AutoUnitOnlyKg or 1%, when the units differ: bagged differently)
//   B  bag count matches XBS, weight off by less than the weight-loss threshold
//        -> accepted: pocket / unit difference
//   C  bag count matches, weight under by the threshold or more -> weight-loss exception
//        (Warehouse for outturns starting with K, Ibero's own lots; Logistics for the rest)
//   B2 bag count differs but the weight is within AutoUnitOnlyKg (5 kg) -> accepted: pocket / unit difference
//   N  a third-party site not counted on purpose -> accepted, carried to the reconciliation
//   D1 third-party lot short or not found (partial delivery / gate-out not posted)
//        -> one exception per site for Logistics, listing the lots
//   W  counted under a number XBS doesn't have, but XBS has one lot a character or two off with the
//        same grade and weight (variance-rules' "Wrong lot number?"):
//        that lot short by the same weight at the same site -> both accepted (the bags are there;
//        correct the number on the count); otherwise -> "wrong lot number" exception (Warehouse)
//   D2 counted but not in XBS anywhere -> "found, not in XBS" exception
//   D3 anything else -> blind recount by a different counter
// After a blind recount (a recount line exists for the lot):
//   matches XBS          -> accepted (done in syncVariances: the difference disappears)
//   repeats the previous count -> exception with the suggested cause
//   neither              -> back to the supervisor (a third count, or decide)

import type { Dept, Priority, RootCause, SiteCode } from "./types";
import { WRONG_LOT_MARK, type CountFact } from "./variance-rules";

export interface AutoSettings {
  /** Master switch (setting AutoDecide). */
  on: boolean;
  /** Bags match but weight is this many kg (or more) under XBS: weight-loss exception (AutoWeightLossKg). */
  weightLossKg: number;
  /** Over/short across locations nets to within this many units: treated as moved (AutoNetUnits). */
  netUnits: number;
  /** Accept "bags match, weight slightly off" automatically (AutoAcceptPocket). */
  acceptPocket: boolean;
  /** Bag count differs but the weight is within this many kg: the same coffee bagged or pocketed
   * differently, accepted as a pocket / unit difference without a recount (AutoUnitOnlyKg). */
  unitOnlyKg: number;
  /** An exception this many 60 kg bags or more is High (ExceptionHighBags). */
  highBags: number;
  /** An exception this many bags or fewer is Low and goes on its warehouse's list (ExceptionLowBags). */
  lowBags: number;
}

export const AUTO_DEFAULTS: AutoSettings = { on: true, weightLossKg: 20, netUnits: 1, acceptPocket: true, unitOnlyKg: 5, highBags: 10, lowBags: 2 };

/** Priority of an exception by its size in 60 kg bags. */
export const priorityFor = (bags: number, s: Pick<AutoSettings, "highBags" | "lowBags"> = AUTO_DEFAULTS): Priority =>
  bags >= s.highBags ? "High" : bags <= s.lowBags ? "Low" : "Medium";

export interface AutoVariance {
  id: string;
  /** Draft key: `${site}|${stack or ""}|${batch}`. */
  key: string;
  site: SiteCode;
  stack: string;
  outturn: string;
  expectedUnits: number;
  countedUnits: number;
  expectedKg: number;
  countedKg: number;
  /** The suggested cause, and why it was suggested. */
  cause: RootCause;
  suggestion?: string;
  state: "open" | "recount";
  /** Someone (or an earlier automatic pass) already decided it once. */
  decided: boolean;
}

export interface AutoAction {
  id: string;
  act: "accept" | "recount" | "exception" | "review";
  cause: RootCause;
  /** Short rule name, shown with the decision. */
  rule: string;
  /** Replaces the variance's explanation. */
  why: string;
  dept?: Dept;
  /** Variances sharing a group get one exception between them: `site:XX` (third-party lots to
   * confirm) or `low:XX` (the warehouse's low-priority list). */
  group?: string;
  /** Exceptions: size of the difference in 60 kg bags, and its priority. */
  bags?: number;
  priority?: Priority;
}

/** One side of a move: an open variance, or one already accepted as moved (weights when known). */
export type MovedSide = Pick<AutoVariance, "site" | "stack" | "outturn" | "expectedUnits" | "countedUnits"> & Partial<Pick<AutoVariance, "expectedKg" | "countedKg">>;

const n = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const signed = (x: number) => `${x > 0 ? "+" : ""}${n(x)}`;

export function planAutoDecisions(
  variances: AutoVariance[],
  counts: CountFact[],
  thirdParty: Set<SiteCode>,
  s: AutoSettings,
  siteShort: (c: SiteCode) => string = (c) => c,
  /** Lots already accepted as moved: a pair half decided when Level 1 was interrupted finishes against them. */
  moved: MovedSide[] = [],
): AutoAction[] {
  if (!s.on) return [];
  const out: AutoAction[] = [];
  const done = new Set<string>();
  const add = (a: AutoAction) => {
    out.push(a);
    done.add(a.id);
  };
  const fresh = variances.filter((v) => v.state === "open" && !v.decided);

  // N: a third-party site not counted on purpose: its lots go to the reconciliation, not to a recount.
  for (const v of fresh)
    if (v.cause === "Third party not counted")
      add({ id: v.id, act: "accept", cause: "Third party not counted", rule: "Not counted on purpose",
        why: `Decided automatically (not counted on purpose): ${siteShort(v.site)} wasn't counted. XBS has ${n(v.expectedUnits)} units of ${v.outturn} there; carried to the reconciliation as a reconciling item.` });

  // A: moved. Same outturn on several lots whose differences net to about zero.
  const byOutturn = new Map<string, AutoVariance[]>();
  for (const v of fresh) if (!done.has(v.id)) byOutturn.set(v.outturn, [...(byOutturn.get(v.outturn) ?? []), v]);
  for (const [outturn, mine] of byOutturn) {
    // Nets by units, or else by weight (within AutoUnitOnlyKg or 1%): the same coffee bagged or
    // pocketed differently on the two sides (Oct 2026: KDI6002 10 units / 687 kg in XBS at B-14-1,
    // counted 12 units / 681 kg at B-13-13), or XBS units that don't add up (KDI5390: 7 units a 70 kg line).
    const netUnits = (g: MovedSide[]) => g.reduce((a, v) => a + v.countedUnits - v.expectedUnits, 0);
    const netKg = (g: MovedSide[]) => g.reduce((a, v) => a + (v.countedKg ?? 0) - (v.expectedKg ?? 0), 0);
    const byWeight = (g: MovedSide[]) =>
      g.every((v) => v.countedKg !== undefined && v.expectedKg !== undefined) && Math.abs(netKg(g)) <= Math.max(s.unitOnlyKg, g.reduce((a, v) => a + (v.expectedKg ?? 0), 0) * 0.01);
    // Moved needs both sides: over somewhere and short somewhere else.
    const nets = (g: MovedSide[]) =>
      g.length >= 2 && (Math.abs(netUnits(g)) <= s.netUnits || byWeight(g)) && g.some((v) => v.countedUnits > v.expectedUnits) && g.some((v) => v.countedUnits < v.expectedUnits);
    // The other side of a move may already be accepted (Level 1 stopped between the two): use it.
    const group = nets(mine) ? mine : [...mine, ...moved.filter((m) => m.outturn === outturn)];
    if (!nets(group)) continue;
    const net = netUnits(group);
    const weight = Math.abs(net) > s.netUnits;
    const sites = new Set(group.map((v) => v.site));
    const where = group.map((v) => `${siteShort(v.site)}${v.stack ? " " + v.stack : ""} ${signed(v.countedUnits - v.expectedUnits)}`).join(", ");
    const oneThirdParty = sites.size === 1 && thirdParty.has(group[0].site);
    const rule = sites.size > 1 ? "Moved between warehouses" : oneThirdParty ? "Counted under another batch" : "Moved within the warehouse";
    const fix = oneThirdParty
      ? `The outturn's total at ${siteShort(group[0].site)} matches XBS; the bags were counted against a different batch of it. Warehouse to check the batch labels.`
      : "The bags are there; XBS has them in the wrong place. Warehouse to update the location in XBS.";
    for (const v of mine)
      add({
        id: v.id,
        act: "accept",
        cause: "Split lot",
        rule,
        why: `Decided automatically (${rule.toLowerCase()}): ${outturn} is over in one place and short in another (${where}), netting to ${weight ? `${signed(netKg(group))} kg (${signed(net)} units: bagged or pocketed differently)` : `${signed(net)} units`}. ${fix}`,
      });
  }

  // W: counted under a mistyped lot number. Before the per-lot rules, so the short side isn't recounted.
  for (const v of fresh) {
    if (done.has(v.id) || v.cause !== "Mapping error" || v.expectedUnits !== 0 || !v.suggestion?.startsWith(WRONG_LOT_MARK)) continue;
    const likely = v.suggestion.slice(WRONG_LOT_MARK.length).trim().split(/\s/)[0].replace(/\.$/, "");
    const short = fresh.find(
      (p) => !done.has(p.id) && p.id !== v.id && p.site === v.site && p.outturn.toUpperCase() === likely.toUpperCase() && p.countedKg < p.expectedKg &&
        Math.abs(p.expectedKg - p.countedKg - v.countedKg) <= Math.max(s.unitOnlyKg, p.expectedKg * 0.01),
    );
    if (short) {
      const why = `Decided automatically (wrong lot number): ${v.outturn} (${n(v.countedKg)} kg counted${v.stack ? " at " + v.stack : ""}) isn't in XBS, and ${likely} is short by the same weight${short.stack ? " at " + short.stack : ""}. The bags are there under a mistyped number; Warehouse to correct the lot number on the count.`;
      add({ id: v.id, act: "accept", cause: "Mapping error", rule: "Wrong lot number", why });
      add({ id: short.id, act: "accept", cause: "Mapping error", rule: "Wrong lot number", why });
    } else
      add({ id: v.id, act: "exception", cause: "Mapping error", rule: "Wrong lot number", dept: "Warehouse",
        why: `Decided automatically (wrong lot number): ${v.suggestion}` });
  }

  for (const v of fresh) {
    if (done.has(v.id)) continue;
    const d = v.countedUnits - v.expectedUnits;
    const dkg = v.countedKg - v.expectedKg;
    // B / C: the bag count matches.
    if (d === 0) {
      if (dkg <= -s.weightLossKg)
        // Who answers (agreed 4 Nov 2026): Ibero's own milled lots (outturns starting with K: KCS, KIB,
        // KDI, ...) the Warehouse; every other lot (52NC0005, ...) came in from outside, so Logistics.
        add({ id: v.id, act: "exception", cause: "Weight loss: claim from warehouse", rule: "Weight loss", dept: /^K/i.test(v.outturn) ? "Warehouse" : "Logistics",
          why: `Decided automatically (weight loss): the bag count matches XBS (${v.countedUnits}) but the weight is ${n(-dkg)} kg under, at or over the ${n(s.weightLossKg)} kg threshold.` });
      else if (s.acceptPocket)
        add({ id: v.id, act: "accept", cause: "Pocket / unit difference", rule: "Pocket / unit difference",
          why: `Decided automatically (pocket / unit difference): the bag count matches XBS (${v.countedUnits}); the weight differs by ${signed(dkg)} kg, under the ${n(s.weightLossKg)} kg weight-loss threshold.` });
      continue;
    }
    // B2: a different bag count but the same weight: bagged or pocketed differently.
    if (s.acceptPocket && Math.abs(dkg) < s.unitOnlyKg) {
      add({ id: v.id, act: "accept", cause: "Pocket / unit difference", rule: "Same weight, different bag count",
        why: `Decided automatically (same weight, different bag count): ${signed(d)} units against XBS but the weight is within ${n(s.unitOnlyKg)} kg (${signed(dkg)} kg). The coffee is all there; it is bagged or pocketed differently.` });
      continue;
    }
    // D1: a third-party lot short or not found.
    if (thirdParty.has(v.site) && d < 0 && (v.cause === "Partial delivery: rest still at third party" || v.cause === "Unposted gate-out" || v.countedUnits === 0)) {
      add({ id: v.id, act: "exception", cause: v.cause, rule: "Third-party delivery to confirm", dept: "Logistics", group: `site:${v.site}`,
        why: `Decided automatically (third-party delivery to confirm): ${n(-d)} units short at ${siteShort(v.site)}. Logistics confirm with the warehouse whether the bags left before the count date (gate-out to post) or after it (timing).` });
      continue;
    }
    // D2a: counted under an outturn XBS doesn't have, the same as a lot counted beside it: typed twice.
    if (v.cause === "Duplicate entry" && v.expectedUnits === 0) {
      add({ id: v.id, act: "exception", cause: "Duplicate entry", rule: "Typed twice", dept: "Operations",
        why: `Decided automatically (typed twice): ${v.suggestion || `${v.outturn} isn't in XBS and matches a lot counted at the same place.`} No recount needed.` });
      continue;
    }
    // D2: counted, but in XBS nowhere.
    if (v.cause === "Mapping error" && v.expectedUnits === 0) {
      add({ id: v.id, act: "exception", cause: "Mapping error", rule: "Found, not in XBS", dept: "Warehouse",
        why: `Decided automatically (found, not in XBS): ${n(v.countedUnits)} units of ${v.outturn} were counted but XBS has no line for it. Check the tag; if it is right, post the receipt in XBS.` });
      continue;
    }
    // D3: a blind recount settles it.
    add({ id: v.id, act: "recount", cause: v.cause, rule: "Blind recount", why: "" });
  }

  // After a recount: compare the latest count round with the one before it.
  const lotKey = (c: CountFact) => `${c.site}|${thirdParty.has(c.site) ? "" : c.stack}|${c.batch}`;
  const rn = (x?: string) => Number((x ?? "").replace(/\D/g, "")) || 0;
  const rounds = new Map<string, Map<number, number>>();
  for (const c of counts) {
    if (c.other) continue;
    const k = lotKey(c);
    const r = rounds.get(k) ?? new Map<number, number>();
    r.set(rn(c.recount), (r.get(rn(c.recount)) ?? 0) + c.units);
    rounds.set(k, r);
  }
  for (const v of variances) {
    if (v.state !== "recount" || done.has(v.id)) continue;
    const r = rounds.get(v.key);
    const order = r ? [...r.keys()].sort((a, b) => a - b) : [];
    if (!order.length || order[order.length - 1] === 0) continue; // recount not in yet
    const latest = r!.get(order[order.length - 1])!;
    // Only recount lines: the first count found nothing here (a lot in XBS, not counted), so it was 0.
    const before = order.length > 1 ? r!.get(order[order.length - 2])! : 0;
    if (latest === v.expectedUnits) continue; // matched: syncVariances accepts it
    if (latest === before)
      add({ id: v.id, act: "exception", cause: v.cause, rule: "Recount confirmed", dept: thirdParty.has(v.site) ? "Logistics" : "Operations",
        why: `Decided automatically (recount confirmed): the blind recount found ${n(latest)} units, the same as the count before it; XBS has ${n(v.expectedUnits)}. The difference is real.` });
    else
      add({ id: v.id, act: "review", cause: v.cause, rule: "Recount disagrees",
        why: `The blind recount found ${n(latest)} units, the count before it ${n(before)}, XBS ${n(v.expectedUnits)}. They don't agree: decide, or send a third count.` });
  }
  // Exceptions get a priority by size (60 kg bags). Low ones (weight losses apart) join their warehouse's list;
  // third-party site groups are prioritised on their total when raised.
  const byId = new Map(variances.map((v) => [v.id, v]));
  for (const a of out) {
    if (a.act !== "exception") continue;
    const v = byId.get(a.id)!;
    a.bags = Math.abs(v.countedKg - v.expectedKg) / 60;
    if (a.group) continue;
    a.priority = priorityFor(a.bags, s);
    // A weight loss stays its own exception, even when small: it has its own owner (K lots Warehouse,
    // the rest Logistics) and its own explanation to give (e.g. a receipt posted above what was sent).
    if (a.priority === "Low" && a.rule !== "Weight loss") a.group = `low:${v.site}`;
  }
  return out;
}
