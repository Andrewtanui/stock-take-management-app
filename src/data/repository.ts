// Mock data layer for the Stock Management app. Every function here is what a
// screen calls; in the real app each one is swapped for a generated Power Apps
// data service. Screens never read the JSON directly.

import raw from "./xbs-2026-03-02.json";
import type {
  AuditEntry,
  BasketMap,
  Check,
  Counter,
  CountSheet,
  DirectPurchase,
  Exception,
  ImportCheck,
  Issue,
  MappingChange,
  PrimaryBasket,
  Role,
  Site,
  SiteCode,
  StockTake,
  UserRow,
  Variance,
  XbsImport,
  XbsLine,
} from "./types";

const lines = raw as XbsLine[];
export const allLines = () => lines;
export const linesAt = (wh: SiteCode) => lines.filter((l) => l.wh === wh);
export const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

export const TODAY = { date: "Wed 4 Mar 2026", now: "09:15", countDay: "Mon 2 Mar 2026", signOffDay: 2, signOffTarget: 7 };
export const TARGET_PCT = 0.1;
export const SITE_CEILING = 6000;
export const SLA_DAYS = 5;

export const SITES: Site[] = [
  { code: "IBR", name: "Ibero Export Warehouse", short: "Ibero", thirdParty: false, manualEntry: true },
  { code: "AGL", name: "AGL", short: "AGL", thirdParty: true, manualEntry: false },
  { code: "KPCU", name: "New KPCU", short: "New KPCU", thirdParty: true, manualEntry: false },
  { code: "MAXA", name: "Maxa Africa Logistics", short: "Maxa", thirdParty: true, manualEntry: false },
  { code: "MCF", name: "Mitchel Cotts Freight", short: "Mitchel Cotts", thirdParty: true, manualEntry: false },
  { code: "KCCE", name: "Kenya Co-op Coffee Exporters", short: "KCCE", thirdParty: true, manualEntry: false },
];
export const site = (c: SiteCode) => SITES.find((s) => s.code === c)!;

/* ---------- roles & separation of duties ---------- */

export const ROLES: Role[] = ["Operations Admin", "Warehouse Manager", "Trading", "Finance", "IT Admin"];

/** The approval chain agreed with the business: each gate signs in order. */
export const CHAIN: { role: Role; title: string; signs: string }[] = [
  { role: "Operations Admin", title: "Operations", signs: "Counts complete, variances explained" },
  { role: "Warehouse Manager", title: "Warehouse", signs: "Physical position by warehouse" },
  { role: "Trading", title: "Trading", signs: "Contracts, blocks and basket allocation" },
  { role: "Finance", title: "Finance", signs: "Certifies the stock position" },
];

/** What each role may change. Everyone can view. */
export const PERMISSIONS: { area: string; can: Role[] }[] = [
  { area: "Create and close stock takes", can: ["Operations Admin"] },
  { area: "Import XBS stock", can: ["Operations Admin", "IT Admin"] },
  { area: "Approve or reject count sheets", can: ["Operations Admin", "Warehouse Manager"] },
  { area: "Decide variance causes", can: ["Operations Admin", "Warehouse Manager", "Finance"] },
  { area: "Request mapping changes", can: ["Trading", "Finance", "Operations Admin"] },
  { area: "Approve mapping changes", can: ["Finance"] },
  { area: "Warehouses, locations, grades, settings", can: ["IT Admin", "Operations Admin"] },
  { area: "User roles", can: ["IT Admin"] },
];
export const can = (role: Role, area: string) => PERMISSIONS.find((p) => p.area === area)?.can.includes(role) ?? false;

/* ---------- stock takes & imports ---------- */

export const STOCK_TAKES: StockTake[] = [
  {
    id: "ST-2026-03",
    title: "Monthly Stock Take - 02/03/2026",
    type: "Monthly stock take",
    status: "Reconciliation",
    countDate: "Mon 2 Mar 2026",
    importId: "IMP-260302-0852",
    sites: ["IBR", "AGL", "KPCU", "MAXA", "MCF", "KCCE"],
    createdBy: "Peter M.",
    sheets: { total: 16, approved: 11, pending: 3, rejected: 2 },
  },
  {
    id: "ST-2026-02",
    title: "Monthly Stock Take - 31/01/2026",
    type: "Monthly stock take",
    status: "Completed",
    countDate: "Sat 31 Jan 2026",
    importId: "IMP-260131-0715",
    sites: ["IBR", "AGL", "KPCU", "MAXA", "MCF"],
    createdBy: "Peter M.",
    sheets: { total: 14, approved: 14, pending: 0, rejected: 0 },
  },
  {
    id: "ST-2025-12",
    title: "100% Stock Take - 04/12/2025",
    type: "100% stock take",
    status: "Completed",
    countDate: "Thu 4 Dec 2025",
    importId: "IMP-251203-2244",
    sites: ["IBR", "AGL", "KPCU", "MAXA", "MCF", "KCCE"],
    createdBy: "Peter M.",
    sheets: { total: 22, approved: 22, pending: 0, rejected: 0 },
  },
];

export const IMPORTS: XbsImport[] = [
  {
    id: "IMP-260302-0852",
    at: "Mon 2 Mar 2026, 08:52",
    by: "Peter M.",
    files: ["9_XBS - Current Stock - 02-Mar-2026 - 085230.xlsx", "9_XBS - Current Stock - 02-Mar-2026 - 085250.xlsx"],
    rows: lines.length,
    status: "Imported",
    issues: 0,
  },
  { id: "IMP-260301-2035", at: "Sun 1 Mar 2026, 20:35", by: "Peter M.", files: ["9_XBS - Current Stock - 01-Mar-2026.xlsx"], rows: 1388, status: "Failed", issues: 1 },
  { id: "IMP-260131-0715", at: "Sat 31 Jan 2026, 07:15", by: "Peter M.", files: ["9_XBS - Current Stock - 31-Jan-2026.xlsx", "9_XBS - Blocked - 31-Jan-2026.xlsx"], rows: 1702, status: "Superseded", issues: 0 },
  { id: "IMP-251203-2244", at: "Wed 3 Dec 2025, 22:44", by: "Peter M.", files: ["9_XBS - Current Stock - 03-Dec-2025.xlsx", "9_XBS - Blocked - 03-Dec-2025.xlsx"], rows: 1841, status: "Superseded", issues: 0 },
];

const WARRANT_RE = /^W\d{6}[A-Z0-9]{3}$/;
const where = (l: XbsLine) => `${site(l.wh).short}${l.z && l.z !== "TEMP-0-0" ? " " + l.z : ""}`;

/** Checks run on an XBS upload before it becomes the expected stock for a count. */
export function importChecks(): ImportCheck[] {
  const W = lines.filter((l) => l.t === "W");
  const B = lines.filter((l) => l.t === "B");
  const badWarrant = W.filter((l) => l.wr && !WARRANT_RE.test(l.wr));
  const noBasket = lines.filter((l) => !l.bc);
  const remnants = W.filter((l) => l.bg === 0);
  const noLoc = lines.filter((l) => site(l.wh).thirdParty === false && (!l.z || l.z === "TEMP-0-0"));
  // A true duplicate is an identical row. XBS also splits some batches into
  // several lines at one location (different quantities) — those are fine.
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(JSON.stringify(l), (seen.get(JSON.stringify(l)) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([k]) => JSON.parse(k) as XbsLine);
  const multi = new Set<string>();
  const byLoc = new Map<string, number>();
  for (const l of lines) {
    const k = `${l.t}|${l.b}|${l.wh}|${l.z}`;
    byLoc.set(k, (byLoc.get(k) ?? 0) + 1);
    if (byLoc.get(k)! > 1) multi.add(k);
  }
  const kgOff = lines.filter((l) => {
    const pack = l.bg ? Math.round((l.kg - l.pk) / l.bg) : 60;
    return l.bg > 0 && pack !== 60 && pack !== 50;
  });
  return [
    {
      id: "files",
      label: "Both XBS reports present",
      result: "pass",
      detail: `Warehouse stock (${W.length} rows) and Blocked for Processing (${B.length} rows).`,
      rows: [],
    },
    {
      id: "wh",
      label: "Every row has a known warehouse",
      result: "pass",
      detail: `${SITES.length} warehouses found, all set up in NKG_config.`,
      rows: [],
    },
    {
      id: "dupe",
      label: "No duplicate rows",
      result: dupes.length ? "fail" : "pass",
      detail: dupes.length
        ? `${dupes.length} rows appear twice, identical in every field.`
        : `No identical rows. ${multi.size} batches have more than one XBS line at the same location; the counter app shows each as one lot.`,
      rows: dupes.slice(0, 20).map((l) => ({ ref: l.o, info: where(l) })),
    },
    {
      id: "pack",
      label: "Weights fit a 60 kg or 50 kg bag",
      result: kgOff.length ? "warn" : "pass",
      detail: kgOff.length ? `${kgOff.length} rows don't divide into either pack size.` : "Every row is bags × 60 or bags × 50 plus pockets.",
      rows: kgOff.slice(0, 20).map((l) => ({ ref: l.o, info: `${l.bg} bags, ${l.kg} kg` })),
    },
    {
      id: "basket",
      label: "Every outturn maps to a basket",
      result: noBasket.length ? "warn" : "pass",
      detail: `${noBasket.length} rows have no secondary basket. They can't be reconciled against Comtras until mapped.`,
      rows: noBasket.map((l) => ({ ref: l.o, info: `${l.i} · ${where(l)}` })),
    },
    {
      id: "warrant",
      label: "Warrant numbers in the right format",
      result: badWarrant.length ? "warn" : "pass",
      detail: `${badWarrant.length} warrants aren't W + date + 3 characters, so tags can't be matched.`,
      rows: badWarrant.slice(0, 40).map((l) => ({ ref: l.o, info: l.wr! })),
    },
    {
      id: "loc",
      label: "Ibero rows have a stack location",
      result: noLoc.length ? "warn" : "pass",
      detail: noLoc.length ? `${noLoc.length} Ibero rows have no location.` : "Every Ibero row has a location.",
      rows: noLoc.map((l) => ({ ref: l.o, info: where(l) })),
    },
    {
      id: "remnant",
      label: "Pocket-only remainders",
      result: remnants.length ? "warn" : "pass",
      detail: `${remnants.length} lots have no full bags left, only loose kilos.`,
      rows: remnants.map((l) => ({ ref: l.o, info: `${l.kg} kg · ${where(l)}` })),
    },
  ];
}

/* ---------- count day ---------- */

export const COUNTERS: Counter[] = [
  { name: "Achieng O.", site: "IBR", area: "Rows D–E", bagsSoFar: 6180, startedAt: 7, recounts: 1 },
  { name: "Brian K.", site: "IBR", area: "Rows D–E", bagsSoFar: 5960, startedAt: 7, recounts: 1 },
  { name: "Cynthia W.", site: "IBR", area: "Rows A–B", bagsSoFar: 6405, startedAt: 7, recounts: 0 },
  { name: "Dennis M.", site: "IBR", area: "Rows A–B", bagsSoFar: 6010, startedAt: 7, recounts: 1 },
  { name: "Esther N.", site: "IBR", area: "Row C", bagsSoFar: 5875, startedAt: 7, recounts: 1 },
  { name: "Felix O.", site: "IBR", area: "Row C", bagsSoFar: 5790, startedAt: 7, recounts: 0 },
  { name: "Grace A.", site: "IBR", area: "Rows F–G", bagsSoFar: 4240, startedAt: 9, recounts: 0 },
  { name: "Hassan J.", site: "AGL", area: "Site 1", bagsSoFar: 4410, startedAt: 8, recounts: 1 },
  { name: "Irene K.", site: "AGL", area: "Site 2", bagsSoFar: 4205, startedAt: 8, recounts: 0 },
  { name: "James W.", site: "AGL", area: "Site 3", bagsSoFar: 3930, startedAt: 8, recounts: 2 },
  { name: "Kevin T.", site: "AGL", area: "Site 4", bagsSoFar: 3415, startedAt: 9, recounts: 0 },
  { name: "Lucy M.", site: "KPCU", area: "Whole site", bagsSoFar: 2280, startedAt: 8, recounts: 0 },
  { name: "Moses K.", site: "MAXA", area: "Whole site", bagsSoFar: 1307, startedAt: 10, recounts: 0 },
  { name: "Nancy C.", site: "MCF", area: "Whole site", bagsSoFar: 187, startedAt: 10, recounts: 0 },
];

export const HOURLY = [
  { h: "07", bags: 3480 },
  { h: "08", bags: 7620 },
  { h: "09", bags: 8260 },
  { h: "10", bags: 7890 },
  { h: "11", bags: 8150 },
  { h: "12", bags: 6420 },
  { h: "13", bags: 4980 },
  { h: "14", bags: 7110 },
  { h: "15", bags: 6900 },
  { h: "16", bags: 4610 },
];

export function coverage() {
  const counted: Partial<Record<SiteCode, number>> = { IBR: 40460, AGL: 15960, KPCU: 2280, MAXA: 1307, MCF: 187, KCCE: 38 };
  return SITES.map((s) => {
    const total = sum(linesAt(s.code), (l) => l.bg);
    return { site: s, total, done: Math.min(total, counted[s.code] ?? 0), lots: linesAt(s.code).length };
  });
}

export const SHEETS: CountSheet[] = [
  { id: "CS-101", counter: "Cynthia W.", site: "IBR", area: "Rows A–B", status: "Approved", lots: 212, variances: 1, bags: 6405, submittedAt: "Mon 16:40" },
  { id: "CS-102", counter: "Dennis M.", site: "IBR", area: "Rows A–B", status: "Approved", lots: 198, variances: 1, bags: 6010, submittedAt: "Mon 16:52" },
  { id: "CS-103", counter: "Esther N.", site: "IBR", area: "Row C", status: "Approved", lots: 176, variances: 1, bags: 5875, submittedAt: "Mon 16:20" },
  { id: "CS-104", counter: "Felix O.", site: "IBR", area: "Row C", status: "Submitted", lots: 171, variances: 1, bags: 5790, submittedAt: "Mon 16:31", comment: "Two stacks re-stacked during the count; checked twice." },
  { id: "CS-105", counter: "Achieng O.", site: "IBR", area: "Rows D–E", status: "Rejected", lots: 205, variances: 2, bags: 6180, submittedAt: "Mon 17:05", comment: "D-04-3: 16EC0009 short 2 units. Recount sent." },
  { id: "CS-106", counter: "Brian K.", site: "IBR", area: "Rows D–E", status: "Submitted", lots: 199, variances: 2, bags: 5960, submittedAt: "Mon 17:10" },
  { id: "CS-107", counter: "Grace A.", site: "IBR", area: "Rows F–G", status: "Approved", lots: 133, variances: 0, bags: 4240, submittedAt: "Mon 17:25" },
  { id: "CS-108", counter: "Hassan J.", site: "AGL", area: "Site 1", status: "Approved", lots: 152, variances: 1, bags: 4410, submittedAt: "Mon 18:02" },
  { id: "CS-109", counter: "Irene K.", site: "AGL", area: "Site 2", status: "Submitted", lots: 147, variances: 1, bags: 4205, submittedAt: "Mon 18:15", comment: "Tags faded at north wall; two lots confirmed with AGL staff." },
  { id: "CS-110", counter: "James W.", site: "AGL", area: "Site 3", status: "Rejected", lots: 139, variances: 3, bags: 3930, submittedAt: "Mon 19:40", comment: "Three non-NKG lots counted. Remove and recount Site 3 bay 2." },
  { id: "CS-111", counter: "Kevin T.", site: "AGL", area: "Site 4", status: "Approved", lots: 117, variances: 0, bags: 3415, submittedAt: "Mon 18:30" },
  { id: "CS-112", counter: "Lucy M.", site: "KPCU", area: "Whole site", status: "Approved", lots: 90, variances: 0, bags: 2280, submittedAt: "Mon 15:10" },
  { id: "CS-113", counter: "Moses K.", site: "MAXA", area: "Whole site", status: "Approved", lots: 47, variances: 0, bags: 1307, submittedAt: "Mon 14:02" },
  { id: "CS-114", counter: "Nancy C.", site: "MCF", area: "Whole site", status: "Approved", lots: 23, variances: 0, bags: 187, submittedAt: "Mon 12:40" },
  { id: "CS-115", counter: "Lucy M.", site: "KCCE", area: "Whole site", status: "Approved", lots: 5, variances: 0, bags: 38, submittedAt: "Mon 16:55" },
  { id: "CS-116", counter: "Achieng O.", site: "IBR", area: "Recounts", status: "Approved", lots: 2, variances: 0, bags: 97, submittedAt: "Tue 09:20" },
];

/* ---------- variances ---------- */

export const VARIANCES: Variance[] = [
  {
    id: "V-0412", site: "IBR", zone: "A-03-2", outturn: "12KN0015", grade: "AA · KARIAINI",
    expected: 41, counted: 0, cause: "Mapping error",
    why: "At the same stack a counter recorded 12KP0015, which XBS doesn't hold anywhere. Same unit count (41). Likely a misread tag or a typo in XBS.",
    counter: "Cynthia W.", at: "Mon 09:14", state: "open", ageHours: 48,
  },
  {
    id: "V-0415", site: "IBR", zone: "A-01-1", outturn: "16 lots", grade: "BULK · sales contracts",
    expected: 242, counted: 0, cause: "Unposted gate-out",
    why: "All 16 lots are blocked to contracts the shipment tracker shows as stuffed on 28 Feb. The stuffing hasn't been posted out of XBS.",
    counter: "Dennis M.", at: "Mon 09:31", state: "exception", ageHours: 48,
  },
  {
    id: "V-0418", site: "IBR", zone: "C-11-1", outturn: "08GF0003", grade: "PB · KANGOCHO",
    expected: 8, counted: 16, cause: "Duplicate entry",
    why: "Esther N. and Felix O. both submitted this outturn at C-11-1, 6 minutes apart, with 8 units each.",
    counter: "Felix O.", at: "Mon 10:02", state: "open", ageHours: 47,
  },
  {
    id: "V-0421", site: "IBR", zone: "D-04-3", outturn: "11SM0024", grade: "AB · KARUMANDI",
    expected: 0, counted: 39, cause: "Unposted receipt",
    why: "XBS still shows this outturn at AGL (39 units). It looks like it was moved to Ibero without the transfer being received in XBS.",
    counter: "Brian K.", at: "Mon 10:26", state: "open", ageHours: 47,
  },
  {
    id: "V-0422", site: "AGL", zone: "AGL · Site 2", outturn: "11SM0024", grade: "AB · KARUMANDI",
    expected: 39, counted: 0, cause: "In transit",
    why: "Linked to V-0421: the same 39 units were counted at Ibero D-04-3.",
    counter: "Irene K.", at: "Mon 10:40", state: "open", ageHours: 46,
  },
  {
    id: "V-0424", site: "AGL", zone: "AGL · Site 1", outturn: "14SM0009", grade: "AB · KARUMANDI",
    expected: 1, counted: 0, cause: "Split lot",
    why: "The other 68 bags of this outturn are at Ibero D-03/04-1 and matched. The single bag at AGL is probably left behind or merged at loading.",
    counter: "Hassan J.", at: "Mon 10:55", state: "recount", ageHours: 46,
  },
  {
    id: "V-0427", site: "IBR", zone: "D-09-1", outturn: "KCS7222", grade: "CLEAN 1",
    expected: 66, counted: 63, cause: "Not yet known",
    why: "No matching movement or duplicate found. Three units short with no pockets recorded. A blind recount was sent to Achieng O.",
    counter: "Brian K.", at: "Mon 11:21", state: "recount", ageHours: 45,
  },
  {
    id: "V-0431", site: "IBR", zone: "D-04-3", outturn: "16EC0009", grade: "AA · KINJO",
    expected: 31, counted: 29, cause: "Pocket / unit difference",
    why: "Recount found 31 units: two pocket bags were counted as one. Counts now match XBS.",
    counter: "Achieng O.", at: "Tue 09:20", state: "accepted", ageHours: 24,
  },
  {
    id: "V-0433", site: "AGL", zone: "AGL · Site 3", outturn: "3 lots", grade: "Not NKG coffee",
    expected: 0, counted: 96, cause: "Mapping error",
    why: "Three lots counted at Site 3 bay 2 aren't in XBS for NKG. AGL confirmed they belong to another exporter. Sheet sent back.",
    counter: "James W.", at: "Mon 15:44", state: "open", ageHours: 41,
  },
];

/* ---------- pre-count checks (computed from the snapshot) ---------- */

const CANCELLED = new Set(["3787011", "3787013"]);
const SHIPPED = new Set(["3786965"]);
export const STUFFED_28FEB = new Set([
  "3787141", "3787142", "3787143", "3787144", "3787145", "3787146", "3787147", "3787148",
  "3787149", "3787150", "3787151", "3787153", "3787154", "3787194", "3787195", "3787196",
]);

export function checks(): Check[] {
  const W = lines.filter((l) => l.t === "W");
  const tp = W.filter((l) => site(l.wh).thirdParty);
  const mk = (rows: XbsLine[], info: (l: XbsLine) => string, ref: (l: XbsLine) => string = (l) => l.o) =>
    rows.map((l) => ({ ref: ref(l), where: where(l), info: info(l), bags: l.bg }));

  const cancelled = W.filter((l) => l.so && CANCELLED.has(l.so));
  const shipped = W.filter((l) => l.so && SHIPPED.has(l.so));
  const stuffed = W.filter((l) => l.so && STUFFED_28FEB.has(l.so));
  const aged = tp.filter((l) => (l.d ?? 0) > 21).sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
  const byOutturn = new Map<string, XbsLine[]>();
  for (const l of W) byOutturn.set(l.o, [...(byOutturn.get(l.o) ?? []), l]);
  const split = [...byOutturn.values()].filter((xs) => new Set(xs.map((x) => x.wh)).size > 1);
  const over = coverage().filter((c) => c.site.thirdParty && c.total > SITE_CEILING);

  return [
    {
      id: "stuffed", severity: "high", owner: "Logistics",
      title: "Stuffed but still in stock",
      detail: "Contracts show stuffing on 28 Feb, but the lots haven't been posted out of XBS. Counters will find nothing at A-01-1.",
      count: new Set(stuffed.map((l) => l.so)).size, bags: sum(stuffed, (l) => l.bg), unit: "contracts",
      rows: mk(stuffed, (l) => `Contract ${l.so} · stuffed 28 Feb`, (l) => l.o),
    },
    {
      id: "cancelled", severity: "high", owner: "Trading",
      title: "Stock blocked to cancelled contracts",
      detail: "The contract is cancelled in the shipment tracker but the lot is still blocked to it in XBS. Release the block in BRIC and XBS.",
      count: new Set(cancelled.map((l) => l.so)).size, bags: sum(cancelled, (l) => l.bg), unit: "contracts",
      rows: mk(cancelled, (l) => `Contract ${l.so} · cancelled`),
    },
    {
      id: "shipped", severity: "high", owner: "Trading",
      title: "Stock blocked to a shipped contract",
      detail: "Contract 3786965 sailed on 8 Nov 2025 and its documents are dispatched. These lots should no longer be on the books.",
      count: shipped.length, bags: sum(shipped, (l) => l.bg), unit: "lots",
      rows: mk(shipped, (l) => `Contract ${l.so} · ${l.d} days`),
    },
    {
      id: "ceiling", severity: "medium", owner: "Operations",
      title: "Third-party sites over the 6,000-bag ceiling",
      detail: "Above this, one count day isn't enough. Call off stock to Ibero before the count, or plan extra counters.",
      count: over.length, bags: sum(over, (c) => c.total - SITE_CEILING), unit: "sites",
      rows: over.map((c) => ({ ref: c.site.short, where: c.site.name, info: `${c.total.toLocaleString("en-GB")} bags`, bags: c.total - SITE_CEILING })),
    },
    {
      id: "aged", severity: "medium", owner: "Operations",
      title: "Third-party stock over 21 days",
      detail: "Past the call-off rule. Each day adds storage cost.",
      count: aged.length, bags: sum(aged, (l) => l.bg), unit: "lots",
      rows: mk(aged, (l) => `${l.d} days · ${l.i}${l.g ? " · " + l.g : ""}`),
    },
    {
      id: "split", severity: "medium", owner: "Operations",
      title: "Outturns split across sites",
      detail: "The same outturn is expected at more than one warehouse. Counters get a prompt so stray bags aren't missed.",
      count: split.length, bags: sum(split.flat(), (l) => l.bg), unit: "outturns",
      rows: split.map((xs) => ({ ref: xs[0].o, where: xs.map((x) => `${site(x.wh).short} ${x.bg}`).join(", "), info: xs[0].g ?? xs[0].i, bags: sum(xs, (x) => x.bg) })),
    },
  ];
}

/* ---------- mapping & reconciliation ---------- */

/** Starting rule for secondary → primary basket. The mapping table below is what's maintained. */
function guessPrimary(name = ""): PrimaryBasket {
  if (/Top|Plus|Better|Certified/i.test(name)) return "Plus";
  if (/Grinder|Minus|MH|ML|UG|NATURAL|below|Light|H CLASS/i.test(name)) return "Grinder";
  return "FAQ";
}

export function basketMap(): BasketMap[] {
  const m = new Map<string, BasketMap>();
  for (const l of lines) {
    if (!l.bc) continue;
    const b = m.get(l.bc) ?? { code: l.bc, name: l.bn ?? "", primary: guessPrimary(l.bn), bags: 0 };
    b.bags += l.bg;
    m.set(l.bc, b);
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function outturnMap() {
  const m = new Map<string, { outturn: string; grade: string; basket?: string; basketName?: string; sites: Set<string>; bags: number }>();
  for (const l of lines) {
    const r = m.get(l.o) ?? { outturn: l.o, grade: l.i, basket: l.bc, basketName: l.bn, sites: new Set<string>(), bags: 0 };
    r.sites.add(site(l.wh).short);
    r.bags += l.bg;
    m.set(l.o, r);
  }
  return [...m.values()];
}

export const MAPPING_CHANGES: MappingChange[] = [
  { id: "MC-014", what: "Basket 10071 AA/AB Better cup", from: "Plus", to: "FAQ", by: "Mary W. (Trading)", at: "Tue 3 Mar, 14:10", reason: "Better-cup lots are sold against FAQ contracts this season.", state: "Pending" },
  { id: "MC-015", what: "Outturn KCH1002", from: "No basket", to: "10060 AA FAQ", by: "Mary W. (Trading)", at: "Tue 3 Mar, 14:22", reason: "5 rows uploaded without a basket; grade FAQ + is an AA FAQ blend per the bulking instruction.", state: "Pending" },
  { id: "MC-012", what: "Basket 10264 UG3 GT Light", from: "FAQ", to: "Grinder", by: "Dennis I. (Finance)", at: "Fri 27 Feb, 10:05", reason: "Agreed in the February review.", state: "Approved" },
];

/** Physical differences found on count day, by outturn (counted − XBS, bags). Scripted from the variances. */
const PHYS_DELTA: Record<string, number> = { "12KN0015": -40, "08GF0003": 8, "14SM0009": -1, KCS7222: -3 };
/** Comtras differences by secondary basket (Comtras − XBS, bags). Sample figures. */
const COMTRAS_DELTA: Record<string, number> = { "10070": 21, "10130": -9, "10040": 12 };

export interface ReconRow {
  key: string;
  label: string;
  xbs: number;
  physical: number;
  comtras: number;
}

export function reconciliation(map = basketMap()): { primary: ReconRow[]; secondary: (ReconRow & { primary: PrimaryBasket })[] } {
  const sec = new Map<string, ReconRow & { primary: PrimaryBasket }>();
  for (const l of lines) {
    const code = l.bc ?? "—";
    const b = map.find((x) => x.code === code);
    const r = sec.get(code) ?? { key: code, label: b ? `${code} ${b.name}` : "No basket", primary: b?.primary ?? "FAQ", xbs: 0, physical: 0, comtras: 0 };
    r.xbs += l.bg;
    const gone = l.so && STUFFED_28FEB.has(l.so);
    r.physical += gone ? 0 : l.bg;
    sec.set(code, r);
  }
  for (const [o, d] of Object.entries(PHYS_DELTA)) {
    const l = lines.find((x) => x.o === o);
    const r = l && sec.get(l.bc ?? "—");
    if (r) r.physical += d;
  }
  for (const r of sec.values()) r.comtras = r.xbs + (COMTRAS_DELTA[r.key] ?? 0);
  const secondary = [...sec.values()].sort((a, b) => a.key.localeCompare(b.key));
  const primary = (["Plus", "FAQ", "Grinder"] as PrimaryBasket[]).map((p) => {
    const xs = secondary.filter((s) => s.primary === p);
    return { key: p, label: p, xbs: sum(xs, (x) => x.xbs), physical: sum(xs, (x) => x.physical), comtras: sum(xs, (x) => x.comtras) };
  });
  return { primary, secondary };
}

/** Outturn-level lines behind a secondary basket, for drill-down. */
export function reconLines(basket: string) {
  const ls = lines.filter((l) => (l.bc ?? "—") === basket && l.t === "W");
  return ls.map((l) => {
    const gone = l.so && STUFFED_28FEB.has(l.so);
    const d = gone ? -l.bg : PHYS_DELTA[l.o] ?? 0;
    return { line: l, xbs: l.bg, physical: l.bg + d, note: gone ? `Stuffed 28 Feb on ${l.so}, not posted out` : d ? "See variance" : "" };
  });
}

/** Rows for the sign-off pack, in the layout of the NKG stock sign-off template. */
export function warehouseSummary() {
  return SITES.map((s) => {
    const ls = linesAt(s.code);
    let physUnits = 0;
    let physKg = 0;
    for (const l of ls) {
      const gone = l.so && STUFFED_28FEB.has(l.so);
      const d = gone ? -l.u : l.t === "W" ? PHYS_DELTA[l.o] ?? 0 : 0;
      physUnits += l.u + d;
      physKg += gone ? 0 : l.kg + d * 60;
    }
    const sysUnits = sum(ls, (l) => l.u);
    const sysKg = sum(ls, (l) => l.kg);
    return { site: s, physUnits, sysUnits, phys60: physKg / 60, sys60: sysKg / 60 };
  });
}

/* ---------- exceptions ---------- */

export const EXCEPTIONS: Exception[] = [
  { id: "EX-201", title: "16 lots stuffed 28 Feb not posted out of XBS", kind: "Unposted gate-out", ref: "V-0415", dept: "Logistics", owner: "Samuel K.", raised: "Mon 2 Mar", dueDays: 3, ageDays: 2, status: "In progress", escalation: 0, bags: 242, source: "Count" },
  { id: "EX-202", title: "Contracts 3787011, 3787013 cancelled but lots still blocked", kind: "Cancelled contract", ref: "Pre-count check", dept: "Trading", owner: "Mary W.", raised: "Fri 27 Feb", dueDays: -1, ageDays: 6, status: "Escalated", escalation: 1, bags: 132, source: "Pre-count check" },
  { id: "EX-203", title: "11SM0024 moved AGL → Ibero, transfer not received in XBS", kind: "Unposted receipt", ref: "V-0421", dept: "Warehouse", owner: "Peter M.", raised: "Mon 2 Mar", dueDays: 3, ageDays: 2, status: "Open", escalation: 0, bags: 39, source: "Count" },
  { id: "EX-204", title: "59 warrants in the wrong format", kind: "Master data", ref: "IMP-260302-0852", dept: "Trading", owner: "Mary W.", raised: "Mon 2 Mar", dueDays: 3, ageDays: 2, status: "Open", escalation: 0, bags: 0, source: "Import" },
  { id: "EX-205", title: "KCH1002: 5 XBS rows with no basket", kind: "Mapping error", ref: "IMP-260302-0852", dept: "Finance", owner: "Dennis I.", raised: "Mon 2 Mar", dueDays: 3, ageDays: 2, status: "In progress", escalation: 0, bags: 0, source: "Import" },
  { id: "EX-206", title: "Contract 3786965 shipped Nov 2025, lots still on the books", kind: "Unposted gate-out", ref: "Pre-count check", dept: "Trading", owner: "Mary W.", raised: "Mon 23 Feb", dueDays: -4, ageDays: 9, status: "Escalated", escalation: 2, bags: 60, source: "Pre-count check" },
  { id: "EX-207", title: "Comtras AB/PB FAQ 21 bags above XBS", kind: "Wrong basket on sale", ref: "Basket 10070", dept: "Finance", owner: "Dennis I.", raised: "Tue 3 Mar", dueDays: 4, ageDays: 1, status: "Open", escalation: 0, bags: 21, source: "Reconciliation" },
  { id: "EX-208", title: "Non-NKG coffee counted at AGL Site 3", kind: "Third-party", ref: "V-0433", dept: "Operations", owner: "Peter M.", raised: "Mon 2 Mar", dueDays: 3, ageDays: 2, status: "Open", escalation: 0, bags: 96, source: "Count" },
  { id: "EX-199", title: "Direct purchase DP-0219 invoiced, 40 bags not delivered", kind: "Direct purchase", ref: "DP-0219", dept: "Trading", owner: "Mary W.", raised: "Wed 18 Feb", dueDays: -6, ageDays: 11, status: "Escalated", escalation: 2, bags: 40, source: "Reconciliation" },
  { id: "EX-190", title: "Duplicate count 08GF0003 at C-11-1", kind: "Duplicate entry", ref: "V-0418", dept: "Operations", owner: "Peter M.", raised: "Mon 2 Mar", dueDays: 0, ageDays: 2, status: "Closed", escalation: 0, bags: 8, source: "Count" },
];
export const ESCALATION = ["Owner", "Head of department", "Country Finance Manager"];

/* ---------- direct purchases ---------- */

export const DIRECT_PURCHASES: DirectPurchase[] = [
  { contract: "DP-0219", supplier: "Othaya FCS", kind: "Co-operative", outturn: "17OT0004", warrant: "W260212OTH", grade: "AB", bagsContracted: 120, bagsInvoiced: 120, bagsDelivered: 80, invoiceDate: "12 Feb 2026" },
  { contract: "DP-0224", supplier: "Gikanda FCS", kind: "Co-operative", outturn: "17GK0011", warrant: "W260219GKD", grade: "AA", bagsContracted: 64, bagsInvoiced: 64, bagsDelivered: 64, invoiceDate: "19 Feb 2026" },
  { contract: "DP-0227", supplier: "Kamau Agencies", kind: "Agent", grade: "PB", bagsContracted: 90, bagsInvoiced: 45, bagsDelivered: 0, invoiceDate: "24 Feb 2026" },
  { contract: "DP-0231", supplier: "Rumukia FCS", kind: "Co-operative", outturn: "17RM0002", grade: "AB", bagsContracted: 150, bagsInvoiced: 0, bagsDelivered: 0, invoiceDate: "—" },
  { contract: "DP-0233", supplier: "Mwiruti FCS", kind: "Co-operative", outturn: "17MW0006", warrant: "W260227MWR", grade: "C", bagsContracted: 38, bagsInvoiced: 38, bagsDelivered: 38, invoiceDate: "27 Feb 2026" },
  { contract: "DP-0236", supplier: "Kagumo Traders", kind: "Agent", grade: "AA", bagsContracted: 200, bagsInvoiced: 0, bagsDelivered: 0, invoiceDate: "—" },
];

/* ---------- problem reports from counters ---------- */

export const ISSUES: Issue[] = [
  { id: "C-121", category: "Tag missing or unreadable", site: "AGL", screen: "Count a lot", text: "Tags faded at Site 2 north wall. Confirmed two lots with AGL staff.", by: "Irene K.", at: "Mon 2 Mar, 11:05", status: "Open", linkedCause: "Mapping error" },
  { id: "C-120", category: "Third-party staff not available", site: "AGL", screen: "Stack", text: "No AGL forklift driver after 17:00. Site 3 bay 2 couldn't be reached.", by: "James W.", at: "Mon 2 Mar, 17:20", status: "In progress", owner: "Peter M.", linkedCause: "Not yet known" },
  { id: "C-119", category: "Network or saving", site: "IBR", screen: "Count a lot", text: "No signal at the back of row G. Counts stayed on the phone for 20 minutes.", by: "Grace A.", at: "Mon 2 Mar, 10:12", status: "In progress", owner: "Michael A. (IT)", resolution: "Wi-Fi access point ordered for row G." },
  { id: "C-118", category: "Lot not on the list", site: "MAXA", screen: "Add a lot", text: "Two bags of 15KF2002 at Maxa but XBS shows the lot only at Ibero.", by: "Moses K.", at: "Mon 2 Mar, 13:40", status: "Open", linkedCause: "Split lot" },
  { id: "C-117", category: "App not working", site: "IBR", screen: "Count a lot", text: "Save button greyed out after entering pocket weight on a 50 kg lot.", by: "Cynthia W.", at: "Mon 2 Mar, 09:48", status: "Resolved", owner: "Michael A. (IT)", resolution: "Pocket rule now uses the lot's pack size. Fixed in version 3.2." },
];

/* ---------- admin: config, audit, users ---------- */

export const AUDIT: AuditEntry[] = [
  { at: "Tue 3 Mar 2026, 16:02", by: "Michael A.", list: "NKG_config", item: "AGL", change: "Manual outturn entry: On → Off" },
  { at: "Mon 2 Mar 2026, 06:45", by: "Peter M.", list: "Stock Takes", item: "ST-2026-03", change: "Created; warehouses: all; XBS import IMP-260302-0852" },
  { at: "Fri 27 Feb 2026, 10:05", by: "Dennis I.", list: "Basket mapping", item: "10264 UG3 GT Light", change: "Primary basket: FAQ → Grinder (approved MC-012)" },
  { at: "Thu 26 Feb 2026, 11:30", by: "Michael A.", list: "NKG_config", item: "Location format", change: "Grid codes A001–G014 enabled for 100% counts" },
  { at: "Mon 16 Feb 2026, 09:12", by: "Michael A.", list: "Users", item: "James W.", change: "Role: — → Counter; sites: AGL" },
];

export const USERS: UserRow[] = [
  { name: "Peter M.", email: "peter.m@nkg.coffee", role: "Operations Admin", sites: "All" },
  { name: "Joseph O.", email: "joseph.o@nkg.coffee", role: "Warehouse Manager", sites: "Ibero" },
  { name: "Mary W.", email: "mary.w@nkg.coffee", role: "Trading", sites: "All" },
  { name: "Dennis I.", email: "dennis.i@nkg.coffee", role: "Finance", sites: "All" },
  { name: "Carol M.", email: "carol.m@nkg.coffee", role: "Finance", sites: "All" },
  { name: "Michael A.", email: "michael.a@nkg.coffee", role: "IT Admin", sites: "All" },
  ...COUNTERS.map((c) => ({ name: c.name, email: `${c.name.split(" ")[0].toLowerCase()}@nkg.coffee`, role: "Counter" as const, sites: site(c.site).short })),
];

export const GRADES = [...new Set(lines.map((l) => l.i))].sort();
export const PACK_TYPES = [
  { id: "JUTE60", label: "60 kg jute bag", kg: 60, grades: "All except light coffee" },
  { id: "JUTE50", label: "50 kg jute bag", kg: 50, grades: "LIGHTS" },
];
export const STOCK_TAKE_GROUPS = [
  { name: "Ibero rows A–C", site: "Ibero", locations: "Rows A, B, C", counters: 4 },
  { name: "Ibero rows D–E", site: "Ibero", locations: "Rows D, E", counters: 2 },
  { name: "Ibero rows F–G", site: "Ibero", locations: "Rows F, G", counters: 1 },
  { name: "AGL sites 1–4", site: "AGL", locations: "Recorded on the day", counters: 4 },
  { name: "Small third parties", site: "KPCU, Maxa, MCF, KCCE", locations: "Recorded on the day", counters: 3 },
];

export const REPORTS = [
  { name: "Physical count by warehouse", what: "Bags and kg counted, per warehouse" },
  { name: "Physical count by grade", what: "Bags and kg counted, per grade" },
  { name: "System count by warehouse", what: "XBS expected stock, per warehouse" },
  { name: "Variance by warehouse", what: "Physical − XBS, bags and %, per warehouse" },
  { name: "Variance by grade", what: "Physical − XBS, bags and %, per grade" },
  { name: "Location summary", what: "Stock by stack location" },
  { name: "Warehouse summary", what: "Stock by warehouse and stock type" },
  { name: "Historical imports", what: "Every XBS upload with its checks" },
  { name: "Exception analytics", what: "Exceptions by root cause, owner and age" },
  { name: "Complaints log", what: "Problems raised by counters and how they were resolved" },
  { name: "Sign-off pack", what: "Reconciliation, variances and signatures as PDF or Excel" },
];
