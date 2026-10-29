// Stock take types and what a stock take covers. An ad hoc count (any day, an early look before
// month-end) covers chosen warehouses and, at Ibero, chosen sections (row / bay tokens, see
// src/shared/sections.ts); monthly and 100% counts cover everything. Stored on the stock take as
// stk_scope JSON: {"sites":["IBR","AGL"],"sections":["D","B1-7"]}. Empty sections = all of Ibero.

import { parseZone, sectionList, sectionsWords, zoneInSections } from "../shared/sections";
import type { SiteCode, StockTakeType } from "./types";

export interface StockScope {
  sites: SiteCode[];
  /** Ibero section tokens; empty = the whole warehouse. */
  sections: string[];
}

/** Dataverse choice label <-> the apps' type. */
const CHOICE: Record<StockTakeType, string> = { "Monthly stock take": "Monthly", "100% stock take": "100% (zero-out)", "Ad hoc stock take": "Ad hoc" };
export const typeFromChoice = (label?: string): StockTakeType =>
  (Object.keys(CHOICE) as StockTakeType[]).find((t) => CHOICE[t] === label) ?? "Monthly stock take";
export const choiceOfType = (t: StockTakeType) => CHOICE[t];
/** "Monthly" · "100%" · "Ad hoc", for titles and the rail. */
export const shortType = (t: StockTakeType) => (t === "Monthly stock take" ? "Monthly" : t === "100% stock take" ? "100%" : "Ad hoc");

export function parseScope(json?: string | null): StockScope | undefined {
  if (!json) return undefined;
  try {
    const x = JSON.parse(json) as Partial<StockScope>;
    return { sites: Array.isArray(x.sites) ? x.sites : [], sections: sectionList((x.sections ?? []).join(",")) };
  } catch {
    return undefined;
  }
}
export const scopeJson = (s?: StockScope) => (s ? JSON.stringify({ sites: s.sites, sections: s.sections }) : null);

/** Is this XBS line (warehouse + zone) part of what is counted? No scope = everything. */
export function lineInScope(scope: StockScope | undefined, wh: SiteCode, zone?: string) {
  if (!scope) return true;
  if (scope.sites.length && !scope.sites.includes(wh)) return false;
  if (wh !== "IBR" || !scope.sections.length) return true;
  // A stack with no Ibero location (e.g. TEMP) is in no section, so not in a sectioned count.
  return !!zone && !!parseZone(zone) && zoneInSections(zone, scope.sections);
}

/** "Ibero rows D and E; AGL" - for the stock take page and the counter app's header. */
export function scopeWords(scope: StockScope | undefined, siteName: (c: SiteCode) => string) {
  if (!scope) return "Everything";
  return scope.sites
    .map((s) => (s === "IBR" && scope.sections.length ? `${siteName(s)}: ${sectionsWords(scope.sections)}` : siteName(s)))
    .join(" · ");
}
