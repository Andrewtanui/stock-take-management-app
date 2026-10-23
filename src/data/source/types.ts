// The contract between the Stock Management app and wherever its data lives.
// Two implementations: ./mock (demo data in the browser) and ./dataverse (the
// IBKY Stock Take tables). Pick one with VITE_DATA=mock|dataverse.

import type { ReconItem } from "../types";
import type { ComtrasLine, ComtrasUpload } from "../comtras-parse";
import type { AllocRules, Plan } from "../allocate";
import type {
  AllocationChange,
  AllocationRun,
  AuditEntry,
  BasketMap,
  Counter,
  CounterProfile,
  CountRow,
  CountSheet,
  DirectPurchase,
  Exception,
  Issue,
  StackInfo,
  MappingChange,
  Role,
  RootCause,
  SheetStatus,
  Site,
  SiteCode,
  StockTake,
  UserRow,
  Variance,
  XbsImport,
  XbsLine,
} from "../types";

export interface Today {
  date: string;
  now: string;
  countDay: string;
  signOffDay: number;
  signOffTarget: number;
}

/** Read-mostly data the screens look things up in. */
export interface Reference {
  today: Today;
  lines: XbsLine[];
  sites: Site[];
  imports: XbsImport[];
  counters: Counter[];
  hourly: { h: string; bags: number }[];
  countedBags: Partial<Record<SiteCode, number>>;
  directPurchases: DirectPurchase[];
  users: UserRow[];
  packTypes: { id: string; label: string; kg: number; grades: string }[];
  stockTakeGroups: { name: string; site: string; locations: string; counters: number }[];
  /** Contract states from the shipment tracker, for the pre-count checks. */
  contracts: { cancelled: string[]; shipped: string[]; stuffed: string[] };
  /** People who can own an exception (display names). */
  people: string[];
  /** Sample physical and Comtras differences until count lines and the Comtras extract are connected. */
  physDelta: Record<string, number>;
  comtrasDelta: Record<string, number>;
  /** The Comtras (BRIC) position loaded for the active stock take, if any. */
  comtras?: ComtrasPosition;
}

/** Everything the management app works with after start-up. */
export interface MgmtData {
  reference: Reference;
  /** Secondary → primary basket mapping (from stk_basketmap). Mock derives it from XBS names. */
  baskets?: BasketMap[];
  /** Sign-off so far on the active stock take. */
  signatures?: Partial<Record<Role, Signature>>;
  /** Physical count lines and stacks of the active stock take (reports). */
  counts?: CountRow[];
  stacks?: StackInfo[];
  stockTakes: StockTake[];
  sheets: CountSheet[];
  variances: Variance[];
  exceptions: Exception[];
  changes: MappingChange[];
  issues: Issue[];
  audit: AuditEntry[];
  /** Counter profiles, allocation runs and rules for the random counter allocation. */
  allocation?: AllocationData;
  /** The BRIC bridge for the active stock take: coffee afloat and reconciling items. */
  reconItems?: ReconItem[];
  /**
   * Set-up mode: there's no stock take yet (a fresh environment). The Hub opens on
   * XBS import; the pre-count checks read the latest import; starting the first
   * stock take reloads into normal mode.
   */
  setup?: boolean;
}

export interface AllocationData {
  profiles: CounterProfile[];
  /** Allocation runs on the active stock take, newest first. */
  runs: AllocationRun[];
  /** Area keys each counter had in the previous stock take's published plan (rotation). */
  lastAreas: Record<string, string[]>;
  rules: AllocRules;
  /** People who can be given a counter profile. */
  people: { id: string; name: string }[];
  /** Open recounts per person (user id), so new ones go to whoever has fewest. */
  openRecounts?: Record<string, number>;
}

/** Who signed each gate of the active stock take. */
export interface Signature {
  by: string;
  at: string;
  comment?: string;
}

/** A checked XBS upload, ready to be stored as a locked import. */
export interface XbsUploadToSave {
  files: string[];
  snapshotAt?: string;
  lines: XbsLine[];
  warnings: number;
  fails: number;
  /** Check results as JSON, kept with the import for audit. */
  checks: string;
}

export interface DataSource {
  readonly kind: "mock" | "dataverse";
  load(): Promise<MgmtData>;
  createStockTake(st: StockTake): Promise<void>;
  closeStockTake(id: string, comment: string): Promise<void>;
  /** Stores the upload as a new locked import; returns its name. */
  importXbs(upload: XbsUploadToSave, onProgress?: (done: number, total: number) => void): Promise<string>;
  addReconItem(item: ReconItem): Promise<string>;
  removeReconItem(id: string): Promise<void>;
  /** Stores the Comtras P526 position for the active stock take (locked: once per stock take). */
  importComtras(upload: ComtrasUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
  decideSheet(id: string, status: SheetStatus, comment: string): Promise<void>;
  /** `to`: who does a blind recount (a different counter); defaults to whoever counted. */
  decideVariance(id: string, state: Variance["state"], cause: RootCause, to?: { id: string; name: string }): Promise<void>;
  /** Creates or updates a counter profile; returns its id. */
  saveCounterProfile(p: CounterProfile): Promise<string>;
  /** Publishes an allocation: supersedes the last one, writes the counters' assignments; returns the run name (AR-###). */
  publishAllocation(input: { plan: Plan; present: string[]; changes: AllocationChange[] }): Promise<string>;
  /** Asks the line's counter for a blind recount of that one outturn; returns the recount's name. */
  recountLine(line: CountRow, note: string, to?: { id: string; name: string }): Promise<string>;
  addException(e: Exception): Promise<void>;
  updateException(id: string, patch: Partial<Exception>): Promise<void>;
  requestMapping(c: MappingChange): Promise<void>;
  decideMapping(id: string, approve: boolean): Promise<void>;
  setManualEntry(site: SiteCode, on: boolean): Promise<void>;
  updateIssue(id: string, patch: Partial<Issue>): Promise<void>;
  addDirectPurchase(d: DirectPurchase): Promise<void>;
  addSignoff(gate: Role, action: "signed" | "sent back", comment: string): Promise<void>;
  /** A photo's bytes, fetched only when someone opens it. */
  photo(id: string): Promise<{ mime: string; base64: string }>;
}

/** The Comtras P526 report as loaded for a stock take. */
export interface ComtrasPosition {
  file: string;
  /** When it was loaded. */
  at: string;
  by: string;
  lines: ComtrasLine[];
}
