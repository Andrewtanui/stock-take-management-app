// Gathers the governance KPI inputs (kpi.ts) from what the Hub already has loaded:
// the reconciliation (recon.ts), the BRIC bridge, variances, exceptions and sign-off.

import { computeKpis, KPI_DEFAULTS, type Kpi, type KpiTargets } from "./kpi";
import { bricBridge, byWarehouse, type ReconInput } from "./recon";
import { comparable, currentCounts } from "./reports";
import { allLines } from "./repository";
import type { Exception, ReconItem, Variance } from "./types";

/** One saved KPI row (stk_kpisnapshot), for the trend. */
export interface KpiRecord {
  stockTake: string;
  countDate: string;
  code: string;
  name: string;
  value: number | null;
  display: string;
  target: string;
  status: Kpi["status"];
  frozenOn?: string;
}

export interface GovernanceData {
  /** Saved rows of every stock take, newest count first. */
  history: KpiRecord[];
  /** The active stock take: count date (ISO), when counting closed and when Finance signed. */
  countDate?: string;
  countClosedOn?: string;
  financeSignedOn?: string;
  targets: KpiTargets;
}

export function governanceKpis(o: {
  input: ReconInput;
  reconItems: ReconItem[];
  variances: Variance[];
  exceptions: Exception[];
  stockTake: string;
  gov: GovernanceData;
  asOf?: Date;
}): Kpi[] | undefined {
  const g = o.gov;
  if (!g.countDate) return undefined;
  const xbs = allLines();
  const counts = currentCounts(o.input.counts).filter((c) => !c.other);
  const inScope = comparable(o.input, counts);
  const compared = xbs.filter(inScope).length;
  const sites = byWarehouse(o.input);
  const bridge = bricBridge(o.input, o.reconItems);
  const countStart = new Date(`${g.countDate}T00:00:00Z`).getTime();
  // This stock take's exceptions; older rows without a link count when raised on or after the count date.
  const exceptions = o.exceptions.filter((e) => (e.stockTake ? e.stockTake === o.stockTake : !!e.raisedOn && new Date(e.raisedOn).getTime() >= countStart));
  return computeKpis({
    countDate: g.countDate,
    countClosedAt: g.countClosedOn,
    signedAt: g.financeSignedOn,
    xbsLots: xbs.length,
    countedLots: compared,
    xbsBags: sites.reduce((a, s) => a + s.xbsWhole, 0),
    physicalBags: sites.reduce((a, s) => a + s.physical, 0),
    firstCountMatched: Math.max(0, compared - o.variances.filter((v) => v.expected > 0).length),
    // The Hub has no manual count entry, so every line came through the (blind) counter app.
    countLines: o.input.counts.filter((c) => !c.recount).map((c) => ({ at: c.countedOn, inApp: true })),
    variances: o.variances.map((v) => ({
      createdOn: v.createdOn ?? g.countDate!,
      decidedOn: v.decidedOn,
      decided: v.state === "accepted" || v.state === "exception",
      auto: !!v.auto,
    })),
    exceptions: exceptions.map((e) => ({ raisedOn: e.raisedOn ?? g.countDate!, closedOn: e.closedOn, open: e.status !== "Closed" })),
    unexplainedBags: bridge?.position.physical,
    targets: g.targets,
    asOf: o.asOf ?? new Date(),
  });
}

/** Targets from settings (stk_setting); anything missing keeps the SOP / business case default. */
export function kpiTargets(setting: (key: string, d: number) => number): KpiTargets {
  const d = KPI_DEFAULTS;
  return {
    // Already used by the Overview and the sign-off deadline.
    netVariancePct: setting("TargetNetVariancePct", d.netVariancePct),
    signOffWorkingDays: setting("SignOffWorkingDays", d.signOffWorkingDays),
    reconByDayOfMonth: setting("KpiReconByDayOfMonth", d.reconByDayOfMonth),
    investigateWorkingDays: setting("KpiInvestigateWorkingDays", d.investigateWorkingDays),
    agedDays: setting("KpiAgedDays", d.agedDays),
    exceptionClosurePct: setting("KpiExceptionClosurePct", d.exceptionClosurePct),
    coveragePct: setting("KpiCoveragePct", d.coveragePct),
  };
}
