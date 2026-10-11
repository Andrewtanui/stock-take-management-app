// Count rules shared by the Stock Take and Stock Management apps.
// KEEP IDENTICAL in both repos (src/shared/count-rules.ts) — `npm run check:shared`
// fails if they drift. Pure functions only: no app imports, no data access.
//
//   units  = full bags + 1 if there's a pocket  (bag objects on the stack)
//   weight = full bags × pack kg + pocket kg
//
// An outturn has at most ONE pocket at a location: the odd last bag. It can't
// be re-bagged, so it can weigh anything above 0 kg (66 kg pockets are real).
// A split lot has its own pocket at each location.
//   60 kg bag equivalents = weight ÷ 60          (what Finance compares)

export interface Qty {
  /** Packing type code, e.g. JUTE60. */
  pack: string;
  bags: number;
  /** 0 or 1 — derived from pocketKg (see withPocket). Kept for the stored count line. */
  pocketBags: number;
  /** Weight of the pocket; 0 = no pocket. */
  pocketKg: number;
}

export interface PackRule {
  code: string;
  kg: number;
  /** Grades that default to this pack, as a case-insensitive regex source. */
  gradePattern?: string;
}

/** Weight difference below which a count still "matches" XBS. */
export const MATCH_TOLERANCE_KG = 0.05;

export const hasPocket = (q: Qty) => q.pocketKg > 0;
export const unitsOf = (q: Qty) => q.bags + (hasPocket(q) ? 1 : 0);
/** Sets the pocket weight; a weight means exactly one pocket. */
export const withPocket = <T extends Qty>(q: T, kg: number): T => ({ ...q, pocketKg: Math.max(0, kg), pocketBags: kg > 0 ? 1 : 0 });
export const kgOf = (q: Qty, kgPerBag: number) => q.bags * kgPerBag + q.pocketKg;
export const bags60 = (kg: number) => kg / 60;

/** Default packing type for a grade: the first pack whose pattern matches, else the last (standard) one. */
export function defaultPackCode(grade: string, packs: PackRule[]): string {
  const hit = packs.find((p) => p.gradePattern && new RegExp(p.gradePattern, "i").test(grade));
  return (hit ?? packs.find((p) => !p.gradePattern) ?? packs[0]).code;
}

/** One pocket per outturn at a location, with a weight above 0 kg. */
export function pocketProblem(q: Qty): string | null {
  if (q.pocketBags > 1) return "An outturn has only one pocket at a location. Enter that one pocket's weight.";
  if (q.pocketKg < 0) return "Pocket weight can't be negative.";
  return null;
}

export interface Compare {
  dUnits: number;
  dKg: number;
  match: boolean;
  tone: "ok" | "warn" | "crit";
  headline: string;
  detail: string;
}

/** Plain-language comparison of a count with what XBS expects. */
export function compare(q: Qty, kgPerBag: number, expected: { units: number; kg: number }): Compare {
  const units = unitsOf(q);
  const kg = kgOf(q, kgPerBag);
  const dUnits = units - expected.units;
  const dKg = Math.round((kg - expected.kg) * 10) / 10;
  const kgTxt = (x: number) => `${Math.abs(x).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
  const bagWord = (x: number) => `${Math.abs(x)} bag${Math.abs(x) === 1 ? "" : "s"}`;

  if (dUnits === 0 && Math.abs(dKg) < MATCH_TOLERANCE_KG)
    return { dUnits, dKg, match: true, tone: "ok", headline: "Matches XBS", detail: `${units} units and ${kgTxt(kg)}, same as XBS.` };
  if (dUnits === 0)
    return {
      dUnits,
      dKg,
      match: false,
      tone: "warn",
      headline: `Bags match, weight is ${kgTxt(dKg)} ${dKg > 0 ? "over" : "under"}`,
      detail: "The number of bags is right but the weight differs. Check the pocket weight, or the packing type.",
    };
  if (dUnits < 0)
    return {
      dUnits,
      dKg,
      match: false,
      tone: "crit",
      headline: `${bagWord(dUnits)} fewer than XBS`,
      detail: `You counted ${units}; XBS expects ${expected.units}. Look behind and under the stack, then choose a reason.`,
    };
  return {
    dUnits,
    dKg,
    match: false,
    tone: "crit",
    headline: `${bagWord(dUnits)} more than XBS`,
    detail: `You counted ${units}; XBS expects ${expected.units}. Check for bags from another lot, then choose a reason.`,
  };
}
