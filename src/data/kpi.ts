// Governance KPIs for one stock take: whether the stock take process met its targets.
// Targets come from NKG's SOP KPI register (SOP-UG-LOG #104, SOP-UG-ACC&FIN #22 and #29),
// the stock take SOP (section 10) and the business case. Pure: the Hub gathers the inputs,
// this works out each KPI and whether it is on target. Settings can change every target.

export type KpiStatus = "On target" | "Off target" | "Running" | "For information" | "Not measurable";

export interface KpiTargets {
  /** Net stock variance, % of XBS (SOP-UG-LOG #104: <= 0.1%). Setting TargetNetVariancePct. */
  netVariancePct: number;
  /** Working days from the count to Finance's sign-off (business case: <= 7). Setting SignOffWorkingDays. */
  signOffWorkingDays: number;
  /** Day of the next month the coffee inventory reconciliation must be done by (SOP-UG-ACC&FIN #29: 8th). */
  reconByDayOfMonth: number;
  /** Working days to investigate a difference (SOP-UG-ACC&FIN #29: 2). */
  investigateWorkingDays: number;
  /** Days after which an unexplained item counts as aged (SOP-UG-ACC&FIN #22 and #29: 30). */
  agedDays: number;
  /** Share of exceptions closed (stock take SOP: >= 90%). */
  exceptionClosurePct: number;
  /** Share of XBS lots counted (stock take SOP: 100%). */
  coveragePct: number;
}

export const KPI_DEFAULTS: KpiTargets = {
  netVariancePct: 0.1,
  signOffWorkingDays: 7,
  reconByDayOfMonth: 8,
  investigateWorkingDays: 2,
  agedDays: 30,
  exceptionClosurePct: 90,
  coveragePct: 100,
};

export interface KpiInput {
  /** Count date (ISO date) = the period end being reconciled. */
  countDate: string;
  /** When counting closed (Level 1 complete), if it has. */
  countClosedAt?: string;
  /** When Finance signed (the stock take is Completed), if it has. */
  signedAt?: string;
  xbsLots: number;
  /** XBS lots with a count (0 allowed) or at a closed third-party site. */
  countedLots: number;
  xbsBags: number;
  physicalBags: number;
  /** XBS lots counted whose first count matched XBS (no variance raised). */
  firstCountMatched: number;
  /** First-count lines (not recount lines): when counted and whether captured in the counter app (always blind). */
  countLines: { at?: string; inApp: boolean }[];
  variances: { createdOn: string; decidedOn?: string; decided: boolean; auto: boolean }[];
  exceptions: { raisedOn: string; closedOn?: string; open: boolean }[];
  /** Level 2 residual in bags (BRIC bridge "unexplained"); undefined when Comtras isn't loaded. */
  unexplainedBags?: number;
  targets: KpiTargets;
  asOf: Date;
}

export interface Kpi {
  code: string;
  name: string;
  /** Where the target comes from. */
  source: string;
  owner: string;
  value: number | null;
  /** The value as shown, e.g. "-9.17%". */
  display: string;
  target: string;
  status: KpiStatus;
  detail: string;
}

const day = 86_400_000;
const pctText = (x: number, dp = 1) => `${x.toFixed(dp)}%`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => x.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

/** Working days from a to b (Monday to Friday; b's day counts, a's doesn't). */
export function workingDaysBetween(a: Date, b: Date) {
  let n = 0;
  const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export function computeKpis(i: KpiInput): Kpi[] {
  const t = i.targets;
  const out: Kpi[] = [];
  const countDate = date(i.countDate);

  // 1. Net stock variance (whole stock take, 60 kg bags).
  {
    const d = i.physicalBags - i.xbsBags;
    const pct = i.xbsBags ? (d / i.xbsBags) * 100 : 0;
    out.push({
      code: "STOCK_VARIANCE", name: "Stock variance", source: "SOP-UG-LOG #104", owner: "Logistics / Operations",
      value: i.xbsBags ? pct : null, display: i.xbsBags ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : "-",
      target: `within ±${t.netVariancePct}%`,
      status: !i.countLines.length ? "Not measurable" : Math.abs(pct) <= t.netVariancePct ? "On target" : "Off target",
      detail: `Physical ${n1(i.physicalBags)} against XBS ${n1(i.xbsBags)} bags (${d > 0 ? "+" : ""}${n1(d)}).`,
    });
  }

  // 2. Count coverage.
  {
    const pct = i.xbsLots ? (i.countedLots / i.xbsLots) * 100 : 0;
    out.push({
      code: "COVERAGE", name: "Count coverage", source: "Stock take SOP s.10", owner: "Operations",
      value: i.xbsLots ? pct : null, display: i.xbsLots ? pctText(pct) : "-", target: `${t.coveragePct}% of XBS lots`,
      status: !i.xbsLots ? "Not measurable" : pct >= t.coveragePct ? "On target" : i.countClosedAt ? "Off target" : "Running",
      detail: `${n0(i.countedLots)} of ${n0(i.xbsLots)} XBS lots counted (third-party sites closed count as counted).`,
    });
  }

  // 3. First-count match rate (for information).
  {
    const pct = i.countedLots ? (i.firstCountMatched / i.countedLots) * 100 : 0;
    out.push({
      code: "FIRST_COUNT_MATCH", name: "First-count match rate", source: "Stock take SOP s.10", owner: "Operations",
      value: i.countedLots ? pct : null, display: i.countedLots ? pctText(pct) : "-", target: "for information",
      status: i.countedLots ? "For information" : "Not measurable",
      detail: `${n0(i.firstCountMatched)} of ${n0(i.countedLots)} counted lots matched XBS on the first count.`,
    });
  }

  // 4. Blind-count coverage: lines captured in the counter app, which never shows XBS figures.
  {
    const app = i.countLines.filter((c) => c.inApp).length;
    const pct = i.countLines.length ? (app / i.countLines.length) * 100 : 0;
    out.push({
      code: "BLIND_COUNT", name: "Blind-count coverage", source: "Stock take SOP s.10", owner: "Operations",
      value: i.countLines.length ? pct : null, display: i.countLines.length ? pctText(pct) : "-", target: "100% of count lines",
      status: !i.countLines.length ? "Not measurable" : pct >= 100 ? "On target" : "Off target",
      detail: `${n0(app)} of ${n0(i.countLines.length)} count lines captured in the counter app (blind: no XBS figures shown).`,
    });
  }

  // 5. Count duration (business case: a one-day count): count date to "count closed" (Level 1 done).
  {
    const end = i.countClosedAt ? date(i.countClosedAt) : i.asOf;
    const days = Math.max(1, Math.floor((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - countDate.getTime()) / day) + 1);
    out.push({
      code: "COUNT_DURATION", name: "Count duration", source: "Business case", owner: "Operations",
      value: days, display: `${days} day${days === 1 ? "" : "s"}`, target: "1 day",
      status: days <= 1 ? (i.countClosedAt ? "On target" : "Running") : "Off target",
      detail: i.countClosedAt ? `Count date ${i.countDate}, counting closed ${end.toISOString().slice(0, 10)}.` : `Counting still open; ${days} days since the count date.`,
    });
  }

  // 6. Differences investigated within N working days (SOP-UG-ACC&FIN #29).
  {
    const v = i.variances;
    const inTime = v.filter((x) => x.decided && x.decidedOn && workingDaysBetween(date(x.createdOn), date(x.decidedOn)) <= t.investigateWorkingDays).length;
    const auto = v.filter((x) => x.auto).length;
    const pct = v.length ? (inTime / v.length) * 100 : 0;
    const late = v.filter((x) => !x.decided && workingDaysBetween(date(x.createdOn), i.asOf) > t.investigateWorkingDays).length;
    out.push({
      code: "INVESTIGATED_IN_TIME", name: `Differences investigated within ${t.investigateWorkingDays} working days`, source: "SOP-UG-ACC&FIN #29", owner: "Operations / Warehouse",
      value: v.length ? pct : null, display: v.length ? pctText(pct) : "-", target: "100% of variances",
      status: !v.length ? "Not measurable" : pct >= 100 ? "On target" : late ? "Off target" : "Running",
      detail: `${n0(inTime)} of ${n0(v.length)} variances decided in time (${n0(auto)} decided automatically).`,
    });
  }

  // 7. Aged unexplained items: exceptions open longer than N days (SOP-UG-ACC&FIN #22, #29).
  {
    const aged = i.exceptions.filter((e) => e.open && (i.asOf.getTime() - date(e.raisedOn).getTime()) / day > t.agedDays).length;
    const open = i.exceptions.filter((e) => e.open).length;
    out.push({
      code: "AGED_ITEMS", name: `Unexplained items older than ${t.agedDays} days`, source: "SOP-UG-ACC&FIN #22", owner: "Finance",
      value: aged, display: String(aged), target: "0",
      status: aged === 0 ? (open ? "Running" : "On target") : "Off target",
      detail: `${n0(open)} exceptions open, ${n0(aged)} of them raised more than ${t.agedDays} days ago.`,
    });
  }

  // 8. Exception closure rate (stock take SOP: >= 90%).
  {
    const ex = i.exceptions;
    const closed = ex.filter((e) => !e.open).length;
    const pct = ex.length ? (closed / ex.length) * 100 : 100;
    out.push({
      code: "EXCEPTION_CLOSURE", name: "Exception closure", source: "Stock take SOP s.10", owner: "All departments",
      value: ex.length ? pct : null, display: ex.length ? pctText(pct) : "-", target: `${t.exceptionClosurePct}% closed`,
      status: !ex.length ? "On target" : pct >= t.exceptionClosurePct ? "On target" : i.signedAt ? "Off target" : "Running",
      detail: `${n0(closed)} of ${n0(ex.length)} exceptions closed.`,
    });
  }

  // 9. Unexplained variance at sign-off (business case: zero).
  {
    const u = i.unexplainedBags;
    out.push({
      code: "UNEXPLAINED", name: "Unexplained variance (Level 2)", source: "Business case", owner: "Finance",
      value: u ?? null, display: u === undefined ? "-" : `${n1(Math.abs(u))} bags`, target: "0 at sign-off",
      status: u === undefined ? "Not measurable" : Math.abs(u) < 0.5 ? "On target" : i.signedAt ? "Off target" : "Running",
      detail: u === undefined ? "Load the Comtras P526 to measure it." : "BRIC against the Ibero position after reconciling items.",
    });
  }

  // 10. Days to sign-off (business case: <= 7 working days after the count).
  {
    const end = i.signedAt ? date(i.signedAt) : i.asOf;
    const wd = workingDaysBetween(countDate, end);
    out.push({
      code: "SIGNOFF_DAYS", name: "Working days to sign-off", source: "Business case", owner: "Finance",
      value: wd, display: `${wd} working day${wd === 1 ? "" : "s"}`, target: `${t.signOffWorkingDays} or fewer`,
      status: wd <= t.signOffWorkingDays ? (i.signedAt ? "On target" : "Running") : "Off target",
      detail: i.signedAt ? `Signed by Finance ${end.toISOString().slice(0, 10)}.` : `Not signed yet; ${wd} working days since the count.`,
    });
  }

  // 11. Inventory reconciliation by the Nth of the next month (SOP-UG-ACC&FIN #29).
  {
    const due = new Date(Date.UTC(countDate.getUTCFullYear(), countDate.getUTCMonth() + 1, t.reconByDayOfMonth));
    const done = i.signedAt ? date(i.signedAt) : undefined;
    out.push({
      code: "RECON_BY_DAY", name: `Inventory reconciliation by the ${t.reconByDayOfMonth}th`, source: "SOP-UG-ACC&FIN #29", owner: "Finance",
      value: done ? Math.round((done.getTime() - due.getTime()) / day) : null,
      display: done ? (done <= due ? "On time" : `${Math.ceil((done.getTime() - due.getTime()) / day)} days late`) : i.asOf > due ? "Overdue" : "Not yet",
      target: `by ${due.toISOString().slice(0, 10)}`,
      status: done ? (done <= due ? "On target" : "Off target") : i.asOf > due ? "Off target" : "Running",
      detail: done ? `Signed ${done.toISOString().slice(0, 10)}.` : `Due ${due.toISOString().slice(0, 10)}; not signed yet.`,
    });
  }

  // 12. Automatic decision rate (for information).
  {
    const v = i.variances;
    const auto = v.filter((x) => x.auto).length;
    out.push({
      code: "AUTO_DECIDED", name: "Variances decided automatically", source: "Hub", owner: "Operations",
      value: v.length ? (auto / v.length) * 100 : null, display: v.length ? pctText((auto / v.length) * 100) : "-", target: "for information",
      status: v.length ? "For information" : "Not measurable",
      detail: `${n0(auto)} of ${n0(v.length)} variances settled by the Level 1 rules.`,
    });
  }
  return out;
}
