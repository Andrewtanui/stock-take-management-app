// Shapes the Stock Management app works with. The mock repository fills them
// from the 2 Mar 2026 XBS snapshot plus scripted samples; in the real app they
// come from the NKG_config, Stock Takes and Count Sheets SharePoint lists, the
// Dataverse staging tables and the Comtras/BRIC extracts.

export type SiteCode = "IBR" | "AGL" | "KPCU" | "MAXA" | "MCF" | "KCCE";

/** W = XBS "Warehouse" stock, B = XBS "Blocked for Processing" stock. */
export type StockType = "W" | "B";

/** One row of the XBS "Current Stock – Batch Wise Detail" report. */
export interface XbsLine {
  t: StockType;
  wh: SiteCode;
  z?: string; // zone, e.g. "B-02/03-2"; "TEMP-0-0" = no location
  b: string; // batch no.
  o: string; // outturn no.
  i: string; // item (grade)
  bc?: string; // secondary basket code
  bn?: string; // secondary basket name
  bg: number; // full bags
  pk: number; // pockets (loose kg)
  u: number; // units = physical bag objects
  kg: number;
  g?: string; // grower marks
  wr?: string; // warrant no.
  c?: string; // certification
  cs?: string; // cup score
  bl: boolean;
  so?: string; // sales contract blocked to
  in?: string; // processing instruction
  d?: number; // days in stock
  cy?: string; // crop year
}

export interface Site {
  code: SiteCode;
  name: string;
  short: string;
  thirdParty: boolean;
  manualEntry: boolean;
}

/** Who is using the app. Drives what they can change and which sign-off step is theirs. */
export type Role = "Operations Admin" | "Warehouse Manager" | "Trading" | "Finance" | "IT Admin";

export type StockTakeType = "Monthly stock take" | "100% stock take";
export type StockTakeStatus = "Count in progress" | "Reconciliation" | "Sign-off" | "Completed";

export interface StockTake {
  id: string;
  title: string;
  type: StockTakeType;
  status: StockTakeStatus;
  countDate: string;
  importId: string;
  sites: SiteCode[];
  createdBy: string;
  sheets: { total: number; approved: number; pending: number; rejected: number };
}

export type ImportStatus = "Validated" | "Imported" | "Failed" | "Superseded";
export interface XbsImport {
  id: string;
  at: string;
  by: string;
  files: string[];
  rows: number;
  status: ImportStatus;
  issues: number;
}

export interface ImportCheck {
  id: string;
  label: string;
  result: "pass" | "warn" | "fail";
  detail: string;
  /** Example rows (some checks list only the first few). */
  rows: { ref: string; info: string }[];
  /** How many rows the check found in all; `rows` may be a sample. */
  count?: number;
}

export type SheetStatus = "In progress" | "Submitted" | "Approved" | "Rejected";
/** One physical count line, as the reports read it. */
export interface CountRow {
  /** Dataverse count line id (absent in the demo data). */
  id?: string;
  site: SiteCode;
  stack: string;
  batch: string;
  outturn: string;
  grade: string;
  bags: number;
  /** 0 = no pocket; a pocket counts as one unit. */
  pocketKg: number;
  units: number;
  kg: number;
  by: string;
  /** Dataverse user id of the counter (absent in the demo data). */
  byId?: string;
  /** ISO time the line was counted. */
  countedOn?: string;
  found: boolean;
  other: boolean;
  category?: string;
  reason?: string;
  /** A blind recount line; it replaces earlier lines for the same lot. */
  recount: boolean;
  /** Count sheet the line belongs to (its name). */
  sheet?: string;
  /** Dataverse Note id of the photo of the tag, if one was taken. */
  photo?: string;
  /** An open blind recount of this line (its R-### name), if one was asked for. */
  recountOpen?: string;
}

/** A stack on the active stock take and where it is in the approval flow. */
export interface StackInfo {
  site: SiteCode;
  name: string;
  status: string;
  /** A third-party site the counter reported as having nothing to count. */
  empty?: boolean;
}

export interface CountSheet {
  id: string;
  counter: string;
  site: SiteCode;
  area: string;
  status: SheetStatus;
  lots: number;
  variances: number;
  bags: number;
  submittedAt?: string;
  comment?: string;
}

/** Variance reasons agreed in the discovery session. */
export type RootCause =
  | "Split lot"
  | "Unposted receipt"
  | "Unposted gate-out"
  | "Duplicate entry"
  | "Mapping error"
  | "Pocket / unit difference"
  | "Wrong basket on sale"
  | "In transit"
  | "Cancelled contract"
  | "Partial delivery: rest still at third party"
  | "Weight loss: claim from warehouse"
  | "Posting timing / late posting"
  | "Not yet known";

export interface Variance {
  id: string;
  /** Dataverse Note id of the counter's photo of the tag, if one was taken. */
  photo?: string;
  site: SiteCode;
  zone: string;
  outturn: string;
  grade: string;
  expected: number;
  counted: number;
  /** Weights, when known; a lot can match on units and still differ in kg. */
  expectedKg?: number;
  countedKg?: number;
  cause: RootCause;
  why: string;
  counter: string;
  /** Dataverse user id of the counter (absent in the demo data). */
  counterId?: string;
  at: string;
  state: "open" | "recount" | "accepted" | "exception";
  ageHours: number;
}

export interface Check {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  owner: string;
  count: number;
  bags: number;
  unit: string;
  rows: { ref: string; where: string; info: string; bags: number }[];
}

export interface Counter {
  name: string;
  site: SiteCode;
  /** Every warehouse the counter is assigned to (first = `site`); `area` then names them all. */
  sites?: SiteCode[];
  area: string;
  bagsSoFar: number;
  startedAt: number;
  recounts: number;
}

export type Dept = "Operations" | "Warehouse" | "Trading" | "Finance" | "Logistics" | "Quality";
export interface Exception {
  id: string;
  title: string;
  kind: string;
  ref: string;
  dept: Dept;
  owner: string;
  raised: string;
  dueDays: number; // working days left; negative = overdue
  ageDays: number;
  status: "Open" | "In progress" | "Escalated" | "Closed";
  escalation: number; // 0 = owner, 1 = HOD, 2 = Country Finance Manager
  bags: number;
  source: "Count" | "Import" | "Pre-count check" | "Reconciliation";
  /** How it was fixed; required to close. */
  resolution?: string;
}

export type PrimaryBasket = "Plus" | "FAQ" | "Grinder";
export interface BasketMap {
  code: string;
  name: string;
  primary: PrimaryBasket;
  bags: number;
}
export interface MappingChange {
  id: string;
  what: string;
  from: string;
  to: string;
  by: string;
  at: string;
  reason: string;
  state: "Pending" | "Approved" | "Rejected";
}

export interface DirectPurchase {
  contract: string;
  supplier: string;
  kind: "Co-operative" | "Agent";
  outturn?: string;
  warrant?: string;
  grade: string;
  bagsContracted: number;
  bagsInvoiced: number;
  bagsDelivered: number;
  invoiceDate: string;
}

export interface Issue {
  id: string;
  category: string;
  site: SiteCode;
  screen: string;
  text: string;
  by: string;
  at: string;
  status: "Open" | "In progress" | "Resolved";
  owner?: string;
  resolution?: string;
  linkedCause?: RootCause;
  /** Dataverse Note id of the counter's photo, if one was sent. */
  photo?: string;
}

export interface AuditEntry {
  at: string;
  by: string;
  list: string;
  item: string;
  change: string;
}

export interface UserRow {
  name: string;
  email: string;
  role: Role | "Counter";
  sites: string;
}

/* ---------- counter allocation ---------- */

/** Who counts, and where they normally work (never allocated to them). */
export interface CounterProfile {
  /** Dataverse id; absent until saved. */
  id?: string;
  userId: string;
  name: string;
  homeSite?: SiteCode;
  homeRows: string[];
  thirdPartyOk: boolean;
  active: boolean;
  notes?: string;
}

/** A supervisor's change to a generated plan, kept with the run for audit. */
export interface AllocationChange {
  at: string;
  by: string;
  what: string;
}

/** One published random allocation (stk_allocationrun). */
export interface AllocationRun {
  id: string;
  name: string;
  status: "Draft" | "Published" | "Superseded";
  seed: number;
  spreadPct: number;
  /** User ids of the counters present. */
  present: string[];
  plan: import("./allocate").Plan;
  changes: AllocationChange[];
  by?: string;
  at?: string;
}

/** A line of Finance's bridge from the Comtras (BRIC) total to the Ibero stock position. */
export interface ReconItem {
  id?: string;
  label: string;
  kind: "Coffee afloat" | "Reconciling item";
  /** 60 kg bags. Positive: BRIC has it, the warehouses don't (afloat, delivered after the count…). */
  bags: number;
  /** Also applies to the XBS column (e.g. afloat, longs); otherwise physical only. */
  inXbs: boolean;
  note?: string;
  by?: string;
  at?: string;
}
