// Third-party stock by age (L3): bags and lots per third-party warehouse in day buckets from the XBS
// snapshot's days in stock, and the lots coming up to the call-off limit, so they can be called off to
// Ibero before they pass it. Pure, so the figures can be tested. Used by Pre-count checks.
//
// Limits are settings until Trade and Logistics agree them (D6): ThirdPartyAgeingDays (bucket edges,
// default 14,21,30,60,90) and ThirdPartyAgeDays (the call-off rule, default 21).

import type { Check, Site, SiteCode, XbsLine } from "./types";

export const TP_AGEING_DEFAULT = [14, 21, 30, 60, 90];
export const CALL_OFF_DEFAULT = 21;
/** Days before the call-off limit that a lot is listed as coming up to it. */
export const REMIND_DAYS = 7;

export interface AgeingRow {
  site: SiteCode;
  name: string;
  bags: number[];
  lots: number[];
  total: number;
  /** Bags past the call-off limit. */
  over: number;
}

const bagsOf = (l: XbsLine) => l.kg / 60;

export function thirdPartyAgeing(lines: XbsLine[], sites: Site[], limits = TP_AGEING_DEFAULT, callOff = CALL_OFF_DEFAULT) {
  const edges = [...new Set(limits)].filter((d) => d > 0).sort((a, b) => a - b);
  const labels = [...edges.map((d, i) => `${i ? edges[i - 1] + 1 : 0}-${d} days`), `Over ${edges[edges.length - 1]} days`];
  const bucket = (d: number) => {
    const i = edges.findIndex((e) => d <= e);
    return i < 0 ? edges.length : i;
  };
  const tp = sites.filter((s) => s.thirdParty);
  const W = lines.filter((l) => l.t === "W" && tp.some((s) => s.code === l.wh));
  const rows: AgeingRow[] = tp.map((s) => {
    const ls = W.filter((l) => l.wh === s.code);
    const r: AgeingRow = { site: s.code, name: s.short, bags: labels.map(() => 0), lots: labels.map(() => 0), total: 0, over: 0 };
    for (const l of ls) {
      const b = bucket(l.d ?? 0);
      r.bags[b] += bagsOf(l);
      r.lots[b]++;
      r.total += bagsOf(l);
      if ((l.d ?? 0) > callOff) r.over += bagsOf(l);
    }
    return r;
  }).filter((r) => r.total > 0);
  const nearing = W.filter((l) => typeof l.d === "number" && l.d > callOff - REMIND_DAYS && l.d <= callOff).sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
  const short = (c: SiteCode) => sites.find((s) => s.code === c)?.short ?? c;
  const check: Check = {
    id: "nearing", severity: "medium", owner: "Operations",
    title: `Third-party stock reaching ${callOff} days within a week`,
    detail: `Call these off to Ibero, or plan their collection, before they pass the ${callOff}-day rule and start costing storage.`,
    count: nearing.length, bags: Math.round(nearing.reduce((a, l) => a + bagsOf(l), 0)), unit: "lots",
    rows: nearing.map((l) => ({ ref: l.o, where: short(l.wh), info: `${l.d} days · ${callOff - (l.d ?? 0)} to go · ${l.i}${l.g ? " · " + l.g : ""}`, bags: Math.round(bagsOf(l) * 100) / 100 })),
  };
  return { labels, rows, check, callOff };
}
