// Level 1 decisions the Hub takes on its own, so a supervisor only sees what the
// rules can't settle. Pure: works on variances and count facts, writes nothing.
// dataverse.ts applies the plan right after variances are refreshed.
//
// On a new, undecided variance:
//   A  the same outturn over and short across stacks/warehouses, netting to about 0
//        -> accepted: bags moved, XBS location to fix (Warehouse gets the list)
//   B  bag count matches XBS, weight off by less than the weight-loss threshold
//        -> accepted: pocket / unit difference
//   C  bag count matches, weight under by the threshold or more -> weight-loss exception
//   D1 third-party lot short or not found (partial delivery / gate-out not posted)
//        -> one exception per site for Logistics, listing the lots
//   D2 counted but not in XBS anywhere -> "found, not in XBS" exception
//   D3 anything else -> blind recount by a different counter
// After a blind recount (a recount line exists for the lot):
//   matches XBS          -> accepted (done in syncVariances: the difference disappears)
//   repeats the previous count -> exception with the suggested cause
//   neither              -> back to the supervisor (a third count, or decide)

import type { Dept, RootCause, SiteCode } from "./types";
import type { CountFact } from "./variance-rules";

export interface AutoSettings {
  /** Master switch (setting AutoDecide). */
  on: boolean;
  /** Bags match but weight is this many kg (or more) under XBS: weight-loss exception (AutoWeightLossKg). */
  weightLossKg: number;
  /** Over/short across locations nets to within this many units: treated as moved (AutoNetUnits). */
  netUnits: number;
  /** Accept "bags match, weight slightly off" automatically (AutoAcceptPocket). */
  acceptPocket: boolean;
}

export const AUTO_DEFAULTS: AutoSettings = { on: true, weightLossKg: 20, netUnits: 1, acceptPocket: true };

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
  /** The suggested cause. */
  cause: RootCause;
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
  /** Variances sharing a group get one exception between them (third-party sites). */
  group?: string;
}

const n = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const signed = (x: number) => `${x > 0 ? "+" : ""}${n(x)}`;

export function planAutoDecisions(
  variances: AutoVariance[],
  counts: CountFact[],
  thirdParty: Set<SiteCode>,
  s: AutoSettings,
  siteShort: (c: SiteCode) => string = (c) => c,
): AutoAction[] {
  if (!s.on) return [];
  const out: AutoAction[] = [];
  const done = new Set<string>();
  const add = (a: AutoAction) => {
    out.push(a);
    done.add(a.id);
  };
  const fresh = variances.filter((v) => v.state === "open" && !v.decided);

  // A: moved. Same outturn on several lots whose differences net to about zero.
  const byOutturn = new Map<string, AutoVariance[]>();
  for (const v of fresh) byOutturn.set(v.outturn, [...(byOutturn.get(v.outturn) ?? []), v]);
  for (const [outturn, group] of byOutturn) {
    if (group.length < 2) continue;
    const net = group.reduce((a, v) => a + v.countedUnits - v.expectedUnits, 0);
    // Moved needs both sides: over somewhere and short somewhere else.
    const over = group.some((v) => v.countedUnits > v.expectedUnits);
    const short = group.some((v) => v.countedUnits < v.expectedUnits);
    if (Math.abs(net) > s.netUnits || !over || !short) continue;
    const sites = new Set(group.map((v) => v.site));
    const where = group.map((v) => `${siteShort(v.site)}${v.stack ? " " + v.stack : ""} ${signed(v.countedUnits - v.expectedUnits)}`).join(", ");
    const oneThirdParty = sites.size === 1 && thirdParty.has(group[0].site);
    const rule = sites.size > 1 ? "Moved between warehouses" : oneThirdParty ? "Counted under another batch" : "Moved within the warehouse";
    const fix = oneThirdParty
      ? `The outturn's total at ${siteShort(group[0].site)} matches XBS; the bags were counted against a different batch of it. Warehouse to check the batch labels.`
      : "The bags are there; XBS has them in the wrong place. Warehouse to update the location in XBS.";
    for (const v of group)
      add({
        id: v.id,
        act: "accept",
        cause: "Split lot",
        rule,
        why: `Decided automatically (${rule.toLowerCase()}): ${outturn} is over in one place and short in another (${where}), netting to ${signed(net)} units. ${fix}`,
      });
  }

  for (const v of fresh) {
    if (done.has(v.id)) continue;
    const d = v.countedUnits - v.expectedUnits;
    const dkg = v.countedKg - v.expectedKg;
    // B / C: the bag count matches.
    if (d === 0) {
      if (dkg <= -s.weightLossKg)
        add({ id: v.id, act: "exception", cause: "Weight loss: claim from warehouse", rule: "Weight loss", dept: thirdParty.has(v.site) ? "Logistics" : "Warehouse",
          why: `Decided automatically (weight loss): the bag count matches XBS (${v.countedUnits}) but the weight is ${n(-dkg)} kg under, at or over the ${n(s.weightLossKg)} kg threshold.` });
      else if (s.acceptPocket)
        add({ id: v.id, act: "accept", cause: "Pocket / unit difference", rule: "Pocket / unit difference",
          why: `Decided automatically (pocket / unit difference): the bag count matches XBS (${v.countedUnits}); the weight differs by ${signed(dkg)} kg, under the ${n(s.weightLossKg)} kg weight-loss threshold.` });
      continue;
    }
    // D1: a third-party lot short or not found.
    if (thirdParty.has(v.site) && d < 0 && (v.cause === "Partial delivery: rest still at third party" || v.cause === "Unposted gate-out" || v.countedUnits === 0)) {
      add({ id: v.id, act: "exception", cause: v.cause, rule: "Third-party delivery to confirm", dept: "Logistics", group: `site:${v.site}`,
        why: `Decided automatically (third-party delivery to confirm): ${n(-d)} units short at ${siteShort(v.site)}. Logistics confirm with the warehouse whether the bags left before the count date (gate-out to post) or after it (timing).` });
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
    if (order.length < 2 || order[order.length - 1] === 0) continue; // recount not in yet
    const latest = r!.get(order[order.length - 1])!;
    const before = r!.get(order[order.length - 2])!;
    if (latest === v.expectedUnits) continue; // matched: syncVariances accepts it
    if (latest === before)
      add({ id: v.id, act: "exception", cause: v.cause, rule: "Recount confirmed", dept: thirdParty.has(v.site) ? "Logistics" : "Operations",
        why: `Decided automatically (recount confirmed): the blind recount found ${n(latest)} units, the same as the count before it; XBS has ${n(v.expectedUnits)}. The difference is real.` });
    else
      add({ id: v.id, act: "review", cause: v.cause, rule: "Recount disagrees",
        why: `The blind recount found ${n(latest)} units, the count before it ${n(before)}, XBS ${n(v.expectedUnits)}. They don't agree: decide, or send a third count.` });
  }
  return out;
}
