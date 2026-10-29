// The contract between the Stock Management app and wherever its data lives.
// Two implementations: ./mock (demo data in the browser) and ./dataverse (the
// IBKY Stock Take tables). Pick one with VITE_DATA=mock|dataverse.

import type { ReconItem } from "../types";
import type { GovernanceData } from "../governance";
import type { Kpi } from "../kpi";
import type { ComtrasLine, ComtrasUpload } from "../comtras-parse";
import type { ContractLine, ContractUpload } from "../contracts-parse";
import type { ShipmentLine, ShipmentUpload } from "../shipments-parse";
import type { XbsStuffing, XbsStuffingUpload } from "../xbs-shipped-parse";
import type { DirectLot, DirectUpload } from "../direct-parse";
import type { AllocRules, Plan } from "../allocate";
import type { Gate } from "../repository";
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
  signatures?: Partial<Record<Gate, Signature>>;
  /** Named signer (and stand-in) per gate, from the setting SignOffSigners; else GATES' person. */
  signers?: Partial<Record<Gate, Signer>>;
  /** Physical count lines and stacks of the active stock take (reports). */
  counts?: CountRow[];
  /** Whether counting is finished (Level 1 closes on its own), what is still missing, and the summary once closed. */
  countClose?: { ready: boolean; missing: string[]; closedAt?: string; summary?: string };
  /** Who runs Level 1 (setting Level1Runs), whether this Hub load ran it, and the engine's last finished run. */
  level1?: { runs: "Hub" | "Engine"; hubRuns: boolean; lastRun?: string };
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
  /** The Comtras 537 contract invoicing journal loaded for the active stock take, if any. */
  contractJournal?: ContractJournal;
  /** The shipment tracker (Trade / Logistics) loaded for the active stock take, if any. */
  shipments?: ShipmentTracker;
  /** XBS stuffing dates (shipped report) loaded for the active stock take: one file per month. */
  xbsStuffing?: XbsStuffingSet;
  /** Setting AfloatAgeingDays ("30,60"): day limits of the afloat ageing buckets. */
  afloatAgeingDays?: number[];
  /** Trading's direct purchase lots loaded for the active stock take, if any. */
  directLots?: DirectLots;
  /** Setting AssistantEnabled: the Stock Assistant agent and flow F11 exist in this environment. */
  assistant?: boolean;
  /** Governance KPIs: saved history, targets and the active stock take's dates. */
  governance?: GovernanceData;
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
  /** User id of the signer: one person signs at most one gate. */
  byId?: string;
  at: string;
  comment?: string;
}

/** Who signs a gate, and who may sign it while they are away. */
export interface Signer {
  name: string;
  email?: string;
  standIn?: { name: string; email?: string };
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
  /** The stock take's Level 1 summary PDF (written when counting closes), if there is one. */
  getL1Pdf?(stockTake: string): Promise<{ name: string; base64: string } | undefined>;
  /**
   * Asks the Stock Assistant (Copilot Studio agent, through flow F11). `conversation` continues the
   * last answer's conversation; leave it empty to start a new one.
   */
  askAssistant?(question: string, conversation?: string): Promise<AssistantAnswer>;
  /** Saves the active stock take's governance KPIs (one row each); `freeze` marks them final (Finance signed). */
  saveKpis?(kpis: Kpi[], freeze: boolean): Promise<void>;
  /** Stores the upload as a new locked import; returns its name. */
  importXbs(upload: XbsUploadToSave, onProgress?: (done: number, total: number) => void): Promise<string>;
  addReconItem(item: ReconItem): Promise<string>;
  removeReconItem(id: string): Promise<void>;
  /** Stores the Comtras P526 position for the active stock take (locked: once per stock take). */
  importComtras(upload: ComtrasUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Stores the Comtras 537 journal for the active stock take (locked: once per stock take). */
  importContracts?(upload: ContractUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Stores the shipment tracker for the active stock take (locked: once per stock take). */
  importShipments?(upload: ShipmentUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Adds an XBS shipped report's stuffing dates to the active stock take (rows already saved are skipped). */
  importXbsStuffing?(upload: XbsStuffingUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Stores Trading's direct purchase lots for the active stock take (locked: once per stock take). */
  importDirectLots?(upload: DirectUpload, onProgress?: (done: number, total: number) => void): Promise<void>;
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
  /** Records a signature or a send-back on a gate; resolves with the signer's user id when known. */
  addSignoff(gate: Gate, action: "signed" | "sent back", comment: string): Promise<string | void>;
  /** A photo's bytes, fetched only when someone opens it. */
  photo(id: string): Promise<{ mime: string; base64: string }>;
}

/** One answer from the Stock Assistant. `raw` is the agent's whole reply, for when `answer` is empty. */
export interface AssistantAnswer {
  answer: string;
  conversation: string;
  raw: string;
}

/** Trading's direct purchase lots as loaded for a stock take. */
export interface DirectLots {
  file: string;
  /** When it was loaded. */
  at: string;
  by: string;
  lots: DirectLot[];
}

/** XBS stuffing dates as loaded for a stock take, from one or more monthly shipped reports. */
export interface XbsStuffingSet {
  files: string[];
  rows: XbsStuffing[];
}

/** The shipment tracker as loaded for a stock take. */
export interface ShipmentTracker {
  file: string;
  /** When it was loaded. */
  at: string;
  by: string;
  lines: ShipmentLine[];
}

/** The Comtras 537 contract invoicing journal as loaded for a stock take. */
export interface ContractJournal {
  file: string;
  /** When it was loaded. */
  at: string;
  by: string;
  lines: ContractLine[];
}

/** The Comtras P526 report as loaded for a stock take. */
export interface ComtrasPosition {
  file: string;
  /** When it was loaded. */
  at: string;
  by: string;
  lines: ComtrasLine[];
}
