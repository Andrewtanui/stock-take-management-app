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
  rows: { ref: string; info: string }[];
}

export type SheetStatus = "In progress" | "Submitted" | "Approved" | "Rejected";
/** One physical count line, as the reports read it. */
export interface CountRow {
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
}

/** A stack on the active stock take and where it is in the approval flow. */
export interface StackInfo {
  site: SiteCode;
  name: string;
  status: string;
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
  cause: RootCause;
  why: string;
  counter: string;
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
