// Count rules shared by the Stock Take and Stock Management apps.
// KEEP IDENTICAL in both repos (src/shared/count-rules.ts) — `npm run check:shared`
// fails if they drift. Pure functions only: no app imports, no data access.
//
//   units  = full bags + pocket bags            (bag objects on the stack)
//   weight = full bags × pack kg + pocket kg
//   60 kg bag equivalents = weight ÷ 60          (what Finance compares)

export interface Qty {
  /** Packing type code, e.g. JUTE60. */
  pack: string;
  bags: number;
  pocketBags: number;
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

export const unitsOf = (q: Qty) => q.bags + q.pocketBags;
export const kgOf = (q: Qty, kgPerBag: number) => q.bags * kgPerBag + q.pocketKg;
export const bags60 = (kg: number) => kg / 60;

/** Default packing type for a grade: the first pack whose pattern matches, else the last (standard) one. */
export function defaultPackCode(grade: string, packs: PackRule[]): string {
  const hit = packs.find((p) => p.gradePattern && new RegExp(p.gradePattern, "i").test(grade));
  return (hit ?? packs.find((p) => !p.gradePattern) ?? packs[0]).code;
}

/** A pocket is a part-filled bag, so each must weigh less than a full one. */
export function pocketProblem(q: Qty, kgPerBag: number): string | null {
  if (q.pocketKg > 0 && q.pocketBags === 0) return "You entered pocket weight but no pocket bags. Add the number of pocket bags.";
  if (q.pocketBags > 0 && q.pocketKg === 0) return "Pocket bags need a weight. Weigh them and enter the total kg.";
  if (q.pocketBags > 0 && q.pocketKg >= q.pocketBags * kgPerBag)
    return `Pockets must weigh less than ${kgPerBag} kg each. If a pocket is full, count it as a full bag.`;
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
