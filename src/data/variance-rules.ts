// Turns count lines into variances: compares what was counted on each
// submitted stack with every XBS line of the same lot there, and suggests a
// cause with the evidence behind it. Pure — no data access — so it can be
// tested and later moved into a Power Automate flow or plug-in.
//
// A lot is one batch at one place: at Ibero the stack (XBS zone); at third
// parties the whole site, because XBS has no stack locations there.

import { MATCH_TOLERANCE_KG } from "../shared/count-rules";
import type { RootCause, SiteCode, XbsLine } from "./types";

export interface CountFact {
  lineId: string;
  site: SiteCode;
  stack: string;
  batch: string;
  outturn: string;
  grade: string;
  units: number;
  kg: number;
  by: string;
  at: string;
  other: boolean;
  /** The blind recount this line answers (its R-### name); its lines replace earlier ones for the lot. */
  recount?: string;
}

export interface VarianceDraft {
  /** Stable identity: `${site}|${stack or ""}|${batch}`. */
  key: string;
  site: SiteCode;
  stack: string;
  batch: string;
  outturn: string;
  grade: string;
  expectedUnits: number;
  countedUnits: number;
  expectedKg: number;
  countedKg: number;
  cause: RootCause;
  why: string;
  lineId?: string;
  counter: string;
  at: string;
}

const n = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/**
 * A lot XBS took in within this many days (at the snapshot) is still settling
 * after delivery: Logistics see partial "shuttle" deliveries and weight lost on
 * the way, both handled with the third-party warehouse (discovery, Logistics).
 */
const RECENT_DAYS = 14;
const plural = (x: number, w: string) => `${n(Math.abs(x))} ${w}${Math.abs(x) === 1 ? "" : "s"}`;

/** Edits (insert, delete, change one character) between two outturns: "KC8181" -> "KCS8181" is 1. */
export function typos(a: string, b: string) {
  const x = a.toUpperCase(), y = b.toUpperCase();
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

/**
 * A third-party site the counter closed: reported empty, or finished (every stack counted).
 * Either way, every lot XBS has there that wasn't counted counts as 0.
 */
export interface EmptySite {
  site: SiteCode;
  /** The site's marker stack ("Whole site"). */
  stack: string;
  by: string;
  at: string;
  reason: string;
  /** Finished after counting its stacks (rather than found empty). */
  finished?: boolean;
}

export function draftVariances(
  counts: CountFact[],
  xbs: XbsLine[],
  submittedStacks: { site: SiteCode; stack: string }[],
  thirdParty: Set<SiteCode>,
  siteShort: (s: SiteCode) => string,
  emptySites: EmptySite[] = [],
): VarianceDraft[] {
  const lotKey = (site: SiteCode, stack: string, batch: string) => `${site}|${thirdParty.has(site) ? "" : stack}|${batch}`;
  const where = (l: XbsLine) => `${siteShort(l.wh)}${!thirdParty.has(l.wh) && l.z ? " " + l.z : ""}`;

  // Counted, by lot. Once a lot is recounted, only the latest recount's lines
  // count: it is usually done by a different counter, and isn't a duplicate.
  const counted = new Map<string, CountFact[]>();
  for (const c of counts) {
    if (c.other) continue;
    const k = lotKey(c.site, c.stack, c.batch);
    counted.set(k, [...(counted.get(k) ?? []), c]);
  }
  const rn = (x?: string) => Number((x ?? "").replace(/\D/g, "")) || 0;
  for (const [k, cs] of counted) {
    const latest = cs.reduce((m, c) => (c.recount && rn(c.recount) > rn(m) ? c.recount : m), undefined as string | undefined);
    if (latest) counted.set(k, cs.filter((c) => c.recount === latest));
  }

  // Which lots to judge: every expected lot on a submitted Ibero stack, and
  // every counted lot on a submitted stack anywhere.
  const judge = new Set<string>();
  const submitted = new Set(submittedStacks.map((s) => `${s.site}|${s.stack}`));
  for (const s of submittedStacks)
    if (!thirdParty.has(s.site)) for (const l of xbs) if (l.wh === s.site && l.z === s.stack) judge.add(lotKey(l.wh, s.stack, l.b));
  for (const [k, cs] of counted) if (cs.some((c) => submitted.has(`${c.site}|${c.stack}`))) judge.add(k);
  // A site reported empty or finished: every lot XBS has there is judged (not counted = 0).
  const emptyAt = new Map(emptySites.filter((e) => thirdParty.has(e.site)).map((e) => [e.site, e]));
  for (const l of xbs) if (emptyAt.has(l.wh)) judge.add(lotKey(l.wh, "", l.b));

  // A counted lot XBS has, at the same place, with the same units and weight and an outturn at most
  // two characters away: the twin of a lot XBS doesn't have.
  const xbsBatches = new Set(xbs.map((l) => `${l.wh}|${l.b}`));
  const typedTwin = (site: SiteCode, stack: string, batch: string, outturn: string, units: number, kg: number) => {
    for (const [k, cs] of counted) {
      const [s2, st2, b2] = k.split("|");
      if (s2 !== site || st2 !== stack || b2 === batch || !xbsBatches.has(`${site}|${b2}`)) continue;
      const u = cs.reduce((a, c) => a + c.units, 0);
      const w = cs.reduce((a, c) => a + c.kg, 0);
      if (u === units && Math.abs(w - kg) < MATCH_TOLERANCE_KG && typos(cs[0].outturn, outturn) <= 2) return cs[0];
    }
    return undefined;
  };
  let twin: CountFact | undefined;

  const drafts: VarianceDraft[] = [];
  for (const k of judge) {
    const [site, stackOrEmpty, batch] = k.split("|") as [SiteCode, string, string];
    const cs = counted.get(k) ?? [];
    const expected = xbs.filter((l) => l.wh === site && l.b === batch && (thirdParty.has(site) || l.z === stackOrEmpty));
    const head = expected[0];
    const mark = !cs.length ? emptyAt.get(site) : undefined;
    const empty = mark && !mark.finished ? mark : undefined;
    const notFound = mark?.finished ? mark : undefined;
    const stack = stackOrEmpty || cs[0]?.stack || mark?.stack || "";
    const outturn = head?.o ?? cs[0]?.outturn ?? batch;
    const expectedUnits = expected.reduce((a, l) => a + l.u, 0);
    const expectedKg = expected.reduce((a, l) => a + l.kg, 0);
    const countedUnits = cs.reduce((a, c) => a + c.units, 0);
    const countedKg = cs.reduce((a, c) => a + c.kg, 0);
    const people = [...new Set(cs.map((c) => c.by))];

    if (people.length <= 1 && countedUnits === expectedUnits && Math.abs(countedKg - expectedKg) < MATCH_TOLERANCE_KG) continue;

    const elsewhere = xbs.filter((l) => l.o === outturn && !(l.wh === site && (thirdParty.has(site) || l.z === stackOrEmpty)));
    const elsewhereUnits = elsewhere.reduce((a, l) => a + l.u, 0);
    const elsewhereWhere = [...new Set(elsewhere.map(where))].slice(0, 3).join(", ");
    const d = countedUnits - expectedUnits;
    const days = expected.map((l) => l.d).filter((x): x is number => typeof x === "number");
    const recentDays = days.length ? Math.min(...days) : undefined;
    const recent = recentDays !== undefined && recentDays <= RECENT_DAYS;

    let cause: RootCause;
    let why: string;
    if (empty) {
      cause = "Unposted gate-out";
      why = `${siteShort(site)} was reported empty by ${empty.by}${empty.at ? ` at ${empty.at}` : ""}: "${empty.reason}". XBS still has ${plural(expectedUnits, "unit")} of ${outturn} here. If the bags left before the count date, post the gate-out in XBS; if after, it's a timing difference.`;
    } else if (people.length > 1) {
      cause = "Duplicate entry";
      why = `${people.join(" and ")} each counted this lot here (${cs.map((c) => `${c.units} units at ${c.at}`).join(", ")}). XBS expects ${expectedUnits}.`;
    } else if (!expected.length && elsewhere.length) {
      cause = "Unposted receipt";
      why = `Counted ${countedUnits} units here, but XBS still has ${plural(elsewhereUnits, "unit")} of ${outturn} at ${elsewhereWhere}. It looks like the bags moved without the transfer being received in XBS.`;
    } else if (!expected.length && (twin = typedTwin(site, stackOrEmpty, batch, outturn, countedUnits, countedKg))) {
      // The same bags at the same place under an outturn one or two characters off, which XBS has:
      // the lot typed twice (Aug 2026: KC8181 typed for KCS8181, 50 bags counted twice).
      cause = "Duplicate entry";
      why = `${outturn} isn't in XBS, but ${twin.outturn} was counted at the same place with the same ${plural(countedUnits, "unit")} (${twin.by} at ${twin.at}). It looks like the same lot typed twice: remove one of the two lines.`;
    } else if (!expected.length) {
      cause = "Mapping error";
      why = `${outturn} isn't in XBS anywhere. Check the tag against the lots expected on this stack — it may be misread, or missing from XBS.`;
    } else if (countedUnits === 0 && elsewhere.length) {
      cause = "Split lot";
      why = `Nothing found here, but XBS also has ${plural(elsewhereUnits, "unit")} of this outturn at ${elsewhereWhere}. The bags may be stacked there.`;
    } else if (d === 0 && countedKg < expectedKg && recent) {
      cause = "Weight loss: claim from warehouse";
      why = `The bag count matches XBS (${countedUnits}) but the weight is ${n(expectedKg - countedKg)} kg under. XBS took this lot in ${recentDays} day${recentDays === 1 ? "" : "s"} ago; weight lost on delivery is claimed from the third-party warehouse.`;
    } else if (d === 0) {
      cause = "Pocket / unit difference";
      why = `The bag count matches XBS (${countedUnits}); the weight differs by ${n(countedKg - expectedKg)} kg. Check pocket weights and the packing type.`;
    } else if (d < 0 && recent && !elsewhere.length) {
      cause = "Partial delivery: rest still at third party";
      why = `${plural(d, "unit")} short. XBS took this lot in ${recentDays} day${recentDays === 1 ? "" : "s"} ago, so the rest of the delivery may still be at the third-party warehouse. Check with Logistics before recounting.`;
    } else if (elsewhere.length) {
      cause = "Split lot";
      why = `${plural(d, "unit")} ${d < 0 ? "short" : "over"}. XBS also has ${plural(elsewhereUnits, "unit")} of this outturn at ${elsewhereWhere}, so bags may have been stacked in the wrong place.`;
    } else {
      cause = "Not yet known";
      why = `${plural(d, "unit")} ${d < 0 ? "short" : "over"} with no matching movement, duplicate or split found. A blind recount will confirm it.`;
    }

    if (notFound) why = `Not found at ${siteShort(site)}: ${notFound.by} finished the site${notFound.at ? ` at ${notFound.at}` : ""} without counting this lot. ${why}`;

    drafts.push({
      key: k,
      site,
      stack,
      batch,
      outturn,
      grade: [head?.i, head?.g].filter(Boolean).join(" · ") || cs[0]?.grade || "",
      expectedUnits,
      countedUnits,
      expectedKg,
      countedKg,
      cause,
      why,
      lineId: cs[0]?.lineId,
      counter: people.join(", ") || mark?.by || "—",
      at: cs[0]?.at ?? mark?.at ?? "",
    });
  }
  return drafts;
}
