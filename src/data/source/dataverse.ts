// Dataverse data source for the Stock Management app — reads the IBKY Stock
// Take tables through the generated Power Apps services. Runs inside the
// Power Apps host (Local Play or the published app).
//
// 7a: everything the screens show is read from Dataverse.
// 7b: on load, variances are generated from submitted stacks (see
//     ../variance-rules.ts); count sheets can be approved or sent back;
//     variances can be accepted, sent for a blind recount (a stk_recount for the
//     counter's phone) or raised as an exception.
// 7c: exceptions — owner (real users), remind, escalate, close with resolution.
// 7d: basket/outturn mapping from the mapping tables, change requests approved
//     by Finance (separation of duties via the EnforceSeparationOfDuties
//     setting), manual-entry switch, direct purchases, problem-report triage,
//     audit log from Dataverse's own change history.
// 7e: XBS import (rows read in the browser, stored as a locked import),
//     create / close stock takes (new ones copy the current assignments),
//     sign-off rows (gate order and separation of duties checked here too).

import { getContext } from "@microsoft/power-apps/app";
import type { IOperationResult } from "@microsoft/power-apps/data";
import type { IGetAllOptions } from "../../generated/models/CommonModels";
import { AuditsService } from "../../generated/services/AuditsService";
import { Stk_assignmentsService } from "../../generated/services/Stk_assignmentsService";
import { Stk_comtraspositionsService } from "../../generated/services/Stk_comtraspositionsService";
import { Stk_reconitemsService } from "../../generated/services/Stk_reconitemsService";
import { Stk_reconitemsstk_kind } from "../../generated/models/Stk_reconitemsModel";
import { Stk_subproductsService } from "../../generated/services/Stk_subproductsService";
import { Stk_subproductsstk_kind, Stk_subproductsstk_register } from "../../generated/models/Stk_subproductsModel";
import type { SubProductRegister, SubProductRow, SubProductUpload } from "../subproducts-parse";
import { planCountImport, type CountImportPlan, type CountPreview, type ImportLot, type ImportOptions, type ImportSite } from "../count-import";
import { Stk_commentsService } from "../../generated/services/Stk_commentsService";
import { Stk_commentsstk_department } from "../../generated/models/Stk_commentsModel";
import type { ComtrasLineType, ComtrasUpload } from "../comtras-parse";
import { Stk_allocationrunsService } from "../../generated/services/Stk_allocationrunsService";
import { Stk_counterprofilesService } from "../../generated/services/Stk_counterprofilesService";
import { Stk_allocationrunsstk_status } from "../../generated/models/Stk_allocationrunsModel";
import { Stk_basketmapsService } from "../../generated/services/Stk_basketmapsService";
import { Stk_mappingchangesService } from "../../generated/services/Stk_mappingchangesService";
import { Stk_outturnmapsService } from "../../generated/services/Stk_outturnmapsService";
import { Stk_countlinesService } from "../../generated/services/Stk_countlinesService";
import { Stk_countsheetsService } from "../../generated/services/Stk_countsheetsService";
import { Stk_directpurchasesService } from "../../generated/services/Stk_directpurchasesService";
import { Stk_exceptionsService } from "../../generated/services/Stk_exceptionsService";
import { Stk_issuesService } from "../../generated/services/Stk_issuesService";
import { Stk_packtypesService } from "../../generated/services/Stk_packtypesService";
import { Stk_recountsService } from "../../generated/services/Stk_recountsService";
import { Stk_settingsService } from "../../generated/services/Stk_settingsService";
import { Stk_signoffsService } from "../../generated/services/Stk_signoffsService";
import { AnnotationsService } from "../../generated/services/AnnotationsService";
import { Stk_sitesService } from "../../generated/services/Stk_sitesService";
import { Stk_stacksService } from "../../generated/services/Stk_stacksService";
import { Stk_stocktakesService } from "../../generated/services/Stk_stocktakesService";
import { Stk_xbsimportsService } from "../../generated/services/Stk_xbsimportsService";
import { Stk_variancesService } from "../../generated/services/Stk_variancesService";
import { Stk_xbslinesService } from "../../generated/services/Stk_xbslinesService";
import { SystemusersService } from "../../generated/services/SystemusersService";
import { Stk_countsheetsstk_status } from "../../generated/models/Stk_countsheetsModel";
import { Stk_directpurchasesstk_suppliertype } from "../../generated/models/Stk_directpurchasesModel";
import { Stk_issuesstk_category, Stk_issuesstk_linkedcause, Stk_issuesstk_status } from "../../generated/models/Stk_issuesModel";
import { Stk_stocktakesstk_status, Stk_stocktakesstk_type } from "../../generated/models/Stk_stocktakesModel";
import { Stk_xbsimportsstk_status } from "../../generated/models/Stk_xbsimportsModel";
import { Stk_stacksstk_status } from "../../generated/models/Stk_stacksModel";
import { Stk_countlinesstk_category, Stk_countlinesstk_reason } from "../../generated/models/Stk_countlinesModel";
import { Stk_xbslinesstk_stocktype } from "../../generated/models/Stk_xbslinesModel";
import { Stk_basketmapsstk_primarybasket } from "../../generated/models/Stk_basketmapsModel";
import { Stk_signoffsstk_action, Stk_signoffsstk_gate } from "../../generated/models/Stk_signoffsModel";
import { Stk_mappingchangesstk_state, Stk_mappingchangesstk_target } from "../../generated/models/Stk_mappingchangesModel";
import { Stk_recountsstk_status } from "../../generated/models/Stk_recountsModel";
import { Stk_variancesstk_cause, Stk_variancesstk_state, Stk_variancesstk_suggestedcause } from "../../generated/models/Stk_variancesModel";
import {
  Stk_exceptionsstk_department,
  Stk_exceptionsstk_escalationlevel,
  Stk_exceptionsstk_kind,
  Stk_exceptionsstk_priority,
  Stk_exceptionsstk_source,
  Stk_exceptionsstk_status,
} from "../../generated/models/Stk_exceptionsModel";
import { draftVariances } from "../variance-rules";
import type {
  AuditEntry,
  BasketMap,
  Counter,
  CountRow,
  CountSheet,
  AllocationChange,
  CounterProfile,
  Dept,
  DirectPurchase,
  Exception,
  StackInfo,
  ImportStatus,
  MappingChange,
  PrimaryBasket,
  Priority,
  Issue,
  ReconItem,
  ThreadComment,
  RootCause,
  SheetStatus,
  Site,
  SiteCode,
  StockTake,
  StockTakeStatus,
  StockTakeType,
  UserRow,
  Variance,
  XbsImport,
  XbsLine,
} from "../types";
import type { AssistantAnswer, ContractJournal, DataSource, MgmtData, Signature, Signer, Today, XbsUploadToSave } from "./types";
import { assignmentFor, type Plan } from "../allocate";
import { AUTO_DEFAULTS, priorityFor } from "../auto-decide";
import { hasLayout, sectionList, sectionRows, sectionsWords } from "../../shared/sections";
import {
  L1_PDF_SUBJECT,
  addWorkingDays,
  addEvidence,
  autoDecide,
  closeCountIfDone,
  departmentHeads,
  isDuplicateKey,
  level1Runner,
  level1Facts,
  level1Settings,
  openRecountsOf,
  readAllocation,
  syncVariances,
  xbsLineOf,
  XBS_SELECT,
  type XbsRow,
  type Level1Ctx,
  type Level1Db,
  type LineRow,
  type RecountRow,
  type StackRow,
} from "../level1";
import { GATES, SITES, chainFor, openGates, type Gate } from "../repository";
import { kpiTargets, type GovernanceData, type KpiRecord } from "../governance";
import type { Kpi } from "../kpi";
import { Stk_enginerunsService } from "../../generated/services/Stk_enginerunsService";
import { Stk_contractinvoicesService } from "../../generated/services/Stk_contractinvoicesService";
import { Stk_contractinvoicesstk_side } from "../../generated/models/Stk_contractinvoicesModel";
import { newContractLines, type ContractLine, type ContractUpload } from "../contracts-parse";
import { Stk_shipmentsService } from "../../generated/services/Stk_shipmentsService";
import { Stk_xbsstuffingsService } from "../../generated/services/Stk_xbsstuffingsService";
import { Stk_transferlinesService } from "../../generated/services/Stk_transferlinesService";
import { Stk_weighticketsService } from "../../generated/services/Stk_weighticketsService";
import type { TransferUpload } from "../transfers-parse";
import { planRecountAnswers, type RecountPlan, type RecountSheetRow } from "../recount-import";
import type { ShipmentLine, ShipmentUpload } from "../shipments-parse";
import type { XbsStuffing, XbsStuffingUpload } from "../xbs-shipped-parse";
import { choiceOfType, parseScope, scopeJson, typeFromChoice } from "../scope";
import { Stk_directlotsService } from "../../generated/services/Stk_directlotsService";
import type { DirectLot, DirectUpload } from "../direct-parse";
import { IBKYF11_HubaskstheStockAssistantService } from "../../generated/services/IBKYF11_HubaskstheStockAssistantService";
import { Stk_kpisnapshotsService } from "../../generated/services/Stk_kpisnapshotsService";
import { Stk_kpisnapshotsstk_status } from "../../generated/models/Stk_kpisnapshotsModel";

/* ---------- helpers ---------- */

type Choice = Record<number, string>;
const label = (map: Choice, value?: number | null) => (value == null ? undefined : map[value]);
/** Choice label → option value (throws on a label Dataverse doesn't know). */
function code<T extends Choice>(map: T, text: string): keyof T & number {
  const hit = Object.entries(map).find(([, v]) => v === text);
  if (!hit) throw new Error(`"${text}" isn't an allowed value`);
  return Number(hit[0]) as keyof T & number;
}
const bind = (set: string, id: string) => `/${set}(${id})`;

/**
 * Owner-type lookups have been seen to drop silently when sent with other fields.
 * Read the lookup back; if it didn't take, send it on its own once, then fail loudly.
 */
async function ensureLookup(
  what: string,
  read: () => Promise<{ success: boolean; data?: unknown }>,
  column: string,
  want: string | null,
  resend: () => Promise<unknown>,
) {
  const now = async () => {
    const r = await read();
    return r.success ? (((r.data as Record<string, unknown>)?.[column] as string | null | undefined) ?? null) : undefined;
  };
  const same = (v: string | null | undefined) => (v ?? null)?.toLowerCase() === want?.toLowerCase() || (v == null && want == null);
  if (same(await now())) return;
  await resend();
  if (!same(await now())) throw new Error(`${what} didn't save. Try again; if it keeps happening, tell the app team.`);
}

/** Ids resolved at load and reused by actions. */
const ids = {
  me: "",
  stockTakeId: "",
  sheet: new Map<string, string>(), // name → id
  sheetStacks: new Map<string, string[]>(), // sheet id → stack ids
  variance: new Map<string, { id: string; stackId?: string; outturn: string; batch: string; counterId?: string; lineId?: string; siteId?: string }>(),
  line: new Map<string, { stackId?: string; outturn: string; batch: string; counterId?: string }>(), // count line id -> what a recount needs
  exception: new Map<string, string>(), // EX-### → id
  issue: new Map<string, string>(), // C-### → id
  change: new Map<string, { id: string; by?: string }>(), // MC-### → id + requester
  basket: new Map<string, string>(), // basket code → stk_basketmap id
  outturnMap: new Map<string, string>(), // outturn → stk_outturnmap id
  site: new Map<SiteCode, string>(),
  importId: new Map<string, string>(), // IMP-… → id
  stockTake: new Map<string, string>(), // stock take name (and app id) → id
  enforceSoD: true,
  /** Stock take type of the active stock take, for its sign-off chain. */
  stockTakeType: undefined as StockTakeType | undefined,
  /** Gates already signed on the active stock take, by whom (user id): one person signs one gate. */
  signedBy: new Map<Gate, string>(),
  signers: {} as Partial<Record<Gate, Signer>>,
  person: new Map<string, string>(), // display name → systemuserid
  slaDays: 5,
  highDays: 2,
  lowDays: 10,
  highBags: AUTO_DEFAULTS.highBags,
  lowBags: AUTO_DEFAULTS.lowBags,
};

function unwrap<T>(r: IOperationResult<T>, what: string): T {
  if (!r.success) throw new Error(`Couldn't ${what}: ${r.error?.message ?? "unknown error"}`);
  return r.data;
}

async function all<T>(getAll: (o: IGetAllOptions) => Promise<IOperationResult<T[]>>, opts: IGetAllOptions, what: string): Promise<T[]> {
  const out: T[] = [];
  let skipToken: string | undefined;
  do {
    const r = await getAll({ ...opts, maxPageSize: 500, skipToken });
    out.push(...unwrap(r, what));
    skipToken = r.skipToken;
  } while (skipToken);
  return out;
}

/**
 * Level 1 (level1.ts) reaches Dataverse through this: the Hub's generated services by entity set.
 * The server engine passes the Web API instead, so both run the same code.
 */
const LEVEL1_SERVICES: Record<string, { getAll: (o?: IGetAllOptions) => Promise<IOperationResult<unknown[]>>; create: (r: never) => Promise<IOperationResult<unknown>>; update: (id: string, r: never) => Promise<IOperationResult<unknown>> }> = {
  stk_variances: Stk_variancesService,
  stk_recounts: Stk_recountsService,
  stk_exceptions: Stk_exceptionsService,
  stk_stocktakes: Stk_stocktakesService,
  stk_counterprofiles: Stk_counterprofilesService,
  stk_allocationruns: Stk_allocationrunsService,
  stk_engineruns: Stk_enginerunsService,
  annotations: AnnotationsService,
  // Evidence on weight losses (addEvidence): the XBS transfer and ticket reports, and the comment it adds.
  stk_transferlines: Stk_transferlinesService,
  stk_weightickets: Stk_weighticketsService,
  stk_comments: Stk_commentsService,
};
const hubDb: Level1Db = {
  async list<T>(set: string, q: { select: string[]; filter?: string; orderBy?: string[]; top?: number }) {
    if (q.top) return unwrap(await LEVEL1_SERVICES[set].getAll({ select: q.select, filter: q.filter, orderBy: q.orderBy, top: q.top } as never), `read ${set}`) as T[];
    return (await all((o) => LEVEL1_SERVICES[set].getAll(o), { select: q.select, filter: q.filter, orderBy: q.orderBy } as never, `read ${set}`)) as T[];
  },
  async create(set: string, body: Record<string, unknown>) {
    const r = await LEVEL1_SERVICES[set].create(body as never);
    if (!r.success) throw Object.assign(new Error(r.error?.message ?? `couldn't create in ${set}`), { code: (r.error as { code?: string } | undefined)?.code });
  },
  async update(set: string, id: string, body: Record<string, unknown>) {
    unwrap(await LEVEL1_SERVICES[set].update(id, body as never), `update ${set}`);
  },
};

const orFilter = (field: string, ids: string[]) => (ids.length ? ids.map((id) => `${field} eq ${id}`).join(" or ") : `${field} eq null`);
const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso?: string) => (iso ? `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}` : "");
const day = (iso?: string | Date, withYear = true) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }) : "";
const stamp = (iso?: string) => (iso ? `${day(iso, false)}, ${hhmm(iso)}` : "");

/** Working days (Mon–Fri) after `from` up to and including `to`. */
function workingDaysBetween(from: Date, to: Date) {
  let n = 0;
  const d = new Date(from);
  while (d < to) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}

async function names(ids: (string | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  const map = new Map<string, string>();
  for (const chunk of chunks(want, 20)) {
    const users = await all((o) => SystemusersService.getAll(o), { select: ["systemuserid", "fullname", "internalemailaddress"], filter: orFilter("systemuserid", chunk) }, "read user names");
    for (const u of users) map.set(u.systemuserid, u.fullname ?? "Someone");
  }
  return map;
}

const SHEET_STATUS: Record<string, SheetStatus> = { "In progress": "In progress", Submitted: "Submitted", Approved: "Approved", "Sent back": "Rejected" };
const IMPORT_STATUS: Record<string, ImportStatus> = { Validating: "Validated", Imported: "Imported", Failed: "Failed", Superseded: "Superseded" };

/**
 * The signed-in user's Dataverse id. The Power Apps web player passes it
 * directly; the mobile player may pass only the Entra object id or the
 * sign-in name, so look the user up by those.
 */
async function signedInUser(): Promise<{ id: string; fullName?: string }> {
  const { user } = await getContext();
  if (user.systemUserId) return { id: user.systemUserId, fullName: user.fullName };
  const esc = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const tries = [
    user.objectId && `azureactivedirectoryobjectid eq ${user.objectId}`,
    user.userPrincipalName && `domainname eq ${esc(user.userPrincipalName)}`,
    user.userPrincipalName && `internalemailaddress eq ${esc(user.userPrincipalName)}`,
  ].filter(Boolean) as string[];
  for (const filter of tries) {
    const r = await SystemusersService.getAll({ select: ["systemuserid", "fullname"], filter: `${filter} and isdisabled eq false`, top: 1 });
    const u = r.success ? r.data?.[0] : undefined;
    if (u) return { id: u.systemuserid, fullName: u.fullname ?? user.fullName };
  }
  throw new Error(
    user.userPrincipalName || user.objectId
      ? `${user.userPrincipalName ?? "Your account"} isn't a user in this Dataverse environment yet. Ask IT to add you and give you a stock take role.`
      : "Power Apps didn't say who's signed in. Open the app from Power Apps (Local Play or the published app).",
  );
}

/* ---------- load ---------- */

/** Stands in for the stock take id in set-up mode: matches no rows. */
const NO_STOCK_TAKE = "00000000-0000-0000-0000-000000000000";

/** A stock take other than the current one being looked at (by name), read-only; undefined = the current one. */
let viewName: string | undefined;
function viewStockTake(name?: string) {
  viewName = name;
}

async function load(): Promise<MgmtData> {
  ids.me = (await signedInUser()).id;

  const [stockTakeRows, siteRows, packRows, settingRows, importRows] = await Promise.all([
    all((o) => Stk_stocktakesService.getAll(o), { select: ["stk_stocktakeid", "stk_name", "stk_type", "stk_status", "stk_countdate", "_stk_import_value", "_createdby_value", "_stk_preparedby_value", "stk_countclosedon", "stk_l1summary", "stk_scope"] as never, orderBy: ["stk_countdate desc"] }, "read stock takes"),
    all((o) => Stk_sitesService.getAll(o), { select: ["stk_siteid", "stk_code", "stk_name", "stk_shortname", "stk_isthirdparty", "stk_manualentry"], orderBy: ["stk_isthirdparty asc", "stk_name asc"] }, "read warehouses"),
    all((o) => Stk_packtypesService.getAll(o), { select: ["stk_code", "stk_name", "stk_kgperbag", "stk_gradepattern"] }, "read packing types"),
    all((o) => Stk_settingsService.getAll(o), { select: ["stk_name", "stk_value"] }, "read settings"),
    all((o) => Stk_xbsimportsService.getAll(o), { select: ["stk_xbsimportid", "stk_name", "stk_snapshotat", "stk_filenames", "stk_rowcount", "stk_status", "stk_failcount", "stk_warningcount", "_stk_importedby_value", "createdon"], orderBy: ["createdon desc"] }, "read XBS imports"),
  ]);
  // No stock take yet (a fresh environment): open in set-up mode. A placeholder id makes every
  // stock-take query return nothing; the pre-count checks read the latest usable import.
  const setup = !stockTakeRows.length;
  const latestImport = importRows.find((r) => ["Imported", "Validating"].includes(label(Stk_xbsimportsstk_status, r.stk_status) ?? ""));
  const currentRow =
    stockTakeRows.find((r) => label(Stk_stocktakesstk_status, r.stk_status) !== "Completed") ??
    stockTakeRows[0] ??
    ({ stk_stocktakeid: NO_STOCK_TAKE, stk_name: "", _stk_import_value: latestImport?.stk_xbsimportid ?? NO_STOCK_TAKE } as (typeof stockTakeRows)[number]);
  // A past stock take chosen to look at: everything below reads it instead, and nothing is written.
  const viewed = viewName ? stockTakeRows.find((r) => r.stk_name === viewName) : undefined;
  const active = viewed ?? currentRow;
  viewing = !!viewed && viewed.stk_stocktakeid !== currentRow.stk_stocktakeid;
  ids.stockTakeId = active.stk_stocktakeid;
  ids.stockTakeType = active.stk_type == null ? undefined : typeFromChoice(label(Stk_stocktakesstk_type, active.stk_type));
  for (const r of stockTakeRows) ids.stockTake.set(r.stk_name, r.stk_stocktakeid);
  for (const r of importRows) ids.importId.set(r.stk_name, r.stk_xbsimportid);

  const siteCode = new Map<string, SiteCode>(siteRows.map((r) => [r.stk_siteid, r.stk_code as SiteCode]));
  const sites: Site[] = siteRows.map((r) => ({
    code: r.stk_code as SiteCode,
    name: r.stk_name,
    short: r.stk_shortname ?? r.stk_name,
    thirdParty: !!r.stk_isthirdparty,
    manualEntry: !!r.stk_manualentry,
  }));
  const setting = (k: string, d: number) => Number(settingRows.find((x) => x.stk_name === k)?.stk_value ?? d);
  ids.slaDays = setting("ExceptionSlaWorkingDays", 5);
  ids.highDays = setting("ExceptionHighDays", 2);
  ids.lowDays = setting("ExceptionLowDays", 10);
  ids.highBags = setting("ExceptionHighBags", AUTO_DEFAULTS.highBags);
  ids.lowBags = setting("ExceptionLowBags", AUTO_DEFAULTS.lowBags);
  ids.enforceSoD = (settingRows.find((x) => x.stk_name === "EnforceSeparationOfDuties")?.stk_value ?? "true").toLowerCase() !== "false";
  // SignOffSigners (JSON): gate -> { name, email?, standIn?: { name, email? } }. Gates left out keep GATES' person.
  ids.signers = parseSigners(settingRows.find((x) => x.stk_name === "SignOffSigners")?.stk_value);
  for (const r of siteRows) ids.site.set(r.stk_code as SiteCode, r.stk_siteid);
  const siteIdOf = new Map<SiteCode, string>(siteRows.map((r) => [r.stk_code as SiteCode, r.stk_siteid]));

  // XBS lines of the active stock take's import.
  const xbs = await all(
    (o) => Stk_xbslinesService.getAll(o),
    { select: XBS_SELECT as never, filter: `_stk_import_value eq ${active._stk_import_value}`, orderBy: ["stk_rownumber asc"] },
    "read the XBS stock",
  );
  const lines: XbsLine[] = xbs.map((r) => xbsLineOf(r as unknown as XbsRow, siteCode));

  // Count work on the active stock take.
  // The Comtras (BRIC) position loaded for this stock take, if any.
  const comtrasRows = await all(
    (o) => Stk_comtraspositionsService.getAll(o),
    {
      select: ["stk_name", "stk_basketcode", "stk_bags", "stk_kg", "stk_linetype", "stk_contract", "stk_origin", "stk_counterparty", "stk_source", "createdon", "_createdby_value"] as never,
      filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`,
    },
    "read the Comtras position",
  );
  // The Comtras 537 contract invoicing journal loaded for this stock take, if any.
  const contractRows = (await all(
    (o) => Stk_contractinvoicesService.getAll(o),
    { select: CONTRACT_SELECT as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["stk_rownumber asc"] },
    "read the contract journal",
  ).catch((e: unknown) => {
    console.warn("Contract journal not read:", e);
    return [];
  })) as unknown as ContractRow[];
  // The shipment tracker loaded for this stock take, if any.
  const shipmentRows = (await all(
    (o) => Stk_shipmentsService.getAll(o),
    { select: SHIPMENT_SELECT as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["stk_rownumber asc"] },
    "read the shipment tracker",
  ).catch((e: unknown) => {
    console.warn("Shipment tracker not read:", e);
    return [];
  })) as unknown as ShipmentRow[];
  // XBS stuffing dates (shipped reports) loaded for this stock take, if any.
  // XBS stock transfer and weighbridge ticket reports loaded for this stock take (which files, how many rows).
  const reportOf = async (kind: "transfers" | "tickets") =>
    ((await all(
      (o) => transferService(kind).getAll(o),
      { select: ["stk_source", "stk_reportedat"] as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` },
      `read the XBS ${kind === "transfers" ? "stock transfer" : "ticket"} reports`,
    ).catch((e: unknown) => {
      console.warn("XBS transfer / ticket reports not read:", e);
      return [];
    })) as unknown as { stk_source?: string; stk_reportedat?: string }[]).map((r) => ({ kind, file: r.stk_source ?? "", reportedAt: r.stk_reportedat }));
  const transferRows = [...(await reportOf("transfers")), ...(await reportOf("tickets"))];
  const stuffingRows = (await all(
    (o) => Stk_xbsstuffingsService.getAll(o),
    { select: STUFFING_SELECT as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` },
    "read the XBS stuffing dates",
  ).catch((e: unknown) => {
    console.warn("XBS stuffing dates not read:", e);
    return [];
  })) as unknown as StuffingRow[];
  // The warehouse's sub-product registers loaded for this stock take, if any.
  const subRows = (await all(
    (o) => Stk_subproductsService.getAll(o),
    { select: SUB_SELECT as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["stk_rownumber asc"] },
    "read the sub-product registers",
  ).catch((e: unknown) => {
    console.warn("Sub-product registers not read:", e);
    return [];
  })) as unknown as SubRow[];
  // Trading's direct purchase lots loaded for this stock take, if any.
  const directRows = (await all(
    (o) => Stk_directlotsService.getAll(o),
    { select: DIRECT_SELECT as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["stk_rownumber asc"] },
    "read the direct purchase lots",
  ).catch((e: unknown) => {
    console.warn("Direct purchase lots not read:", e);
    return [];
  })) as unknown as DirectRow[];
  const reconRows = await all(
    (o) => Stk_reconitemsService.getAll(o),
    { select: ["stk_reconitemid", "stk_name", "stk_kind", "stk_bags", "stk_inxbs", "stk_note", "createdon", "_createdby_value"] as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["createdon asc"] },
    "read the reconciling items",
  );
  // Comment threads; an environment without the table yet (before dv:schema) just has none.
  const commentRows = (await all(
    (o) => Stk_commentsService.getAll(o),
    { select: ["stk_commentid", "stk_text", "stk_department", "_stk_exception_value", "_stk_variance_value", "createdon", "_createdby_value"] as never, orderBy: ["createdon asc"] },
    "read the comments",
  ).catch((e: unknown) => {
    console.warn("Comments not read:", e);
    return [];
  })) as unknown as CommentRow[];
  const [sheetRows, assignmentRows, stackRows, recountRows] = await Promise.all([
    all((o) => Stk_countsheetsService.getAll(o), { select: ["stk_countsheetid", "stk_name", "stk_status", "stk_submittedon", "stk_countercomment", "stk_decisioncomment", "stk_linecount", "stk_variancecount", "stk_bags", "_stk_site_value", "_stk_assignment_value", "_stk_stocktake_value", "_createdby_value"] }, "read count sheets"),
    all((o) => Stk_assignmentsService.getAll(o), { select: ["stk_assignmentid", "stk_rows", "stk_sections", "_stk_site_value", "_stk_counter_value", "_stk_stocktake_value"] as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid} and statecode eq 0` }, "read assignments"),
    all(
      (o) => Stk_stacksService.getAll(o),
      {
        select: ["stk_stackid", "stk_name", "_stk_site_value", "stk_status", "_stk_countsheet_value", "stk_nothinghere", "stk_sitefinished", "stk_notcounted", "stk_comment", "stk_submittedon", "_stk_submittedby_value"] as never,
        filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`,
      },
      "read stacks",
    ),
    all((o) => Stk_recountsService.getAll(o), { select: ["stk_recountid", "stk_name", "stk_batch", "stk_status", "_stk_stack_value", "_ownerid_value"] as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` }, "read recounts"),
  ]);
  const activeSheets = sheetRows.filter((r) => r._stk_stocktake_value === active.stk_stocktakeid);
  const countRows = (
    await Promise.all(
      chunks(activeSheets.map((x) => x.stk_countsheetid), 15).map((sheetIds) =>
        all(
          (o) => Stk_countlinesService.getAll(o),
          {
            select: [
              "stk_countlineid", "stk_outturn", "stk_batch", "stk_grade", "_stk_stack_value", "_stk_site_value", "stk_bags", "stk_pocketbags", "stk_units", "stk_kg",
              "stk_reason", "stk_isfound", "stk_isother", "stk_countedon", "_createdby_value", "_stk_countsheet_value",
              "stk_pocketkg", "stk_category", "_stk_recount_value",
            ] as never,
            filter: orFilter("_stk_countsheet_value", sheetIds),
          },
          "read counts",
        ),
      ),
    )
  ).flat();

  const peopleRows = await all(
    (o) => SystemusersService.getAll(o),
    { select: ["systemuserid", "fullname", "internalemailaddress", "domainname"], filter: "isdisabled eq false and accessmode eq 0", orderBy: ["fullname asc"], top: 200 },
    "read people",
  );
  // Names starting with "#" are system or application accounts, not people.
  for (const u of peopleRows) if (u.fullname && !u.fullname.startsWith("#")) ids.person.set(u.fullname, u.systemuserid);

  const [issueRows, dpRows] = await Promise.all([
    all((o) => Stk_issuesService.getAll(o), { select: ["stk_issueid", "stk_name", "stk_category", "_stk_site_value", "stk_screen", "stk_description", "stk_status", "stk_resolution", "stk_linkedcause", "_stk_assignedto_value", "_createdby_value", "createdon"], orderBy: ["createdon desc"] }, "read problem reports"),
    all((o) => Stk_directpurchasesService.getAll(o), { select: ["stk_name", "stk_supplier", "stk_suppliertype", "stk_outturn", "stk_warrant", "stk_grade", "stk_bagscontracted", "stk_bagsinvoiced", "stk_bagsdelivered", "stk_invoicedate"] }, "read direct purchases"),
  ]);

  const who = await names([
    ...stockTakeRows.map((r) => r._createdby_value),
    ...importRows.map((r) => r._stk_importedby_value),
    ...sheetRows.map((r) => r._createdby_value),
    ...assignmentRows.map((r) => r._stk_counter_value),
    ...countRows.map((r) => r._createdby_value),
    ...reconRows.map((r) => (r as { _createdby_value?: string })._createdby_value),
    ...commentRows.map((r) => r._createdby_value),
    ...(stackRows as unknown as { _stk_submittedby_value?: string }[]).map((r) => r._stk_submittedby_value),
    ...issueRows.flatMap((r) => [r._createdby_value, r._stk_assignedto_value]),
  ]);
  const nm = (id?: string) => (id ? (who.get(id) ?? "Someone") : "");

  /* variances: generate from submitted stacks, then read back */
  for (const r of activeSheets) ids.sheet.set(r.stk_name, r.stk_countsheetid);
  for (const st of stackRows) {
    const sheetId = activeSheets.find((x) => countRows.some((c) => c._stk_countsheet_value === x.stk_countsheetid && c._stk_stack_value === st.stk_stackid))?.stk_countsheetid;
    if (sheetId) ids.sheetStacks.set(sheetId, [...(ids.sheetStacks.get(sheetId) ?? []), st.stk_stackid]);
  }
  // Level 1 (level1.ts, shared with the server engine): variances from the count, then the automatic decisions.
  const { stackOf, submittedStacks, facts, emptySites } = level1Facts({
    stackRows: stackRows as unknown as StackRow[],
    countRows: countRows as unknown as LineRow[],
    recountRows: recountRows as unknown as RecountRow[],
    siteCode,
    nm,
  });
  const thirdParty = new Set(sites.filter((x) => x.thirdParty).map((x) => x.code));
  const siteShort = (c: SiteCode) => sites.find((x) => x.code === c)?.short ?? c;
  const l1 = level1Settings(settingRows);
  const ctx: Level1Ctx = { stockTakeId: ids.stockTakeId, dueDays: l1.dueDays, owners: departmentHeads(settingRows, peopleRows) };
  const submittedBy = new Map((stackRows as unknown as StackRow[]).map((r) => [r.stk_stackid, r._stk_submittedby_value]));
  // With Level1Runs = Engine the server engine writes Level 1 and the Hub only reads (unless the engine is silent).
  // Looking at a past stock take: Level 1 is read, never run.
  const runner = viewing
    ? { runs: l1.runs, hubRuns: false, lastRun: undefined }
    : await level1Runner(hubDb, l1.runs).catch(() => ({ runs: l1.runs, hubRuns: true, lastRun: undefined }));
  const drafts = draftVariances(facts, lines, submittedStacks, thirdParty, siteShort, emptySites);
  if (runner.hubRuns) await syncVariances(hubDb, ctx, drafts, stackRows as unknown as StackRow[], countRows as unknown as LineRow[], siteIdOf, thirdParty);

  const allocation = await readAllocation(hubDb, active.stk_stocktakeid, settingRows, peopleRows, new Map([...ids.site.entries()].map(([c, id]) => [id, c])));
  allocation.openRecounts = openRecountsOf(recountRows as unknown as RecountRow[]);

  // A failure here (say, a role without rights to decide variances) must not stop the Hub loading.
  if (runner.hubRuns)
    await autoDecide(hubDb, ctx, facts, countRows as unknown as LineRow[], thirdParty, siteCode, siteShort, l1.auto, allocation).catch((e: unknown) =>
      console.warn("Automatic variance decisions skipped:", e),
    );
  // Evidence on weight-loss exceptions from the XBS transfer and ticket reports, when loaded.
  if (runner.hubRuns) await addEvidence(hubDb, ctx, sites).catch((e: unknown) => console.warn("Evidence on weight losses skipped:", e));

  const [varianceRows, exceptionRows] = await Promise.all([
    all(
      (o) => Stk_variancesService.getAll(o),
      {
        select: ["stk_varianceid", "stk_name", "_stk_site_value", "_stk_stack_value", "stk_outturn", "stk_grade", "stk_expectedunits", "stk_countedunits", "stk_expectedkg", "stk_countedkg", "stk_suggestedcause", "stk_suggestionwhy", "stk_cause", "stk_state", "_stk_countline_value", "stk_lotkey", "createdon", "stk_decidedon", "_stk_decidedby_value"] as never,
        filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`,
        orderBy: ["stk_name asc"],
      },
      "read variances",
    ),
    all(
      (o) => Stk_exceptionsService.getAll(o),
      { select: ["stk_exceptionid", "stk_name", "stk_kind", "stk_source", "stk_reference", "stk_department", "stk_bags", "stk_duedate", "stk_status", "stk_escalationlevel", "stk_priority", "stk_resolution", "stk_closedon", "_stk_stocktake_value", "createdon", "_ownerid_value"] as never, orderBy: ["createdon desc"] },
      "read exceptions",
    ),
  ]);
  const lineOf = new Map(countRows.map((c) => [c.stk_countlineid, c]));
  /* photos: which count lines and problem reports carry one (ids only; bytes on demand) */
  const photoRows = await all(
    (o) => AnnotationsService.getAll(o),
    { select: ["annotationid", "_objectid_value"], filter: "isdocument eq true and (subject eq 'Photo of the tag' or subject eq 'Photo of the problem')" },
    "read photos",
  );
  const photoOf = new Map(photoRows.map((p) => [p._objectid_value, p.annotationid]));

  const variances: Variance[] = varianceRows.map((v) => {
    const line = lineOf.get(v._stk_countline_value!);
    const where = stackOf.get(v._stk_stack_value!);
    const site = siteCode.get(v._stk_site_value!) ?? "IBR";
    ids.variance.set(v.stk_name, {
      id: v.stk_varianceid,
      stackId: v._stk_stack_value,
      outturn: v.stk_outturn ?? "",
      batch: line?.stk_batch ?? (v as { stk_lotkey?: string }).stk_lotkey?.split("|").pop() ?? "",
      counterId: line?._createdby_value ?? submittedBy.get(v._stk_stack_value!),
      lineId: v._stk_countline_value,
      siteId: v._stk_site_value,
    });
    const state = label(Stk_variancesstk_state, v.stk_state) ?? "Open";
    return {
      id: v.stk_name,
      photo: photoOf.get(v._stk_countline_value),
      site,
      counterId: line?._createdby_value ?? submittedBy.get(v._stk_stack_value!),
      zone: thirdParty.has(site) ? `${sites.find((x) => x.code === site)?.short} · ${where?.name ?? ""}` : (where?.name ?? ""),
      outturn: v.stk_outturn ?? "",
      grade: v.stk_grade ?? "",
      batch: (v as { stk_lotkey?: string }).stk_lotkey?.split("|").pop() || undefined,
      expected: v.stk_expectedunits ?? 0,
      counted: v.stk_countedunits ?? 0,
      expectedKg: v.stk_expectedkg ?? undefined,
      countedKg: v.stk_countedkg ?? undefined,
      cause: (label(Stk_variancesstk_cause, v.stk_cause) ?? label(Stk_variancesstk_suggestedcause, v.stk_suggestedcause) ?? "Not yet known") as RootCause,
      why: v.stk_suggestionwhy ?? "",
      counter: line ? nm(line._createdby_value) : nm(submittedBy.get(v._stk_stack_value!)) || "—",
      at: line?.stk_countedon ? stamp(line.stk_countedon) : stamp(v.createdon),
      state: ({ Open: "open", "Recount sent": "recount", Accepted: "accepted", "Exception raised": "exception" } as const)[state as "Open"] ?? "open",
      ageHours: v.createdon ? Math.round((Date.now() - new Date(v.createdon).getTime()) / 36e5) : 0,
      createdOn: v.createdon ?? undefined,
      decidedOn: (v as { stk_decidedon?: string }).stk_decidedon ?? undefined,
      // The Level 1 rules decide with no "decided by"; a person's decision always records them.
      auto: state !== "Open" && state !== "Recount sent" && !(v as { _stk_decidedby_value?: string })._stk_decidedby_value,
    };
  });
  const who2 = await names((exceptionRows as unknown as { _ownerid_value?: string }[]).map((e) => e._ownerid_value));
  const exceptions: Exception[] = exceptionRows.map((e) => {
    const owner = (e as unknown as { _ownerid_value?: string })._ownerid_value;
    const due = e.stk_duedate ? new Date(e.stk_duedate) : new Date();
    const today0 = new Date();
    ids.exception.set(e.stk_name.split(" — ")[0], e.stk_exceptionid);
    const dueDays = due >= today0 ? workingDaysBetween(today0, due) : -workingDaysBetween(due, today0);
    return {
      id: e.stk_name.split(" — ")[0],
      title: e.stk_name.split(" — ").slice(1).join(" — ") || e.stk_name,
      kind: label(Stk_exceptionsstk_kind, e.stk_kind) ?? "Not yet known",
      ref: e.stk_reference ?? "",
      dept: (label(Stk_exceptionsstk_department, e.stk_department) ?? "Operations") as Dept,
      owner: who2.get(owner ?? "") ?? nm(owner),
      raised: day(e.createdon, false),
      dueDays,
      ageDays: e.createdon ? workingDaysBetween(new Date(e.createdon), today0) : 0,
      status: (label(Stk_exceptionsstk_status, e.stk_status) ?? "Open") as Exception["status"],
      escalation: Math.max(0, Object.keys(Stk_exceptionsstk_escalationlevel).map(Number).indexOf(e.stk_escalationlevel ?? -1)),
      bags: e.stk_bags ?? 0,
      source: (label(Stk_exceptionsstk_source, e.stk_source) ?? "Count") as Exception["source"],
      resolution: e.stk_resolution ?? undefined,
      // Older exceptions have none: by size, and import checks are Medium.
      priority: (label(Stk_exceptionsstk_priority, (e as { stk_priority?: number }).stk_priority) as Priority | undefined) ??
        (label(Stk_exceptionsstk_source, e.stk_source) === "Import" ? "Medium" : priorityFor(e.stk_bags ?? 0, ids)),
      raisedOn: e.createdon ?? undefined,
      closedOn: (e as { stk_closedon?: string }).stk_closedon ?? undefined,
      stockTake: stockTakeRows.find((r) => r.stk_stocktakeid === (e as { _stk_stocktake_value?: string })._stk_stocktake_value)?.stk_name,
    };
  });

  /* stock takes */
  const importName = new Map(importRows.map((r) => [r.stk_xbsimportid, r.stk_name]));
  const stockTakes: StockTake[] = stockTakeRows.map((r) => {
    const sh = sheetRows.filter((x) => x._stk_stocktake_value === r.stk_stocktakeid).map((x) => label(Stk_countsheetsstk_status, x.stk_status));
    return {
      id: r.stk_name,
      title: r.stk_name,
      type: typeFromChoice(label(Stk_stocktakesstk_type, r.stk_type)),
      status: (label(Stk_stocktakesstk_status, r.stk_status) ?? "Count in progress") as StockTakeStatus,
      countDate: day(r.stk_countdate),
      importId: importName.get(r._stk_import_value!) ?? "",
      sites: parseScope((r as { stk_scope?: string }).stk_scope)?.sites ?? sites.map((x) => x.code),
      scope: parseScope((r as { stk_scope?: string }).stk_scope),
      createdBy: nm(r._createdby_value),
      sheets: {
        total: sh.length,
        approved: sh.filter((x) => x === "Approved").length,
        pending: sh.filter((x) => x === "Submitted").length,
        rejected: sh.filter((x) => x === "Sent back").length,
      },
    };
  });

  /* count sheets */
  const assignment = new Map(assignmentRows.map((r) => [r.stk_assignmentid, r]));
  const areaOf = (a?: { stk_rows?: string; _stk_site_value?: string }) => {
    const rows = (a?.stk_rows ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return rows.length ? `Rows ${rows.join("–")}` : "Whole site";
  };
  // Variances still waiting for a decision, by the sheet whose stacks or lines they are on.
  // (The phone can't count them - counting is blind - so the sheet's stored total isn't used.)
  const undecided = new Set([code(Stk_variancesstk_state, "Open"), code(Stk_variancesstk_state, "Recount sent")]);
  const sheets: CountSheet[] = activeSheets.map((r) => {
    const mine = countRows.filter((c) => c._stk_countsheet_value === r.stk_countsheetid);
    const lineIds = new Set(mine.map((c) => c.stk_countlineid));
    const stackIds = new Set([
      ...stackRows.filter((st) => st._stk_countsheet_value === r.stk_countsheetid).map((st) => st.stk_stackid),
      ...(ids.sheetStacks.get(r.stk_countsheetid) ?? []),
    ]);
    const open = varianceRows.filter(
      (v) => undecided.has(v.stk_state!) && ((v._stk_countline_value && lineIds.has(v._stk_countline_value)) || (v._stk_stack_value && stackIds.has(v._stk_stack_value))),
    ).length;
    return {
      id: r.stk_name,
      counter: nm(r._createdby_value),
      site: siteCode.get(r._stk_site_value!) ?? "IBR",
      area: areaOf(assignment.get(r._stk_assignment_value!)),
      status: SHEET_STATUS[label(Stk_countsheetsstk_status, r.stk_status) ?? "In progress"] ?? "In progress",
      lots: r.stk_linecount ?? mine.length,
      variances: open,
      bags: r.stk_bags ?? mine.reduce((a, c) => a + (c.stk_bags ?? 0), 0),
      submittedAt: r.stk_submittedon ? stamp(r.stk_submittedon) : undefined,
      comment: r.stk_decisioncomment ?? r.stk_countercomment ?? undefined,
    };
  });

  /* count day: counters, bags per hour, bags per site */
  const recountsByOwner = new Map<string, number>();
  for (const r of recountRows as unknown as { _ownerid_value?: string }[]) if (r._ownerid_value) recountsByOwner.set(r._ownerid_value, (recountsByOwner.get(r._ownerid_value) ?? 0) + 1);
  // Lines a later blind recount replaced don't count towards anyone's bags (same lot rule as
  // variance-rules.ts: one stack at Ibero, the whole site at a third party).
  const lotOf = (c: (typeof countRows)[number]) => {
    const code = siteCode.get(c._stk_site_value!) ?? "IBR";
    return `${code}|${thirdParty.has(code) ? "" : (c._stk_stack_value ?? "")}|${c.stk_batch ?? ""}`;
  };
  const latestRecount = new Map<string, { id: string; at: string }>();
  for (const c of countRows) {
    if (!(c as { _stk_recount_value?: string })._stk_recount_value) continue;
    const k = lotOf(c), at = c.stk_countedon ?? "";
    if (!latestRecount.has(k) || at > latestRecount.get(k)!.at) latestRecount.set(k, { id: c.stk_countlineid, at });
  }
  const current = countRows.filter((c) => { const r = latestRecount.get(lotOf(c)); return !r || r.id === c.stk_countlineid; });
  // One row per counter, across all their assignments (Ibero first).
  const byCounter = new Map<string, typeof assignmentRows>();
  for (const a of assignmentRows) if (a._stk_counter_value) byCounter.set(a._stk_counter_value, [...(byCounter.get(a._stk_counter_value) ?? []), a]);
  const counters: Counter[] = [...byCounter.entries()].map(([id, mine]) => {
    mine.sort((x, y) => Number(thirdParty.has(siteCode.get(x._stk_site_value!) ?? "IBR")) - Number(thirdParty.has(siteCode.get(y._stk_site_value!) ?? "IBR")));
    const codes = mine.map((a) => siteCode.get(a._stk_site_value!) ?? "IBR");
    const where = mine.map((a, i) => (thirdParty.has(codes[i]) ? (sites.find((s) => s.code === codes[i])?.short ?? codes[i]) : `${sites.find((s) => s.code === codes[i])?.short ?? codes[i]} ${areaOf(a).toLowerCase()}`));
    const theirs = current.filter((c) => c._createdby_value === id);
    const first = theirs.map((c) => (c.stk_countedon ? new Date(c.stk_countedon).getHours() : 24)).sort((x, y) => x - y)[0];
    return {
      name: nm(id),
      site: codes[0],
      sites: codes,
      area: where.join(", "),
      bagsSoFar: theirs.reduce((s, c) => s + (c.stk_bags ?? 0), 0),
      startedAt: first == null || first === 24 ? 7 : first,
      recounts: recountsByOwner.get(id) ?? 0,
    };
  });
  const byHour = new Map<string, number>();
  for (const c of countRows) if (c.stk_countedon) byHour.set(pad(new Date(c.stk_countedon).getHours()), (byHour.get(pad(new Date(c.stk_countedon).getHours())) ?? 0) + (c.stk_bags ?? 0));
  const hourly = [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([h, bags]) => ({ h, bags }));
  const countedBags: Partial<Record<SiteCode, number>> = {};
  for (const c of countRows) {
    const code = siteCode.get(c._stk_site_value!);
    if (code) countedBags[code] = (countedBags[code] ?? 0) + (c.stk_bags ?? 0);
  }

  /* physical − XBS by outturn, for the lots that have been counted (reconciliation is finished in 7e) */
  const stackName = new Map(stackRows.map((r) => [r.stk_stackid, r.stk_name]));
  const physDelta: Record<string, number> = {};
  const seenLot = new Set<string>();
  for (const c of countRows) {
    if (c.stk_isother || !c.stk_outturn) continue;
    const site = siteCode.get(c._stk_site_value!);
    const stack = stackName.get(c._stk_stack_value!);
    const expected = lines.filter((l) => l.b === c.stk_batch && l.wh === site && (thirdParty.has(site) || l.z === stack));
    const key = `${site}|${stack}|${c.stk_batch}`;
    const xbsBags = seenLot.has(key) ? 0 : expected.reduce((s, l) => s + l.bg, 0);
    seenLot.add(key);
    physDelta[c.stk_outturn] = (physDelta[c.stk_outturn] ?? 0) + (c.stk_bags ?? 0) - xbsBags;
  }

  /* imports, people, direct purchases, issues */
  const imports: XbsImport[] = importRows.map((r) => ({
    id: r.stk_name,
    at: stamp(r.stk_snapshotat ?? r.createdon),
    by: nm(r._stk_importedby_value),
    files: (r.stk_filenames ?? "").split("\n").filter(Boolean),
    rows: r.stk_rowcount ?? 0,
    status: IMPORT_STATUS[label(Stk_xbsimportsstk_status, r.stk_status) ?? "Imported"] ?? "Imported",
    issues: (r.stk_failcount ?? 0) + (r.stk_warningcount ?? 0),
  }));
  const users: UserRow[] = [
    ...new Map(
      assignmentRows.map((a) => [
        a._stk_counter_value!,
        { name: nm(a._stk_counter_value), email: "", role: "Counter" as const, sites: sites.find((x) => x.code === siteCode.get(a._stk_site_value!))?.short ?? "" },
      ]),
    ).values(),
  ];
  const directPurchases: DirectPurchase[] = dpRows.map((r) => ({
    contract: r.stk_name,
    supplier: r.stk_supplier ?? "",
    kind: (label(Stk_directpurchasesstk_suppliertype, r.stk_suppliertype) ?? "Co-operative") as DirectPurchase["kind"],
    outturn: r.stk_outturn ?? undefined,
    warrant: r.stk_warrant ?? undefined,
    grade: r.stk_grade ?? "",
    bagsContracted: r.stk_bagscontracted ?? 0,
    bagsInvoiced: r.stk_bagsinvoiced ?? 0,
    bagsDelivered: r.stk_bagsdelivered ?? 0,
    invoiceDate: r.stk_invoicedate ? day(r.stk_invoicedate, true) : "—",
  }));
  for (const r of issueRows) ids.issue.set(r.stk_name, r.stk_issueid);
  const issues: Issue[] = issueRows.map((r) => ({
    id: r.stk_name,
    category: label(Stk_issuesstk_category, r.stk_category) ?? "Other",
    site: siteCode.get(r._stk_site_value!) ?? "IBR",
    screen: r.stk_screen ?? "",
    text: r.stk_description ?? "",
    by: nm(r._createdby_value),
    at: stamp(r.createdon),
    status: (label(Stk_issuesstk_status, r.stk_status) ?? "Open") as Issue["status"],
    owner: r._stk_assignedto_value ? nm(r._stk_assignedto_value) : undefined,
    resolution: r.stk_resolution ?? undefined,
    linkedCause: label(Stk_issuesstk_linkedcause, r.stk_linkedcause) as RootCause | undefined,
    photo: photoOf.get(r.stk_issueid),
  }));

  /* mapping: baskets, change requests */
  const [basketRows, changeRows, outturnRows] = await Promise.all([
    all((o) => Stk_basketmapsService.getAll(o), { select: ["stk_basketmapid", "stk_name", "stk_basketcode", "stk_primarybasket"], orderBy: ["stk_basketcode asc"] }, "read basket mapping"),
    all(
      (o) => Stk_mappingchangesService.getAll(o),
      { select: ["stk_mappingchangeid", "stk_name", "stk_target", "stk_targetkey", "stk_from", "stk_to", "stk_reason", "stk_state", "createdon", "_createdby_value"], orderBy: ["createdon desc"] },
      "read mapping changes",
    ),
    all((o) => Stk_outturnmapsService.getAll(o), { select: ["stk_outturnmapid", "stk_name"] }, "read outturn mapping"),
  ]);
  for (const b of basketRows) if (b.stk_basketcode) ids.basket.set(b.stk_basketcode, b.stk_basketmapid);
  for (const o of outturnRows) ids.outturnMap.set(o.stk_name, o.stk_outturnmapid);
  const bagsByBasket = new Map<string, number>();
  for (const l of lines) if (l.bc) bagsByBasket.set(l.bc, (bagsByBasket.get(l.bc) ?? 0) + l.bg);
  const baskets: BasketMap[] = basketRows.map((b) => ({
    code: b.stk_basketcode ?? "",
    name: (b.stk_name ?? "").replace(`${b.stk_basketcode} `, ""),
    primary: (label(Stk_basketmapsstk_primarybasket, b.stk_primarybasket) ?? "FAQ") as PrimaryBasket,
    bags: bagsByBasket.get(b.stk_basketcode ?? "") ?? 0,
  }));
  const who3 = await names(changeRows.map((c) => c._createdby_value));
  const changes: MappingChange[] = changeRows.map((c) => {
    ids.change.set(c.stk_name, { id: c.stk_mappingchangeid, by: c._createdby_value });
    const target = label(Stk_mappingchangesstk_target, c.stk_target) ?? "Basket";
    const basketName = basketRows.find((b) => b.stk_basketcode === c.stk_targetkey)?.stk_name;
    return {
      id: c.stk_name,
      what: target === "Basket" ? `Basket ${basketName ?? c.stk_targetkey}` : `Outturn ${c.stk_targetkey}`,
      from: c.stk_from ?? "",
      to: c.stk_to ?? "",
      by: who3.get(c._createdby_value ?? "") ?? "Someone",
      at: stamp(c.createdon),
      reason: c.stk_reason ?? "",
      state: (label(Stk_mappingchangesstk_state, c.stk_state) ?? "Pending") as MappingChange["state"],
    };
  });

  /* audit: Dataverse's own change history for the STK tables */
  const audit = await readAudit(
    new Map<string, string>([
      ...siteRows.map((r) => [r.stk_siteid, r.stk_code] as [string, string]),
      ...basketRows.map((r) => [r.stk_basketmapid, r.stk_name ?? ""] as [string, string]),
      ...changeRows.map((r) => [r.stk_mappingchangeid, r.stk_name] as [string, string]),
      ...stockTakeRows.map((r) => [r.stk_stocktakeid, r.stk_name] as [string, string]),
      ...activeSheets.map((r) => [r.stk_countsheetid, r.stk_name] as [string, string]),
      ...issueRows.map((r) => [r.stk_issueid, r.stk_name] as [string, string]),
      ...varianceRows.map((r) => [r.stk_varianceid, r.stk_name] as [string, string]),
      ...(exceptionRows as unknown as { stk_exceptionid: string; stk_name: string }[]).map((r) => [r.stk_exceptionid, r.stk_name.split(" — ")[0]] as [string, string]),
    ]),
  );

  /* sign-off so far: replay the gate rows; a send-back clears earlier signatures */
  const signRows = await all(
    (o) => Stk_signoffsService.getAll(o),
    { select: ["stk_gate", "stk_action", "stk_signedon", "stk_comment", "_stk_signedby_value"], filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`, orderBy: ["stk_signedon asc"] },
    "read sign-off",
  );
  const who4 = await names(signRows.map((x) => x._stk_signedby_value));
  const signatures: Partial<Record<Gate, Signature>> = {};
  // The chain's last signature certifies the position (Country Finance Manager on a monthly count).
  const lastGate = chainFor(ids.stockTakeType).at(-1)?.gate;
  let financeSignedOn: string | undefined;
  ids.signedBy.clear();
  for (const x of signRows) {
    if (label(Stk_signoffsstk_action, x.stk_action) === "Sent back") {
      for (const k of Object.keys(signatures)) delete signatures[k as Gate];
      ids.signedBy.clear();
      financeSignedOn = undefined;
      continue;
    }
    const gate = GATES.find((g) => g.gate === label(Stk_signoffsstk_gate, x.stk_gate))?.gate;
    if (!gate) continue;
    const byId = x._stk_signedby_value ?? undefined;
    signatures[gate] = { by: who4.get(byId ?? "") ?? "Someone", byId, at: stamp(x.stk_signedon), comment: x.stk_comment ?? undefined };
    if (byId) ids.signedBy.set(gate, byId);
    if (gate === lastGate) financeSignedOn = x.stk_signedon ?? undefined;
  }

  /* governance KPIs: saved rows of every stock take (the trend); frozen once Finance signed */
  const kpiRows = await all(
    (o) => Stk_kpisnapshotsService.getAll(o),
    { select: ["stk_code", "stk_kpiname", "stk_value", "stk_display", "stk_target", "stk_status", "stk_frozenon", "_stk_stocktake_value"] as never },
    "read the governance KPIs",
  ).catch((e: unknown) => {
    console.warn("Governance KPIs not read:", e);
    return [];
  });
  const stOf = new Map(stockTakeRows.map((r) => [r.stk_stocktakeid, r]));
  const history: KpiRecord[] = (kpiRows as unknown as { stk_code: string; stk_kpiname?: string; stk_value?: number | null; stk_display?: string; stk_target?: string; stk_status?: number; stk_frozenon?: string; _stk_stocktake_value?: string }[])
    .filter((r) => stOf.has(r._stk_stocktake_value ?? ""))
    .map((r) => ({
      stockTake: stOf.get(r._stk_stocktake_value!)!.stk_name,
      countDate: (stOf.get(r._stk_stocktake_value!)!.stk_countdate ?? "").slice(0, 10),
      code: r.stk_code,
      name: r.stk_kpiname ?? r.stk_code,
      value: r.stk_value == null ? null : Number(r.stk_value),
      display: r.stk_display ?? "",
      target: r.stk_target ?? "",
      status: (label(Stk_kpisnapshotsstk_status, r.stk_status) ?? "Not measurable") as KpiRecord["status"],
      frozenOn: r.stk_frozenon ?? undefined,
    }))
    .sort((a, b) => b.countDate.localeCompare(a.countDate));
  kpi.frozen = history.some((h) => h.stockTake === active.stk_name && h.frozenOn);
  const governance: GovernanceData | undefined = setup
    ? undefined
    : {
        history,
        countDate: (active.stk_countdate ?? "").slice(0, 10) || undefined,
        countClosedOn: (active as { stk_countclosedon?: string }).stk_countclosedon ?? undefined,
        financeSignedOn,
        targets: kpiTargets(setting),
      };

  /* today */
  const now = new Date();
  const countDate = active.stk_countdate ? new Date(active.stk_countdate) : now;
  const today: Today = {
    date: day(now),
    now: hhmm(now.toISOString()),
    countDay: day(countDate),
    signOffDay: Math.max(1, workingDaysBetween(countDate, now)),
    signOffTarget: setting("SignOffWorkingDays", 7),
  };

  /* reports and approvals: the raw count lines and stack statuses */
  const sheetName = new Map(activeSheets.map((r) => [r.stk_countsheetid, r.stk_name]));
  // Open recounts by stack + batch, so a line shows "recount asked" until someone redoes it.
  const openRecount = code(Stk_recountsstk_status, "Open");
  const recountOf = new Map(
    (recountRows as unknown as { stk_name: string; stk_batch?: string; stk_status?: number; _stk_stack_value?: string; _ownerid_value?: string }[])
      .filter((r) => r.stk_status === openRecount)
      .map((r) => [`${r._stk_stack_value}|${r.stk_batch ?? ""}`, r.stk_name]),
  );
  const counts: CountRow[] = countRows.map((c) => {
    const x = c as typeof c & { stk_pocketkg?: number; stk_category?: number; _stk_recount_value?: string };
    ids.line.set(c.stk_countlineid, { stackId: c._stk_stack_value, outturn: c.stk_outturn ?? "", batch: c.stk_batch ?? "", counterId: c._createdby_value });
    return {
      id: c.stk_countlineid,
      recountOpen: recountOf.get(`${c._stk_stack_value}|${c.stk_batch ?? ""}`),
      site: siteCode.get(c._stk_site_value!)!,
      stack: stackOf.get(c._stk_stack_value!)?.name ?? "",
      batch: c.stk_batch ?? "",
      outturn: c.stk_outturn ?? "",
      grade: c.stk_grade ?? "",
      bags: c.stk_bags ?? 0,
      pocketKg: Number(x.stk_pocketkg ?? 0),
      units: c.stk_units ?? (c.stk_bags ?? 0) + (c.stk_pocketbags ?? 0),
      kg: Number(c.stk_kg ?? 0),
      by: nm(c._createdby_value),
      byId: c._createdby_value,
      countedOn: c.stk_countedon ?? undefined,
      found: !!c.stk_isfound,
      other: !!c.stk_isother,
      category: label(Stk_countlinesstk_category, x.stk_category),
      reason: label(Stk_countlinesstk_reason, c.stk_reason),
      recount: !!x._stk_recount_value,
      sheet: sheetName.get(c._stk_countsheet_value ?? ""),
      photo: photoOf.get(c.stk_countlineid),
    };
  });
  const stacks: StackInfo[] = stackRows.map((r) => ({
    site: siteCode.get(r._stk_site_value!)!,
    name: r.stk_name,
    status: label(Stk_stacksstk_status, r.stk_status) ?? "In progress",
    // Reported empty, or not counted on purpose: either way the site is in and its XBS lots compare with 0.
    empty: !!(r as { stk_nothinghere?: boolean }).stk_nothinghere || !!(r as { stk_notcounted?: boolean }).stk_notcounted,
  }));

  /* Level 1 closes on its own once counting is finished (close-count.ts). */
  const countClose = await closeCountIfDone(hubDb, {
    active: active as unknown as { stk_stocktakeid: string; stk_name: string; stk_status?: number; stk_countclosedon?: string; stk_l1summary?: string },
    lines,
    stackRows: stackRows as unknown as StackRow[],
    emptySites,
    counts,
    variances,
    exceptions,
    countRows,
    thirdParty,
    sites,
    autoClose: l1.autoClose && runner.hubRuns,
  }).catch((e: unknown) => {
    console.warn("Automatic count close skipped:", e);
    return undefined;
  });
  if (countClose?.closedNow) {
    const st = stockTakes.find((x) => x.id === active.stk_name);
    if (st) st.status = "Reconciliation";
  }

  if (governance && countClose?.closedAt) governance.countClosedOn = countClose.closedAt;

  return {
    counts,
    stacks,
    countClose,
    assistant: (settingRows.find((x) => x.stk_name === "AssistantEnabled")?.stk_value ?? "").trim().toLowerCase() === "true",
    contractJournal: contractRows.length ? contractJournalOf(contractRows, nm) : undefined,
    shipments: shipmentRows.length
      ? { file: shipmentRows[0].stk_source ?? "Shipment tracker", at: stamp(shipmentRows[0].createdon), by: nm(shipmentRows[0]._createdby_value), lines: shipmentRows.map(shipmentLineOf) }
      : undefined,
    subProducts: subRows.length ? subProductsOf(subRows) : undefined,
    transferReports: transferRows.length
      ? [...new Map(transferRows.map((r) => [`${r.kind}|${r.reportedAt}|${r.file}`, r])).values()].map((r) => ({
          ...r,
          rows: transferRows.filter((x) => x.kind === r.kind && x.reportedAt === r.reportedAt && x.file === r.file).length,
        }))
      : undefined,
    xbsStuffing: stuffingRows.length ? { files: [...new Set(stuffingRows.map((r) => r.stk_source ?? "XBS shipped report"))], rows: stuffingRows.map(stuffingOf) } : undefined,
    afloatAgeingDays: ageingDays(settingRows.find((x) => x.stk_name === "AfloatAgeingDays")?.stk_value),
    thirdPartyAgeingDays: ageingDays(settingRows.find((x) => x.stk_name === "ThirdPartyAgeingDays")?.stk_value),
    thirdPartyCallOffDays: ageingDays(settingRows.find((x) => x.stk_name === "ThirdPartyAgeDays")?.stk_value)?.[0],
    subProductAgeDays: ageingDays(settingRows.find((x) => x.stk_name === "SubProductAgeDays")?.stk_value)?.[0],
    directLots: directRows.length
      ? { file: directRows[0].stk_source ?? "Direct purchases", at: stamp(directRows[0].createdon), by: nm(directRows[0]._createdby_value), lots: directRows.map(directLotOf) }
      : undefined,
    level1: runner,
    allocation,
    governance,
    reference: {
      today,
      lines,
      sites,
      imports,
      counters,
      hourly,
      countedBags,
      directPurchases,
      users,
      packTypes: packRows.map((p) => ({ id: p.stk_code ?? p.stk_name, label: p.stk_name, kg: Number(p.stk_kgperbag ?? 60), grades: p.stk_gradepattern ?? "All other grades" })),
      stockTakeGroups: assignmentRows.map((a) => ({ name: areaOf(a), site: sites.find((x) => x.code === siteCode.get(a._stk_site_value!))?.short ?? "", locations: areaOf(a), counters: 1 })),
      // The contract checks read the stock take's shipment tracker from the store (Pre-count checks).
      contracts: { cancelled: [], shipped: [], stuffed: [] },
      people: [...ids.person.keys()],
      physDelta,
      comtrasDelta: {},
      comtras: comtrasRows.length ? comtrasPosition(comtrasRows, nm) : undefined,
    },
    stockTakes,
    activeStockTake: active.stk_name || undefined,
    currentStockTake: currentRow.stk_name || undefined,
    viewing,
    sheets,
    variances,
    exceptions,
    changes,
    baskets,
    signatures,
    signers: ids.signers,
    issues,
    audit,
    setup,
    reconItems: reconRows.map((r) => {
      const x = r as { stk_reconitemid: string; stk_name: string; stk_kind?: number; stk_bags?: number; stk_inxbs?: boolean; stk_note?: string; createdon?: string; _createdby_value?: string };
      return {
        id: x.stk_reconitemid,
        label: x.stk_name,
        kind: (label(Stk_reconitemsstk_kind, x.stk_kind) ?? "Reconciling item") as ReconItem["kind"],
        bags: Number(x.stk_bags ?? 0),
        inXbs: !!x.stk_inxbs,
        note: x.stk_note ?? undefined,
        by: nm(x._createdby_value),
        at: stamp(x.createdon),
      };
    }),
    comments: commentsOf(commentRows, nm),
  };
}

interface CommentRow {
  stk_commentid: string;
  stk_text?: string;
  stk_department?: number;
  _stk_exception_value?: string;
  _stk_variance_value?: string;
  createdon?: string;
  _createdby_value?: string;
}

/** Threads keyed the way the screens know their subjects: EX-### for exceptions, the id for variances. */
function commentsOf(rows: CommentRow[], nm: (id?: string) => string): ThreadComment[] {
  const exName = new Map([...ids.exception].map(([name, id]) => [id, name]));
  return rows.flatMap((r) => {
    const ex = r._stk_exception_value && exName.get(r._stk_exception_value);
    const target = ex || r._stk_variance_value;
    if (!target) return [];
    return [{
      id: r.stk_commentid,
      on: ex ? "Exception" : "Variance",
      target,
      text: r.stk_text ?? "",
      dept: (label(Stk_commentsstk_department, r.stk_department) ?? "Operations") as Dept,
      by: nm(r._createdby_value),
      at: stamp(r.createdon),
    } as ThreadComment];
  });
}

/* ---------- Level 1 summary PDF ---------- */

/** The stock take's Level 1 summary PDF, for download (undefined if there is none). */
async function getL1Pdf(stockTakeName: string): Promise<{ name: string; base64: string } | undefined> {
  const id = ids.stockTake.get(stockTakeName);
  if (!id) return undefined;
  const [row] = await all(
    (q) => AnnotationsService.getAll(q),
    { select: ["filename", "documentbody"], filter: `_objectid_value eq ${id} and subject eq '${L1_PDF_SUBJECT}'`, top: 1 },
    "read the Level 1 PDF",
  );
  return row?.documentbody ? { name: row.filename ?? "Level 1 summary.pdf", base64: row.documentbody } : undefined;
}

/* ---------- actions ---------- */

const SHEET_TO_DV: Record<SheetStatus, string> = { "In progress": "In progress", Submitted: "Submitted", Approved: "Approved", Rejected: "Sent back" };
const STATE_TO_DV: Record<Variance["state"], string> = { open: "Open", recount: "Recount sent", accepted: "Accepted", exception: "Exception raised" };

async function decideSheet(name: string, status: SheetStatus, comment: string) {
  const id = ids.sheet.get(name);
  if (!id) throw new Error(`Count sheet ${name} not found`);
  const dvStatus = SHEET_TO_DV[status];
  unwrap(
    await Stk_countsheetsService.update(id, {
      stk_status: code(Stk_countsheetsstk_status, dvStatus),
      ...(status === "Submitted"
        ? {}
        : { stk_decidedon: new Date().toISOString(), "stk_decidedby@odata.bind": bind("systemusers", ids.me), stk_decisioncomment: comment || null }),
    } as never),
    `update ${name}`,
  );
  // The counter's phone reads stack states: mirror the decision onto the sheet's stacks.
  if (status === "Approved" || status === "Rejected")
    for (const stackId of ids.sheetStacks.get(id) ?? [])
      unwrap(
        await Stk_stacksService.update(stackId, {
          stk_status: code(Stk_stacksstk_status, status === "Approved" ? "Approved" : "Sent back"),
          ...(status === "Rejected" ? { stk_comment: comment } : {}),
        } as never),
        "update the sheet's stacks",
      );
}

async function decideVariance(name: string, state: Variance["state"], cause: RootCause, to?: { id: string; name: string }) {
  const v = ids.variance.get(name);
  if (!v) throw new Error(`Variance ${name} not found`);
  unwrap(
    await Stk_variancesService.update(v.id, {
      stk_state: code(Stk_variancesstk_state, STATE_TO_DV[state]),
      stk_cause: code(Stk_variancesstk_cause, cause),
      stk_decidedon: new Date().toISOString(),
      "stk_decidedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    `update ${name}`,
  );
  if (state === "recount") {
    if (!v.stackId) throw new Error(`${name} has no stack to recount`);
    const existing = await all((o) => Stk_recountsService.getAll(o), { select: ["stk_name"], filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "number the recount");
    const next = existing.reduce((m, r) => Math.max(m, Number(r.stk_name.replace(/\D/g, "")) || 0), 0) + 1;
    unwrap(
      await Stk_recountsService.create({
        stk_name: `R-${String(next).padStart(3, "0")}`,
        statecode: 0,
        stk_outturn: v.outturn,
        stk_batch: v.batch,
        stk_why: `Count ${v.outturn} again from the bottom tier up. The earlier figure is hidden on purpose.`,
        stk_status: code(Stk_recountsstk_status, "Open"),
        "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        "stk_stack@odata.bind": bind("stk_stacks", v.stackId),
        "stk_variance@odata.bind": bind("stk_variances", v.id),
        // A different counter when one was picked (blind, fresh eyes); otherwise whoever counted.
        ...((to?.id ?? v.counterId) ? { "ownerid@odata.bind": bind("systemusers", to?.id ?? v.counterId!) } : {}),
      } as never),
      "send the recount",
    );
  }
}

/* ---------- counter allocation ---------- */

async function saveCounterProfile(p: CounterProfile) {
  const fields = {
    stk_name: p.name.slice(0, 100),
    stk_homerows: p.homeRows.join(","),
    stk_thirdpartyok: p.thirdPartyOk,
    stk_active: p.active,
    stk_notes: p.notes ?? null,
    "stk_user@odata.bind": bind("systemusers", p.userId),
    ...(p.homeSite ? { "stk_homesite@odata.bind": bind("stk_sites", ids.site.get(p.homeSite)!) } : {}),
  };
  if (p.id) {
    unwrap(await Stk_counterprofilesService.update(p.id, fields as never), `update ${p.name}'s profile`);
    return p.id;
  }
  return unwrap(await Stk_counterprofilesService.create({ ...fields, statecode: 0 } as never), `save ${p.name}'s profile`).stk_counterprofileid;
}

/**
 * Publishes an allocation. The previous published run becomes Superseded; each
 * counter gets one active assignment per warehouse in the plan (updated in place
 * where one exists, so count sheets keep their link); assignments of people no
 * longer in the plan are deactivated, never deleted.
 */
async function publishAllocation(input: { plan: Plan; present: string[]; changes: AllocationChange[] }) {
  const { plan } = input;
  const runs = await all((o) => Stk_allocationrunsService.getAll(o), { select: ["stk_allocationrunid", "stk_name", "stk_status", "_stk_stocktake_value"] as never }, "number the allocation");
  const published = code(Stk_allocationrunsstk_status, "Published");
  const name = `AR-${String(runs.reduce((m, r) => Math.max(m, Number(r.stk_name.replace(/\D/g, "")) || 0), 0) + 1).padStart(3, "0")}`;
  for (const r of runs.filter((x) => x._stk_stocktake_value === ids.stockTakeId && x.stk_status === published))
    unwrap(await Stk_allocationrunsService.update(r.stk_allocationrunid, { stk_status: code(Stk_allocationrunsstk_status, "Superseded") } as never), `supersede ${r.stk_name}`);
  const now = new Date().toISOString();
  const run = unwrap(
    await Stk_allocationrunsService.create({
      stk_name: name,
      statecode: 0,
      stk_status: published,
      stk_seed: plan.seed,
      stk_spreadpct: plan.spreadPct,
      stk_present: JSON.stringify(input.present).slice(0, 4000),
      stk_plan: JSON.stringify(plan),
      stk_swaps: JSON.stringify(input.changes).slice(0, 4000),
      stk_rules: JSON.stringify(plan.rules),
      stk_publishedon: now,
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      "stk_ranby@odata.bind": bind("systemusers", ids.me),
      "stk_publishedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    "save the allocation",
  );
  const existing = await all(
    (o) => Stk_assignmentsService.getAll(o),
    { select: ["stk_assignmentid", "_stk_counter_value", "_stk_site_value"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId} and statecode eq 0` },
    "read assignments",
  );
  const keep = new Set<string>();
  for (const row of plan.rows) {
    const bySite = new Map<SiteCode, typeof row.areas>();
    for (const a of row.areas) bySite.set(a.site, [...(bySite.get(a.site) ?? []), a]);
    for (const [site, areas] of bySite) {
      const { sections, bags } = assignmentFor(areas);
      const rows = [...new Set(sectionList(sections, site).flatMap((t) => sectionRows(t, site)))];
      // "<counter> · Ibero rows A, B and G" / "<counter> · Mill Export row D, bays 15–19" /
      // "<counter> · AGL whole site" - F9 sends the part after " · ".
      const where = hasLayout(site) ? sectionsWords(sectionList(sections, site), site) : "whole site";
      const fields = {
        stk_name: `${row.name} · ${SITES.find((x) => x.code === site)?.short ?? site} ${where}`.slice(0, 100),
        stk_sections: sections || null,
        stk_rows: rows.join(",").slice(0, 20) || null,
        stk_plannedbags: bags,
        "stk_allocationrun@odata.bind": bind("stk_allocationruns", run.stk_allocationrunid),
      };
      const had = existing.find((x) => x._stk_counter_value === row.counterId && x._stk_site_value === ids.site.get(site));
      if (had) {
        keep.add(had.stk_assignmentid);
        unwrap(await Stk_assignmentsService.update(had.stk_assignmentid, fields as never), `update ${row.name}'s assignment`);
      } else
        unwrap(
          await Stk_assignmentsService.create({
            ...fields,
            statecode: 0,
            "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
            "stk_counter@odata.bind": bind("systemusers", row.counterId),
            "stk_site@odata.bind": bind("stk_sites", ids.site.get(site)!),
          } as never),
          `assign ${row.name}`,
        );
    }
  }
  for (const x of existing.filter((e) => !keep.has(e.stk_assignmentid)))
    unwrap(await Stk_assignmentsService.update(x.stk_assignmentid, { statecode: 1, statuscode: 2 } as never), "close an old assignment");
  return name;
}

/** A supervisor asks for a blind recount of one line, without sending the whole sheet back. */
async function recountLine(line: CountRow, note: string, to?: { id: string; name: string }) {
  const l = line.id ? ids.line.get(line.id) : undefined;
  if (!l?.stackId) throw new Error(`${line.outturn || "this line"} at ${line.stack} can't be recounted: it has no saved stack`);
  const existing = await all((o) => Stk_recountsService.getAll(o), { select: ["stk_name"], filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "number the recount");
  const name = `R-${String(existing.reduce((m, r) => Math.max(m, Number(r.stk_name.replace(/\D/g, "")) || 0), 0) + 1).padStart(3, "0")}`;
  // Link the lot's variance if there is one, so the decision trail stays together.
  const variance = [...ids.variance.values()].find((v) => v.stackId === l.stackId && v.batch === l.batch);
  unwrap(
    await Stk_recountsService.create({
      stk_name: name,
      statecode: 0,
      stk_outturn: l.outturn,
      stk_batch: l.batch,
      // Shown to the counter: never an XBS figure or the earlier count.
      stk_why: `${note.trim() ? `${note.trim()} ` : ""}Count ${l.outturn} again from the bottom tier up. The earlier figure is hidden on purpose.`.slice(0, 2000),
      stk_status: code(Stk_recountsstk_status, "Open"),
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      "stk_stack@odata.bind": bind("stk_stacks", l.stackId),
      ...(variance ? { "stk_variance@odata.bind": bind("stk_variances", variance.id) } : {}),
      // A different counter when one was picked; their line replaces the earlier one for the lot.
      ...((to?.id ?? l.counterId) ? { "ownerid@odata.bind": bind("systemusers", to?.id ?? l.counterId!) } : {}),
    } as never),
    "send the recount",
  );
  return name;
}

const KIND_FALLBACK = "Not yet known";
async function addException(e: Exception) {
  const v = ids.variance.get(e.ref);
  const kind = Object.values(Stk_exceptionsstk_kind).includes(e.kind as never) ? e.kind : KIND_FALLBACK;
  const priority: Priority = e.priority ?? (e.source === "Import" ? "Medium" : priorityFor(e.bags, ids));
  const created = unwrap(
    await Stk_exceptionsService.create({
      stk_name: `${e.id} — ${e.title}`.slice(0, 200),
      statecode: 0,
      stk_kind: code(Stk_exceptionsstk_kind, kind),
      stk_source: code(Stk_exceptionsstk_source, e.source),
      stk_reference: e.ref,
      stk_department: code(Stk_exceptionsstk_department, e.dept),
      stk_bags: e.bags,
      stk_duedate: addWorkingDays(new Date(), priority === "High" ? ids.highDays : priority === "Low" ? ids.lowDays : ids.slaDays).toISOString().slice(0, 10),
      stk_status: code(Stk_exceptionsstk_status, "Open"),
      stk_escalationlevel: code(Stk_exceptionsstk_escalationlevel, "Owner"),
      stk_priority: code(Stk_exceptionsstk_priority, priority),
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      ...(v ? { "stk_variance@odata.bind": bind("stk_variances", v.id) } : {}),
    } as never),
    "raise the exception",
  );
  ids.exception.set(e.id, created.stk_exceptionid);
}

async function updateException(name: string, patch: Partial<Exception>) {
  const id = ids.exception.get(name);
  if (!id) throw new Error(`Exception ${name} not found`);
  const levels = Object.keys(Stk_exceptionsstk_escalationlevel).map(Number);
  const fields: Record<string, unknown> = {};
  if (patch.status) {
    fields.stk_status = code(Stk_exceptionsstk_status, patch.status);
    if (patch.status === "Closed") fields.stk_closedon = new Date().toISOString();
  }
  if (patch.escalation != null) fields.stk_escalationlevel = levels[Math.min(patch.escalation, levels.length - 1)];
  if (patch.resolution != null) fields.stk_resolution = patch.resolution;
  if (patch.status === "Closed" && !patch.resolution) throw new Error("say how it was fixed before closing");
  if (patch.owner) {
    const person = ids.person.get(patch.owner);
    if (!person) throw new Error(`${patch.owner} isn't a user in this environment`);
    fields["ownerid@odata.bind"] = bind("systemusers", person);
  }
  unwrap(await Stk_exceptionsService.update(id, fields as never), `update ${name}`);
  if (patch.owner) {
    const person = ids.person.get(patch.owner)!;
    await ensureLookup(
      `The owner of ${name}`,
      () => Stk_exceptionsService.get(id, { select: ["_ownerid_value"] as never }),
      "_ownerid_value",
      person,
      () => Stk_exceptionsService.update(id, { "ownerid@odata.bind": bind("systemusers", person) } as never),
    );
  }
}

/* ---------- 7d: master data ---------- */

const TABLE_LABEL: Record<string, string> = {
  stk_site: "Warehouses (NKG_config)",
  stk_basketmap: "Basket mapping",
  stk_outturnmap: "Outturn mapping",
  stk_mappingchange: "Mapping changes",
  stk_stocktake: "Stock takes",
  stk_countsheet: "Count sheets",
  stk_variance: "Variances",
  stk_exception: "Exceptions",
  stk_issue: "Problem reports",
  stk_signoff: "Sign-off",
  stk_setting: "Settings",
  stk_directpurchase: "Direct purchases",
  stk_packtype: "Packing types",
};
const FIELD_LABEL: Record<string, string> = {
  stk_manualentry: "Manual outturn entry",
  stk_primarybasket: "Primary basket",
  stk_state: "State",
  stk_status: "Status",
  stk_cause: "Cause",
  stk_escalationlevel: "Escalation",
  stk_resolution: "Resolution",
  stk_decisioncomment: "Comment",
  stk_value: "Value",
  ownerid: "Owner",
  stk_assignedto: "Assigned to",
};
const SKIP_FIELDS = new Set(["owningbusinessunit", "statuscode", "statecode", "modifiedon", "modifiedby", "stk_closedon", "stk_decidedon", "stk_decidedby", "stk_submittedon"]);

/** Readable change lines from audit rows; newest first, last 150. */
async function readAudit(nameOf: Map<string, string>): Promise<AuditEntry[]> {
  const tables = Object.keys(TABLE_LABEL);
  let rows;
  try {
    rows = await all(
      (o) => AuditsService.getAll(o),
      {
        select: ["createdon", "action", "objecttypecode", "_objectid_value", "_userid_value", "changedata"] as never,
        filter: tables.map((t) => `objecttypecode eq '${t}'`).join(" or "),
        orderBy: ["createdon desc"],
        top: 150,
      },
      "read the audit history",
    );
  } catch (e) {
    // Reading audit history needs "View Audit History"; without it the rest of the Hub still opens.
    if (!/PrivilegeDenied|missing prv\w+ privilege/i.test(String((e as Error)?.message ?? e))) throw e;
    return [{ at: "", by: "", list: "Audit log", item: "", change: "Your account can't read the audit history yet: it needs the View Audit History permission (part of the STK management roles). Ask your administrator." }];
  }
  type Row = { createdon?: string; action?: number; objecttypecode?: string; _objectid_value?: string; _userid_value?: string; changedata?: string };
  const list = rows as unknown as Row[];
  const who = await names(list.map((r) => r._userid_value));
  const verb: Record<number, string> = { 1: "Created", 2: "Updated", 3: "Deleted", 13: "Assigned" };
  return list.map((r) => {
    let change = verb[r.action ?? 0] ?? "Changed";
    try {
      const parsed = JSON.parse(r.changedata ?? "{}") as { changedAttributes?: { logicalName: string; oldValue?: string; newValue?: string; oldName?: string; newName?: string }[] };
      const parts = (parsed.changedAttributes ?? [])
        .filter((a) => !SKIP_FIELDS.has(a.logicalName) && (r.action !== 1 || FIELD_LABEL[a.logicalName]))
        .map((a) => {
          const f = FIELD_LABEL[a.logicalName] ?? a.logicalName.replace(/^stk_/, "");
          const show = (name?: string, value?: string) => (name ?? (value === "True" ? "On" : value === "False" ? "Off" : value) ?? "—").toString().slice(0, 60);
          return r.action === 1 ? `${f}: ${show(a.newName, a.newValue)}` : `${f}: ${show(a.oldName, a.oldValue)} → ${show(a.newName, a.newValue)}`;
        });
      if (parts.length) change = `${change}${r.action === 1 ? " — " : ": "}${parts.slice(0, 3).join("; ")}`;
    } catch {
      /* keep the verb */
    }
    return {
      at: stamp(r.createdon),
      by: who.get(r._userid_value ?? "") ?? "System",
      list: TABLE_LABEL[r.objecttypecode ?? ""] ?? r.objecttypecode ?? "",
      item: nameOf.get(r._objectid_value ?? "") ?? (r._objectid_value ?? "").slice(0, 8),
      change,
    };
  });
}

async function requestMapping(c: MappingChange) {
  const basket = c.what.match(/^Basket (\S+)/)?.[1];
  const outturn = c.what.match(/^Outturn (\S+)/)?.[1];
  const target = basket ? "Basket" : "Outturn";
  const existing = await all((o) => Stk_mappingchangesService.getAll(o), { select: ["stk_name"] }, "number the change");
  const next = existing.reduce((m, r) => Math.max(m, Number(r.stk_name.replace(/\D/g, "")) || 0), 0) + 1;
  const name = `MC-${String(next).padStart(3, "0")}`;
  const created = unwrap(
    await Stk_mappingchangesService.create({
      stk_name: name,
      statecode: 0,
      stk_target: code(Stk_mappingchangesstk_target, target),
      stk_targetkey: basket ?? outturn ?? "",
      stk_from: c.from,
      stk_to: c.to,
      stk_reason: c.reason,
      stk_state: code(Stk_mappingchangesstk_state, "Pending"),
    } as never),
    "request the change",
  );
  ids.change.set(c.id, { id: created.stk_mappingchangeid, by: ids.me });
  ids.change.set(name, { id: created.stk_mappingchangeid, by: ids.me });
}

/**
 * A whole basket table taken from an XBS mapping report, as ONE change Finance approves.
 * stk_targetkey is BASKET_TABLE_KEY; stk_reason ends with "Rows: code=Primary[:Description]; ..."
 * (description only for baskets new to the table). Approving it updates every basket whose
 * primary basket differs and adds the missing ones; nothing is deleted.
 */
const BASKET_TABLE_KEY = "XBS REPORT";
async function applyBasketTable(changeId: string, reason: string, name: string) {
  const rows = (reason.split("Rows:")[1] ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [codePart, rest] = [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)];
      const [primary, ...desc] = rest.split(":");
      return { code: codePart.trim(), primary: primary.trim(), desc: desc.join(":").trim() };
    });
  if (!rows.length) throw new Error(`${name} has no basket rows`);
  const valid = new Set(Object.values(Stk_basketmapsstk_primarybasket) as string[]);
  const bad = rows.filter((r) => !valid.has(r.primary));
  if (bad.length) throw new Error(`${name}: unknown primary basket for ${bad.map((b) => b.code).join(", ")}`);
  const current = await all((o) => Stk_basketmapsService.getAll(o), { select: ["stk_basketmapid", "stk_basketcode", "stk_primarybasket"] }, "read the basket mapping");
  const byCode = new Map(current.map((b) => [b.stk_basketcode ?? "", b]));
  for (const r of rows) {
    const fields = { stk_primarybasket: code(Stk_basketmapsstk_primarybasket, r.primary), "stk_lastchange@odata.bind": bind("stk_mappingchanges", changeId) };
    const had = byCode.get(r.code);
    if (had) {
      if (label(Stk_basketmapsstk_primarybasket, had.stk_primarybasket) !== r.primary) unwrap(await Stk_basketmapsService.update(had.stk_basketmapid, fields as never), `apply ${name} to ${r.code}`);
    } else {
      const made = unwrap(await Stk_basketmapsService.create({ stk_name: (r.desc || r.code).slice(0, 120), stk_basketcode: r.code, statecode: 0, ...fields } as never), `apply ${name}: add ${r.code}`);
      ids.basket.set(r.code, made.stk_basketmapid);
    }
  }
}

async function decideMapping(name: string, approve: boolean) {
  const c = ids.change.get(name);
  if (!c) throw new Error(`Change ${name} not found`);
  if (ids.enforceSoD && c.by === ids.me) throw new Error("you requested this change, so someone else must approve it");
  const row = unwrap(
    await Stk_mappingchangesService.get(c.id, { select: ["stk_target", "stk_targetkey", "stk_to", "stk_state", "stk_reason"] }),
    `read ${name}`,
  );
  if (label(Stk_mappingchangesstk_state, row.stk_state) !== "Pending") throw new Error(`${name} has already been decided`);
  // A whole basket table is applied before it is marked Approved, so a failure leaves it Pending.
  if (approve && (row.stk_targetkey ?? "") === BASKET_TABLE_KEY) await applyBasketTable(c.id, row.stk_reason ?? "", name);
  unwrap(
    await Stk_mappingchangesService.update(c.id, {
      stk_state: code(Stk_mappingchangesstk_state, approve ? "Approved" : "Rejected"),
      stk_decidedon: new Date().toISOString(),
      "stk_decidedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    `decide ${name}`,
  );
  if (!approve) return;
  const key = row.stk_targetkey ?? "";
  if (key === BASKET_TABLE_KEY) return; // applied above
  if (label(Stk_mappingchangesstk_target, row.stk_target) === "Basket") {
    const basketId = ids.basket.get(key);
    if (!basketId) throw new Error(`Basket ${key} isn't in the mapping table`);
    unwrap(
      await Stk_basketmapsService.update(basketId, {
        stk_primarybasket: code(Stk_basketmapsstk_primarybasket, row.stk_to ?? ""),
        "stk_lastchange@odata.bind": bind("stk_mappingchanges", c.id),
      } as never),
      `apply ${name}`,
    );
  } else {
    const basketCode = (row.stk_to ?? "").split(" ")[0];
    const fields = { stk_basketcode: basketCode, "stk_change@odata.bind": bind("stk_mappingchanges", c.id) };
    const existing = ids.outturnMap.get(key);
    if (existing) unwrap(await Stk_outturnmapsService.update(existing, fields as never), `apply ${name}`);
    else {
      const made = unwrap(await Stk_outturnmapsService.create({ stk_name: key, statecode: 0, ...fields } as never), `apply ${name}`);
      ids.outturnMap.set(key, made.stk_outturnmapid);
    }
  }
}

async function setManualEntry(site: SiteCode, on: boolean) {
  const id = ids.site.get(site);
  if (!id) throw new Error(`Warehouse ${site} not found`);
  unwrap(await Stk_sitesService.update(id, { stk_manualentry: on } as never), `update ${site}`);
}

async function addDirectPurchase(d: DirectPurchase) {
  unwrap(
    await Stk_directpurchasesService.create({
      stk_name: d.contract,
      statecode: 0,
      stk_supplier: d.supplier,
      stk_suppliertype: code(Stk_directpurchasesstk_suppliertype, d.kind),
      stk_outturn: d.outturn ?? null,
      stk_warrant: d.warrant ?? null,
      stk_grade: d.grade,
      stk_bagscontracted: d.bagsContracted,
      stk_bagsinvoiced: d.bagsInvoiced,
      stk_bagsdelivered: d.bagsDelivered,
    } as never),
    `add ${d.contract}`,
  );
}

async function photo(id: string) {
  const r = unwrap(await AnnotationsService.get(id, { select: ["documentbody", "mimetype"] }), "open the photo");
  if (!r.documentbody) throw new Error("This photo has no picture data.");
  return { mime: r.mimetype ?? "image/jpeg", base64: r.documentbody };
}

async function updateIssue(name: string, patch: Partial<Issue>) {
  const id = ids.issue.get(name);
  if (!id) throw new Error(`Problem report ${name} not found`);
  const fields: Record<string, unknown> = {};
  if (patch.status) fields.stk_status = code(Stk_issuesstk_status, patch.status);
  if (patch.resolution != null) fields.stk_resolution = patch.resolution;
  if ("linkedCause" in patch) fields.stk_linkedcause = patch.linkedCause ? code(Stk_issuesstk_linkedcause, patch.linkedCause) : null;
  if ("owner" in patch) {
    const person = patch.owner ? ids.person.get(patch.owner) : undefined;
    if (patch.owner && !person) throw new Error(`${patch.owner} isn't a user in this environment`);
    fields["stk_assignedto@odata.bind"] = person ? bind("systemusers", person) : null;
  }
  unwrap(await Stk_issuesService.update(id, fields as never), `update ${name}`);
  if ("owner" in patch) {
    const person = patch.owner ? ids.person.get(patch.owner)! : null;
    await ensureLookup(
      `The owner of ${name}`,
      () => Stk_issuesService.get(id, { select: ["_stk_assignedto_value"] as never }),
      "_stk_assignedto_value",
      person,
      () => Stk_issuesService.update(id, { "stk_assignedto@odata.bind": person ? bind("systemusers", person) : null } as never),
    );
  }
}

/* ---------- 7e: import, stock takes, sign-off ---------- */

const pad2 = (n: number) => String(n).padStart(2, "0");

type ComtrasRow = { stk_basketcode?: string; stk_bags?: number; stk_kg?: number; stk_linetype?: string; stk_contract?: string; stk_origin?: string; stk_counterparty?: string; stk_source?: string; createdon?: string; _createdby_value?: string };
function comtrasPosition(rows: ComtrasRow[], nm: (id?: string) => string) {
  const first = rows[0];
  return {
    file: first.stk_source ?? "",
    at: stamp(first.createdon),
    by: nm(first._createdby_value),
    lines: rows.map((r) => ({
      contract: r.stk_contract ?? "",
      lineType: (r.stk_linetype ?? "Inventory") as ComtrasLineType,
      origin: r.stk_origin ?? "",
      quality: r.stk_basketcode ?? "",
      bags60: Number(r.stk_bags ?? 0),
      kg: Number(r.stk_kg ?? 0),
      counterparty: r.stk_counterparty ?? "",
    })),
  };
}

async function addComment(c: ThreadComment) {
  const exId = c.on === "Exception" ? ids.exception.get(c.target) : undefined;
  if (c.on === "Exception" && !exId) throw new Error(`Exception ${c.target} not found`);
  return unwrap(
    await Stk_commentsService.create({
      stk_name: `${c.target} · ${c.text}`.slice(0, 100),
      statecode: 0,
      stk_text: c.text.slice(0, 2000),
      stk_department: code(Stk_commentsstk_department, c.dept),
      ...(ids.stockTakeId && ids.stockTakeId !== NO_STOCK_TAKE ? { "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId) } : {}),
      ...(exId ? { "stk_exception@odata.bind": bind("stk_exceptions", exId) } : { "stk_variance@odata.bind": bind("stk_variances", c.target) }),
    } as never),
    "add the comment",
  ).stk_commentid;
}

async function addReconItem(i: ReconItem) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first.");
  return unwrap(
    await Stk_reconitemsService.create({
      stk_name: i.label.slice(0, 200),
      statecode: 0,
      stk_kind: code(Stk_reconitemsstk_kind, i.kind),
      stk_bags: Math.round(i.bags * 100) / 100,
      stk_inxbs: i.inXbs,
      stk_note: i.note ?? null,
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
    } as never),
    `add ${i.label}`,
  ).stk_reconitemid;
}

/* ---------- Stock Assistant ---------- */

/** Asks the Copilot Studio agent through flow F11 ("Execute Agent and wait"); answers take a few seconds. */
async function askAssistant(question: string, conversation?: string): Promise<AssistantAnswer> {
  const r = unwrap(await IBKYF11_HubaskstheStockAssistantService.Run({ text: question, text_1: conversation ?? "" }), "ask the Stock Assistant");
  // F11 answers even when the agent call fails, with the reason (e.g. the agent isn't published).
  if (r?.error) throw new Error(/not published/i.test(r.error) ? "The Stock Assistant agent isn't published yet in Copilot Studio. Ask its owner to publish it." : r.error);
  return { answer: r?.answer ?? "", conversation: r?.conversation ?? conversation ?? "", raw: r?.raw ?? "" };
}

/** Whether the active stock take's KPIs are frozen (Finance signed); frozen rows are never rewritten. */
const kpi = { frozen: false };

/**
 * Saves the active stock take's governance KPIs: one stk_kpisnapshot row per KPI, found by its
 * key "<stock take id>|<code>" and updated in place. `freeze` stamps them final at Finance sign-off.
 */
async function saveKpis(kpis: Kpi[], freeze: boolean) {
  if (kpi.frozen || !ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) return;
  const existing = await all(
    (o) => Stk_kpisnapshotsService.getAll(o),
    { select: ["stk_kpisnapshotid", "stk_kpikey", "stk_frozenon"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` },
    "read the governance KPIs",
  );
  const byKey = new Map((existing as unknown as { stk_kpisnapshotid: string; stk_kpikey: string; stk_frozenon?: string }[]).map((r) => [r.stk_kpikey, r]));
  if ([...byKey.values()].some((r) => r.stk_frozenon)) {
    kpi.frozen = true;
    return;
  }
  const now = new Date().toISOString();
  const stName = [...ids.stockTake.entries()].find(([, id]) => id === ids.stockTakeId)?.[0] ?? "";
  for (const k of kpis) {
    const key = `${ids.stockTakeId}|${k.code}`;
    const row = {
      stk_name: `${stName} · ${k.name}`.slice(0, 200),
      stk_code: k.code,
      stk_kpiname: k.name.slice(0, 100),
      stk_kpisource: k.source,
      stk_owner: k.owner,
      stk_value: k.value == null ? null : Math.round(k.value * 10000) / 10000,
      stk_display: k.display.slice(0, 60),
      stk_target: k.target.slice(0, 60),
      stk_status: code(Stk_kpisnapshotsstk_status, k.status),
      stk_detail: k.detail.slice(0, 1000),
      stk_measuredon: now,
      ...(freeze ? { stk_frozenon: now } : {}),
    };
    const hit = byKey.get(key);
    if (hit) unwrap(await Stk_kpisnapshotsService.update(hit.stk_kpisnapshotid, row as never), `save the ${k.name} KPI`);
    else
      unwrap(
        await Stk_kpisnapshotsService.create({ ...row, stk_kpikey: key, statecode: 0, "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId) } as never),
        `save the ${k.name} KPI`,
      );
  }
  if (freeze) kpi.frozen = true;
}

async function removeReconItem(id: string) {
  await Stk_reconitemsService.delete(id);
}

/* ---------- Comtras 537 contract invoicing journal ---------- */

const CONTRACT_SELECT = [
  "stk_rownumber", "stk_source", "stk_side", "stk_account", "stk_counterparty", "stk_profile", "stk_bookedon", "stk_voucherdate", "stk_voucher", "stk_doctype",
  "stk_purchasecontract", "stk_purchasecontractdate", "stk_salescontract", "stk_salescontractdate",
  "stk_buybags", "stk_buykg", "stk_buy60", "stk_buyvalue", "stk_sellbags", "stk_sellkg", "stk_sell60", "stk_sellvalue", "createdon", "_createdby_value",
];
type ContractRow = {
  stk_rownumber?: number; stk_source?: string; stk_side?: number; stk_account?: string; stk_counterparty?: string; stk_profile?: string; stk_bookedon?: string; stk_voucherdate?: string;
  stk_voucher?: string; stk_doctype?: number; stk_purchasecontract?: string; stk_purchasecontractdate?: string; stk_salescontract?: string; stk_salescontractdate?: string;
  stk_buybags?: number; stk_buykg?: number; stk_buy60?: number; stk_buyvalue?: number; stk_sellbags?: number; stk_sellkg?: number; stk_sell60?: number; stk_sellvalue?: number;
  createdon?: string; _createdby_value?: string;
};
const contractLineOf = (r: ContractRow): ContractLine => ({
  row: r.stk_rownumber ?? 0,
  side: (label(Stk_contractinvoicesstk_side, r.stk_side) ?? "Customer") as ContractLine["side"],
  account: r.stk_account ?? "",
  counterparty: r.stk_counterparty ?? "",
  profile: r.stk_profile ?? "",
  bookedOn: (r.stk_bookedon ?? "").slice(0, 10),
  voucherDate: (r.stk_voucherdate ?? "").slice(0, 10),
  voucher: r.stk_voucher ?? "",
  docType: r.stk_doctype ?? 0,
  purchaseContract: r.stk_purchasecontract ?? "",
  purchaseContractDate: r.stk_purchasecontractdate?.slice(0, 10),
  salesContract: r.stk_salescontract ?? "",
  salesContractDate: r.stk_salescontractdate?.slice(0, 10),
  buyBags: Number(r.stk_buybags ?? 0),
  buyKg: Number(r.stk_buykg ?? 0),
  buy60: Number(r.stk_buy60 ?? 0),
  buyValue: Number(r.stk_buyvalue ?? 0),
  sellBags: Number(r.stk_sellbags ?? 0),
  sellKg: Number(r.stk_sellkg ?? 0),
  sell60: Number(r.stk_sell60 ?? 0),
  sellValue: Number(r.stk_sellvalue ?? 0),
});

/** Each 537 file's rows are numbered file x 1,000,000 + row in the file (the first file loaded is 0). */
const FILE_ROWS = 1_000_000;

/** The stock take's 537 lines, one or more files (afloat needs the look-back: the month of the count and the two before). */
function contractJournalOf(rows: ContractRow[], nm: (id?: string) => string): ContractJournal {
  const files = [...new Set(rows.map((r) => Math.floor((r.stk_rownumber ?? 0) / FILE_ROWS)))].sort((a, b) => a - b).map((seq) => {
    const mine = rows.filter((r) => Math.floor((r.stk_rownumber ?? 0) / FILE_ROWS) === seq);
    const days = mine.map((r) => (r.stk_bookedon ?? "").slice(0, 10)).filter(Boolean).sort();
    const first = mine.reduce((m, r) => ((r.createdon ?? "") < (m.createdon ?? "") ? r : m), mine[0]);
    return { file: first.stk_source ?? "537", created: first.createdon ?? "", at: stamp(first.createdon), by: nm(first._createdby_value), lines: mine.length, from: days[0], to: days[days.length - 1] };
  });
  const last = files.reduce((m, f) => (f.created > m.created ? f : m), files[0]);
  return { file: files.map((f) => f.file).join(" + "), at: last.at, by: last.by, lines: rows.map(contractLineOf), files: files.map(({ created: _c, ...f }) => f) };
}

/**
 * A 537 file for the active stock take. More than one can be loaded (one month's export each): lines
 * already loaded from another file are skipped (newContractLines), and each file's rows get their own
 * number range. Snapshots are never changed; a load that stopped part way is finished with the same file.
 */
async function importContracts(u: ContractUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the contract journal is loaded for it.");
  const saved = (await all((o) => Stk_contractinvoicesService.getAll(o), { select: CONTRACT_SELECT as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "check the contract journal")) as unknown as ContractRow[];
  const seqOf = (r: ContractRow) => Math.floor((r.stk_rownumber ?? 0) / FILE_ROWS);
  const name = u.file.slice(0, 200);
  const mine = saved.filter((r) => r.stk_source === name);
  const seq = mine.length ? seqOf(mine[0]) : saved.length ? Math.max(...saved.map(seqOf)) + 1 : 0;
  const others = saved.filter((r) => seqOf(r) !== seq).map(contractLineOf);
  const { fresh } = newContractLines(u.lines, others);
  const have = new Set(mine.map((r) => r.stk_rownumber));
  const queue = fresh.filter((l) => !have.has(seq * FILE_ROWS + l.row));
  if (!queue.length) throw new Error(fresh.length ? `${u.file} is already loaded for this stock take.` : `Every line of ${u.file} is already loaded from another file.`);
  const d = (iso?: string) => iso || null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const total = queue.length;
  let done = 0;
  // A few at a time: 900+ lines one by one take minutes. Stock take + row number is a key, so a resent line is never doubled.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        const res = await Stk_contractinvoicesService.create({
          stk_name: `${l.voucher} · ${l.counterparty}`.slice(0, 100),
          statecode: 0,
          stk_rownumber: seq * FILE_ROWS + l.row,
          stk_source: name,
          stk_side: code(Stk_contractinvoicesstk_side, l.side),
          stk_account: l.account.slice(0, 20),
          stk_counterparty: l.counterparty.slice(0, 60),
          stk_profile: l.profile.slice(0, 10),
          stk_bookedon: d(l.bookedOn),
          stk_voucherdate: d(l.voucherDate),
          stk_voucher: l.voucher.slice(0, 20),
          stk_doctype: l.docType,
          stk_purchasecontract: l.purchaseContract.slice(0, 20),
          stk_purchasecontractdate: d(l.purchaseContractDate),
          stk_salescontract: l.salesContract.slice(0, 20),
          stk_salescontractdate: d(l.salesContractDate),
          stk_buybags: r2(l.buyBags),
          stk_buykg: r2(l.buyKg),
          stk_buy60: r2(l.buy60),
          stk_buyvalue: r2(l.buyValue),
          stk_sellbags: r2(l.sellBags),
          stk_sellkg: r2(l.sellKg),
          stk_sell60: r2(l.sell60),
          stk_sellvalue: r2(l.sellValue),
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        } as never);
        if (!res.success && !isDuplicateKey(res.error)) unwrap(res, `save 537 line ${l.row}`);
        onProgress?.(++done, total);
      }
    }),
  );
}

/* ---------- Direct purchase lots (Trading) ---------- */

const DIRECT_SELECT = [
  "stk_rownumber", "stk_source", "stk_sheet", "stk_contract", "stk_contractdate", "stk_grower", "stk_outturn", "stk_grade", "stk_bags", "stk_pocketkg", "stk_kg",
  "stk_cert", "stk_primary", "stk_secondary", "stk_warrant", "stk_warrantkg", "stk_receivedkg", "stk_warehouse", "stk_receivedon", "createdon", "_createdby_value",
];
type DirectRow = {
  stk_rownumber?: number; stk_source?: string; stk_sheet?: string; stk_contract?: string; stk_contractdate?: string; stk_grower?: string; stk_outturn?: string; stk_grade?: string;
  stk_bags?: number; stk_pocketkg?: number; stk_kg?: number; stk_cert?: string; stk_primary?: string; stk_secondary?: string; stk_warrant?: string; stk_warrantkg?: number;
  stk_receivedkg?: number; stk_warehouse?: string; stk_receivedon?: string; createdon?: string; _createdby_value?: string;
};
const directLotOf = (r: DirectRow): DirectLot => ({
  row: r.stk_rownumber ?? 0,
  sheet: r.stk_sheet ?? "",
  contract: r.stk_contract ?? "",
  contractDate: r.stk_contractdate?.slice(0, 10),
  grower: r.stk_grower ?? "",
  outturn: r.stk_outturn ?? "",
  grade: r.stk_grade ?? "",
  bags: Number(r.stk_bags ?? 0),
  pocketKg: Number(r.stk_pocketkg ?? 0),
  kg: Number(r.stk_kg ?? 0),
  cert: r.stk_cert ?? "",
  primary: r.stk_primary ?? "",
  secondary: r.stk_secondary ?? "",
  warrant: r.stk_warrant ?? "",
  warrantKg: Number(r.stk_warrantkg ?? 0),
  receivedKg: Number(r.stk_receivedkg ?? 0),
  warehouse: r.stk_warehouse ?? "",
  receivedOn: r.stk_receivedon?.slice(0, 10),
});

/** Direct purchase lots are a snapshot like the tracker: loaded once per stock take, never changed. */
async function importDirectLots(u: DirectUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the direct purchase lots are loaded for it.");
  // A load that stopped part way can be finished with the same file: rows already saved are skipped.
  const saved = (await all((o) => Stk_directlotsService.getAll(o), { select: ["stk_rownumber", "stk_source"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "check the direct purchase lots")) as unknown as { stk_rownumber?: number; stk_source?: string }[];
  if (saved.length && (saved.length >= u.lots.length || saved.some((r) => r.stk_source !== u.file.slice(0, 200))))
    throw new Error("Direct purchase lots are already loaded for this stock take. Snapshots are never re-imported or changed.");
  const have = new Set(saved.map((r) => r.stk_rownumber));
  const d = (iso?: string) => iso || null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  let done = have.size;
  let failed = false;
  const queue = u.lots.filter((l) => !have.has(l.row));
  // A few at a time, like the 537. Stock take + row number is a key, so a resent lot is never doubled.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let l = queue.shift(); l && !failed; l = queue.shift()) {
        const res = await Stk_directlotsService.create({
          stk_name: `${l.contract || "-"} · ${l.outturn} ${l.grade}`.slice(0, 100),
          statecode: 0,
          stk_rownumber: l.row,
          stk_source: u.file.slice(0, 200),
          stk_sheet: l.sheet.slice(0, 40),
          stk_contract: l.contract.slice(0, 20),
          stk_contractdate: d(l.contractDate),
          stk_grower: l.grower.slice(0, 100),
          stk_outturn: l.outturn.slice(0, 20),
          stk_grade: l.grade.slice(0, 20),
          stk_bags: r2(l.bags),
          stk_pocketkg: r2(l.pocketKg),
          stk_kg: r2(l.kg),
          stk_cert: l.cert.slice(0, 60),
          stk_primary: l.primary.slice(0, 40),
          stk_secondary: l.secondary.slice(0, 60),
          stk_warrant: l.warrant.slice(0, 40),
          stk_warrantkg: r2(l.warrantKg),
          stk_receivedkg: r2(l.receivedKg),
          stk_warehouse: l.warehouse.slice(0, 40),
          stk_receivedon: d(l.receivedOn),
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        } as never);
        if (!res.success && !isDuplicateKey(res.error)) {
          failed = true;
          unwrap(res, `save direct lot ${l.row}`);
        }
        onProgress?.(++done, u.lots.length);
      }
    }),
  );
}

/* ---------- Shipment tracker (Trade / Logistics) ---------- */

const SHIPMENT_SELECT = [
  "stk_rownumber", "stk_source", "stk_salescontract", "stk_purchasecontract", "stk_si", "stk_buyer", "stk_bags", "stk_qualitycode", "stk_quality", "stk_packaging",
  "stk_destination", "stk_contractdate", "stk_stuffedon", "stk_sailedon", "stk_etapod", "stk_bl", "stk_vessel", "stk_status", "stk_usdvalue", "createdon", "_createdby_value",
];
type ShipmentRow = {
  stk_rownumber?: number; stk_source?: string; stk_salescontract?: string; stk_purchasecontract?: string; stk_si?: string; stk_buyer?: string; stk_bags?: number;
  stk_qualitycode?: string; stk_quality?: string; stk_packaging?: string; stk_destination?: string; stk_contractdate?: string; stk_stuffedon?: string; stk_sailedon?: string;
  stk_etapod?: string; stk_bl?: string; stk_vessel?: string; stk_status?: string; stk_usdvalue?: number; createdon?: string; _createdby_value?: string;
};
const shipmentLineOf = (r: ShipmentRow): ShipmentLine => ({
  row: r.stk_rownumber ?? 0,
  salesContract: r.stk_salescontract ?? "",
  purchaseContract: r.stk_purchasecontract ?? "",
  si: r.stk_si ?? "",
  buyer: r.stk_buyer ?? "",
  bags: Number(r.stk_bags ?? 0),
  qualityCode: r.stk_qualitycode ?? "",
  quality: r.stk_quality ?? "",
  packaging: r.stk_packaging ?? "",
  destination: r.stk_destination ?? "",
  contractDate: r.stk_contractdate?.slice(0, 10),
  stuffedOn: r.stk_stuffedon?.slice(0, 10),
  sailedOn: r.stk_sailedon?.slice(0, 10),
  etaPod: r.stk_etapod?.slice(0, 10),
  bl: r.stk_bl ?? "",
  vessel: r.stk_vessel ?? "",
  status: r.stk_status ?? "",
  usdValue: Number(r.stk_usdvalue ?? 0),
});

const STUFFING_SELECT = ["stk_source", "stk_salescontract", "stk_si", "stk_stuffedon", "stk_bags", "stk_lots"];
type StuffingRow = { stk_source?: string; stk_salescontract?: string; stk_si?: string; stk_stuffedon?: string; stk_bags?: number; stk_lots?: number };
const stuffingOf = (r: StuffingRow): XbsStuffing => ({
  salesContract: r.stk_salescontract ?? "",
  si: r.stk_si ?? "",
  stuffedOn: r.stk_stuffedon?.slice(0, 10) ?? "",
  bags: Number(r.stk_bags ?? 0),
  lots: r.stk_lots ?? 0,
});
const SUB_SELECT = ["stk_source", "stk_register", "stk_kind", "stk_bookedon", "stk_ref", "stk_contract", "stk_quality", "stk_bags", "stk_pockets", "stk_kg", "stk_location", "stk_status", "stk_sheet", "stk_rownumber"];
type SubRow = { stk_source?: string; stk_register?: number; stk_kind?: number; stk_bookedon?: string; stk_ref?: string; stk_contract?: string; stk_quality?: string; stk_bags?: number; stk_pockets?: number; stk_kg?: number; stk_location?: string; stk_status?: string; stk_sheet?: string; stk_rownumber?: number };
function subProductsOf(rows: SubRow[]) {
  const files: Partial<Record<SubProductRegister, string>> = {};
  const out = rows.map((r): SubProductRow => {
    const reg = (label(Stk_subproductsstk_register, r.stk_register) ?? "Sub-products report") as SubProductRegister;
    files[reg] ??= r.stk_source ?? reg;
    return {
      kind: (label(Stk_subproductsstk_kind, r.stk_kind) ?? "Ex-office sweepings") as SubProductRow["kind"],
      on: r.stk_bookedon?.slice(0, 10),
      ref: r.stk_ref ?? "",
      contract: r.stk_contract ?? undefined,
      quality: r.stk_quality ?? undefined,
      bags: r.stk_bags ?? 0,
      pockets: r.stk_pockets ?? 0,
      kg: Number(r.stk_kg ?? 0),
      location: r.stk_location ?? undefined,
      status: r.stk_status ?? undefined,
      sheet: r.stk_sheet ?? "",
      row: r.stk_rownumber ?? 0,
    };
  });
  return { files, rows: out };
}

/**
 * A sub-product register is a snapshot like XBS: one file per register per stock take, never changed.
 * A load that stopped part way is finished with the same file (rows already saved are skipped); a
 * different file for a register already loaded is refused.
 */
async function importSubProducts(u: SubProductUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the sub-product registers are loaded for it.");
  const reg = code(Stk_subproductsstk_register, u.register);
  const saved = (await all((o) => Stk_subproductsService.getAll(o), { select: ["stk_key", "stk_source"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId} and stk_register eq ${reg}` }, "check the sub-product registers")) as unknown as { stk_key?: string; stk_source?: string }[];
  const other = saved.find((r) => r.stk_source && r.stk_source !== u.file.slice(0, 200));
  if (other) throw new Error(`The ${u.register.toLowerCase()} is already loaded for this stock take (${other.stk_source}); it is kept as it was.`);
  const have = new Set(saved.map((r) => r.stk_key));
  const keyOf = (x: SubProductRow) => `${u.register[0]}|${x.sheet.slice(0, 40)}|${x.row}`.slice(0, 60);
  const queue = u.rows.filter((x) => !have.has(keyOf(x)));
  if (!queue.length) throw new Error(`Every row of ${u.file} is already loaded for this stock take.`);
  let done = u.rows.length - queue.length;
  let failed = false;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let x = queue.shift(); x && !failed; x = queue.shift()) {
        const res = await Stk_subproductsService.create({
          stk_name: `${x.kind} · ${x.ref || "-"} · ${x.on ?? ""}`.slice(0, 100),
          statecode: 0,
          stk_key: keyOf(x),
          stk_source: u.file.slice(0, 200),
          stk_register: reg,
          stk_kind: code(Stk_subproductsstk_kind, x.kind),
          stk_bookedon: x.on ?? null,
          stk_ref: x.ref.slice(0, 30),
          stk_contract: x.contract?.slice(0, 20) ?? null,
          stk_quality: x.quality?.slice(0, 60) ?? null,
          stk_bags: Math.round(x.bags),
          stk_pockets: Math.round(x.pockets),
          stk_kg: Math.round(x.kg * 100) / 100,
          stk_location: x.location?.slice(0, 30) ?? null,
          stk_status: x.status?.slice(0, 100) ?? null,
          stk_sheet: x.sheet.slice(0, 60),
          stk_rownumber: x.row,
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        } as never);
        if (!res.success && !isDuplicateKey(res.error)) {
          failed = true;
          unwrap(res, `save ${x.kind} ${x.ref}`);
        }
        onProgress?.(++done, u.rows.length);
      }
    }),
  );
}

/* ---------- physical count from the old app (count-import.ts) ---------- */

/** What the count import needs from Dataverse: the active stock take, its sites and XBS lots. */
async function countImportInputs() {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Create the stock take first; the count is loaded into it.");
  const take = unwrap(await Stk_stocktakesService.get(ids.stockTakeId, { select: ["stk_name", "stk_status", "stk_countdate", "_stk_import_value"] } as never), "read the stock take") as unknown as {
    stk_name: string;
    stk_status?: number;
    stk_countdate?: string;
    _stk_import_value?: string;
  };
  const siteRows = (await all((o) => Stk_sitesService.getAll(o), { select: ["stk_siteid", "stk_code", "stk_name", "stk_shortname", "stk_isthirdparty"] as never }, "read the warehouses")) as unknown as {
    stk_siteid: string;
    stk_code: string;
    stk_name: string;
    stk_shortname?: string;
    stk_isthirdparty?: boolean;
  }[];
  const codeOf = new Map(siteRows.map((r) => [r.stk_siteid, r.stk_code as SiteCode]));
  const xbs = (await all(
    (o) => Stk_xbslinesService.getAll(o),
    { select: ["stk_xbslineid", "stk_name", "stk_outturn", "stk_grade", "stk_zone", "stk_stocktype", "stk_kg", "_stk_site_value"] as never, filter: `_stk_import_value eq ${take._stk_import_value}`, orderBy: ["stk_rownumber asc"] },
    "read the XBS stock",
  )) as unknown as { stk_xbslineid: string; stk_name: string; stk_outturn?: string; stk_grade?: string; stk_zone?: string; stk_stocktype?: number; stk_kg?: number; _stk_site_value?: string }[];
  const sites: ImportSite[] = siteRows.map((r) => ({ code: r.stk_code as SiteCode, name: r.stk_name, shortName: r.stk_shortname ?? undefined, thirdParty: !!r.stk_isthirdparty }));
  const lots: ImportLot[] = xbs.map((l) => ({
    id: l.stk_xbslineid,
    batch: l.stk_name,
    outturn: l.stk_outturn ?? "",
    grade: l.stk_grade ?? "",
    zone: l.stk_zone ?? "",
    site: codeOf.get(l._stk_site_value ?? "")!,
    bfp: label(Stk_xbslinesstk_stocktype, l.stk_stocktype) === "Blocked for processing",
    kg: Number(l.stk_kg ?? 0),
  }));
  return { take, siteRows, sites, lots };
}

/** Reads the old app's CSV against the active stock take: what would be loaded. Writes nothing. */
async function planCounts(csvText: string, opt: ImportOptions): Promise<CountPreview> {
  const { take, sites, lots } = await countImportInputs();
  if (!take.stk_countdate) throw new Error(`${take.stk_name} has no count date.`);
  const plan = planCountImport(csvText, take.stk_countdate, sites, lots, opt);
  const tag = `old-${ids.stockTakeId.slice(0, 8)}-`;
  const saved = await all((o) => Stk_countlinesService.getAll(o), { select: ["stk_clientid"] as never, filter: `startswith(stk_clientid,'${tag}')` }, "check for an earlier load");
  const have = new Set((saved as unknown as { stk_clientid?: string }[]).map((r) => r.stk_clientid));
  return {
    plan,
    stockTake: take.stk_name,
    countDate: take.stk_countdate,
    counting: label(Stk_stocktakesstk_status, take.stk_status) === "Count in progress",
    alreadyLoaded: plan.lines.filter((l) => have.has(`${tag}${l.rows[0]}`)).length,
    xbsKg: lots.reduce((a, l) => a + l.kg, 0),
  };
}

/**
 * Loads the planned count as the counter app would have saved it: one count sheet per warehouse
 * (CS-OLD-<site>), the stacks submitted, the lines keyed "old-<stock take>-<CSV line>". A load that
 * stopped part way is finished with the same file: sheets, stacks and lines already there are reused.
 */
/* ---------- blind recount sheet: the warehouse's answers ---------- */

type RecountRowDv = { stk_recountid: string; stk_name: string; stk_outturn?: string; stk_batch?: string; stk_status?: number; _stk_stack_value?: string };

/** The active stock take's recounts with their stacks and the packing of their first count. */
async function recountInputs() {
  const st = ids.stockTakeId;
  if (!st || st === NO_STOCK_TAKE) throw new Error("Start the stock take first.");
  const [recounts, stacks, packs] = await Promise.all([
    all((o) => Stk_recountsService.getAll(o), { select: ["stk_recountid", "stk_name", "stk_outturn", "stk_batch", "stk_status", "_stk_stack_value"] as never, filter: `_stk_stocktake_value eq ${st}` }, "read the recounts") as unknown as Promise<RecountRowDv[]>,
    all((o) => Stk_stacksService.getAll(o), { select: ["stk_stackid", "stk_name", "_stk_site_value"] as never, filter: `_stk_stocktake_value eq ${st}` }, "read the stacks") as unknown as Promise<{ stk_stackid: string; stk_name: string; _stk_site_value?: string }[]>,
    all((o) => Stk_packtypesService.getAll(o), { select: ["stk_packtypeid", "stk_kgperbag"] as never }, "read packing types") as unknown as Promise<{ stk_packtypeid: string; stk_kgperbag?: number }[]>,
  ]);
  const sheets = (await all((o) => Stk_countsheetsService.getAll(o), { select: ["stk_countsheetid", "_stk_site_value"] as never, filter: `_stk_stocktake_value eq ${st}` }, "read the count sheets")) as unknown as { stk_countsheetid: string; _stk_site_value?: string }[];
  // First-count lines on the recounts' stacks: their packing (50 or 60 kg) and grade.
  const stackIds = [...new Set(recounts.map((r) => r._stk_stack_value).filter((x): x is string => !!x))];
  const lines: { stk_batch?: string; stk_grade?: string; _stk_stack_value?: string; _stk_packtype_value?: string; _stk_recount_value?: string; _stk_xbsline_value?: string }[] = [];
  for (const chunk of chunks(stackIds, 15))
    lines.push(...((await all((o) => Stk_countlinesService.getAll(o), { select: ["stk_batch", "stk_grade", "_stk_stack_value", "_stk_packtype_value", "_stk_recount_value", "_stk_xbsline_value"] as never, filter: orFilter("_stk_stack_value", chunk) }, "read the first counts")) as unknown as typeof lines));
  const kgOf = new Map(packs.map((p) => [p.stk_packtypeid, Number(p.stk_kgperbag ?? 60)]));
  const first = (r: RecountRowDv) => lines.find((l) => !l._stk_recount_value && l._stk_stack_value === r._stk_stack_value && l.stk_batch === r.stk_batch);
  return { recounts, stacks, packs, sheets, first, kgOf };
}

/** Reads the returned recount sheet against the active stock take's recounts (writes nothing). */
async function planRecounts(rows: RecountSheetRow[]): Promise<RecountPlan> {
  const { recounts, stacks, first, kgOf } = await recountInputs();
  const open = code(Stk_recountsstk_status, "Open");
  return planRecountAnswers(
    rows,
    recounts.map((r) => {
      const f = first(r);
      return {
        id: r.stk_recountid,
        name: r.stk_name,
        outturn: r.stk_outturn ?? "",
        stack: stacks.find((x) => x.stk_stackid === r._stk_stack_value)?.stk_name ?? "",
        open: r.stk_status === open,
        packKg: f?._stk_packtype_value && kgOf.get(f._stk_packtype_value) === 50 ? 50 : 60,
      };
    }),
  );
}

/**
 * Saves the warehouse's answers the way the counter app saves a blind recount: one count line per
 * recount, flagged blind and linked to it, on its stack; then the recount is Done. Each line is keyed
 * by its R-number, so a sheet loaded twice answers nothing twice. Level 1 settles them on the next load.
 */
async function importRecounts(plan: RecountPlan, file: string, onProgress?: (done: number, total: number) => void) {
  if (plan.errors.length) throw new Error(`${plan.errors.length} row(s) of the sheet can't be loaded. Fix the sheet first.`);
  if (!plan.answers.length) throw new Error("Nothing to load: no answered recount on the sheet.");
  const st = ids.stockTakeId;
  const { recounts, stacks, packs, sheets, first, kgOf } = await recountInputs();
  const take = unwrap(await Stk_stocktakesService.get(st, { select: ["stk_status", "_stk_import_value"] } as never), "read the stock take") as unknown as { stk_status?: number; _stk_import_value?: string };
  if (label(Stk_stocktakesstk_status, take.stk_status) !== "Count in progress") throw new Error("The stock take isn't in Count in progress; recounts can't be answered.");
  const xbs = (await all((o) => Stk_xbslinesService.getAll(o), { select: ["stk_xbslineid", "stk_name", "stk_zone", "stk_grade", "stk_stocktype", "_stk_site_value"] as never, filter: `_stk_import_value eq ${take._stk_import_value}` }, "read XBS")) as unknown as { stk_xbslineid: string; stk_name: string; stk_zone?: string; stk_grade?: string; stk_stocktype?: number; _stk_site_value?: string }[];
  const packId = (kg: number) => packs.find((p) => Number(p.stk_kgperbag) === kg)?.stk_packtypeid;
  const tag = `rc-${st.slice(0, 8)}-`;
  let done = 0;
  for (const a of plan.answers) {
    const r = recounts.find((x) => x.stk_recountid === a.recountId);
    const stack = stacks.find((x) => x.stk_stackid === r?._stk_stack_value);
    if (!r || !stack?._stk_site_value) throw new Error(`${a.recount}: its stack isn't in this stock take.`);
    const sheet = sheets.find((x) => x._stk_site_value === stack._stk_site_value)?.stk_countsheetid;
    if (!sheet) throw new Error(`${a.recount}: no count sheet for its warehouse in this stock take.`);
    const f = first(r);
    const x = xbs.find((l) => l.stk_name === r.stk_batch && l._stk_site_value === stack._stk_site_value && l.stk_zone === stack.stk_name);
    const pack = packId(a.packKg) ?? (f?._stk_packtype_value && kgOf.has(f._stk_packtype_value) ? f._stk_packtype_value : undefined);
    if (!pack) throw new Error(`The ${a.packKg} kg packing type is missing in Set-up.`);
    const res = await Stk_countlinesService.create({
      stk_name: `${a.outturn} @ ${stack.stk_name}`.slice(0, 60),
      statecode: 0,
      stk_clientid: `${tag}${a.recount}`.slice(0, 40),
      stk_outturn: a.outturn,
      stk_batch: r.stk_batch ?? `FOUND:${a.outturn}`,
      stk_grade: (x?.stk_grade ?? f?.stk_grade ?? "").slice(0, 30),
      stk_category: code(Stk_countlinesstk_category, x?.stk_stocktype === 614500001 ? "Processing stock" : "Current stock"),
      stk_bags: a.fullBags,
      stk_pocketbags: a.pocketKg > 0 ? 1 : 0,
      stk_pocketkg: Math.round(a.pocketKg * 100) / 100,
      stk_units: a.units,
      stk_kg: a.kg,
      stk_bags60: Math.round((a.kg / 60) * 100) / 100,
      stk_isfound: false,
      stk_isother: false,
      stk_isblind: true,
      stk_countedon: a.at ?? new Date().toISOString(),
      stk_note: `Recount sheet (${file}): ${a.notFound ? "not found" : `${a.fullBags} full bags, pocket ${a.pocketKg} kg, ${a.kg} kg`}${a.by ? `, recounted by ${a.by}` : ""}${a.comment ? `. ${a.comment}` : ""}.`.slice(0, 2000),
      "stk_countsheet@odata.bind": bind("stk_countsheets", sheet),
      "stk_stack@odata.bind": bind("stk_stacks", stack.stk_stackid),
      "stk_site@odata.bind": bind("stk_sites", stack._stk_site_value),
      "stk_packtype@odata.bind": bind("stk_packtypes", pack),
      "stk_recount@odata.bind": bind("stk_recounts", r.stk_recountid),
      ...(x ? { "stk_xbsline@odata.bind": bind("stk_xbslines", x.stk_xbslineid) } : {}),
    } as never);
    if (!res.success && !isDuplicateKey(res.error)) unwrap(res, `save the answer to ${a.recount}`);
    unwrap(await Stk_recountsService.update(r.stk_recountid, { stk_status: code(Stk_recountsstk_status, "Done") } as never), `close ${a.recount}`);
    onProgress?.(++done, plan.answers.length);
  }
}

async function importCounts(plan: CountImportPlan, file: string, onProgress?: (done: number, total: number) => void) {
  const { take, siteRows } = await countImportInputs();
  if (label(Stk_stocktakesstk_status, take.stk_status) !== "Count in progress") throw new Error(`${take.stk_name} isn't in Count in progress; the count can't be loaded into it.`);
  if (plan.errors.length) throw new Error(`${plan.errors.length} line(s) of the file can't be loaded. Fix the file first.`);
  const st = ids.stockTakeId;
  const siteId = new Map(siteRows.map((r) => [r.stk_code as SiteCode, r.stk_siteid]));
  const packs = (await all((o) => Stk_packtypesService.getAll(o), { select: ["stk_packtypeid", "stk_kgperbag"] as never }, "read packing types")) as unknown as { stk_packtypeid: string; stk_kgperbag?: number }[];
  const packOf = (kg: number) => packs.find((p) => Number(p.stk_kgperbag) === kg)?.stk_packtypeid;
  if (plan.lines.some((l) => !packOf(l.packKg))) throw new Error("A packing type (50 or 60 kg) is missing in Set-up.");
  const tag = `old-${st.slice(0, 8)}-`;
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const latest = (xs: { at: string }[]) => (xs.length ? xs.map((x) => x.at).sort().at(-1)! : new Date().toISOString());

  // What an earlier, interrupted load already wrote.
  const sheetRows = (await all((o) => Stk_countsheetsService.getAll(o), { select: ["stk_countsheetid", "stk_name"] as never, filter: `_stk_stocktake_value eq ${st}` }, "read the count sheets")) as unknown as { stk_countsheetid: string; stk_name: string }[];
  const stackRows = (await all((o) => Stk_stacksService.getAll(o), { select: ["stk_stackid", "stk_name", "_stk_site_value"] as never, filter: `_stk_stocktake_value eq ${st}` }, "read the stacks")) as unknown as { stk_stackid: string; stk_name: string; _stk_site_value?: string }[];
  const lineRows = await all((o) => Stk_countlinesService.getAll(o), { select: ["stk_clientid"] as never, filter: `startswith(stk_clientid,'${tag}')` }, "check for an earlier load");
  const haveLine = new Set((lineRows as unknown as { stk_clientid?: string }[]).map((r) => r.stk_clientid));
  const todoLines = plan.lines.filter((l) => !haveLine.has(`${tag}${l.rows[0]}`));
  if (!todoLines.length && haveLine.size) throw new Error(`${file} is already loaded into ${take.stk_name}.`);
  const total = plan.stacks.length + todoLines.length;
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  const sheetOf = new Map<SiteCode, string>();
  for (const site of new Set(plan.stacks.map((x) => x.site))) {
    const name = `CS-OLD-${site}`;
    const had = sheetRows.find((r) => r.stk_name === name);
    const ls = plan.lines.filter((l) => l.site === site);
    const fields = {
      stk_name: name,
      stk_status: code(Stk_countsheetsstk_status, "Submitted"),
      stk_submittedon: latest(ls),
      stk_linecount: ls.length,
      stk_bags: sum(ls, (l) => l.bags),
      stk_countercomment: `Loaded from the old Physical Count app (${file}).`.slice(0, 2000),
    };
    if (had) {
      unwrap(await Stk_countsheetsService.update(had.stk_countsheetid, fields as never), `update ${name}`);
      sheetOf.set(site, had.stk_countsheetid);
    } else {
      const res = unwrap(
        await Stk_countsheetsService.create({ ...fields, statecode: 0, "stk_stocktake@odata.bind": bind("stk_stocktakes", st), "stk_site@odata.bind": bind("stk_sites", siteId.get(site)!) } as never),
        `save ${name}`,
      ) as unknown as { stk_countsheetid: string };
      sheetOf.set(site, res.stk_countsheetid);
    }
  }

  const codeOfId = new Map(siteRows.map((r) => [r.stk_siteid, r.stk_code]));
  const stackId = new Map<string, string>(stackRows.map((r) => [`${codeOfId.get(r._stk_site_value ?? "")}|${r.stk_name}`, r.stk_stackid]));
  const pool = async <T,>(items: T[], fn: (x: T) => Promise<void>) => {
    const q = [...items];
    let failed: unknown;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let x = q.shift(); x !== undefined && !failed; x = q.shift()) await fn(x).catch((e: unknown) => void (failed = e));
      }),
    );
    if (failed) throw failed;
  };
  await pool(plan.stacks, async (s) => {
    const k = `${s.site}|${s.name}`;
    if (!stackId.has(k)) {
      const ls = plan.lines.filter((l) => l.site === s.site && l.stack === s.name);
      const res = unwrap(
        await Stk_stacksService.create({
          stk_name: s.name,
          statecode: 0,
          stk_status: code(Stk_stacksstk_status, "Submitted"),
          stk_submittedon: latest(ls),
          "stk_submittedby@odata.bind": bind("systemusers", ids.me),
          ...(s.landmark ? { stk_landmark: s.landmark } : {}),
          ...(s.comment ? { stk_comment: s.comment } : {}),
          ...(s.finished ? { stk_sitefinished: true } : {}),
          ...(s.nothing ? { stk_nothinghere: true } : {}),
          ...(s.notCounted ? { stk_notcounted: true } : {}),
          "stk_stocktake@odata.bind": bind("stk_stocktakes", st),
          "stk_site@odata.bind": bind("stk_sites", siteId.get(s.site)!),
          "stk_countsheet@odata.bind": bind("stk_countsheets", sheetOf.get(s.site)!),
        } as never),
        `save stack ${s.name}`,
      ) as unknown as { stk_stackid: string };
      stackId.set(k, res.stk_stackid);
    }
    tick();
  });

  await pool(todoLines, async (e) => {
    const res = await Stk_countlinesService.create({
      stk_name: `${e.outturn} @ ${e.stack}`.slice(0, 60),
      statecode: 0,
      stk_clientid: `${tag}${e.rows[0]}`,
      stk_outturn: e.outturn,
      stk_batch: e.lot?.batch ?? `FOUND:${e.outturn}`, // as the counter app saves a lot XBS doesn't have, so two of them on one stack stay apart
      stk_grade: e.grade.slice(0, 30),
      stk_category: code(Stk_countlinesstk_category, e.lot?.bfp ? "Processing stock" : "Current stock"),
      stk_bags: e.bags,
      stk_pocketbags: e.pocketBags,
      stk_pocketkg: Math.round(e.pocketKg * 100) / 100,
      stk_units: e.bags + e.pocketBags,
      stk_kg: Math.round(e.kg * 100) / 100,
      stk_bags60: Math.round((e.kg / 60) * 100) / 100,
      stk_reason: e.found ? code(Stk_countlinesstk_reason, "Bags moved here, not yet received in XBS") : null,
      stk_isfound: e.found,
      stk_isother: false,
      stk_isblind: false,
      stk_countedon: e.at,
      stk_note: `Old app: counted by ${e.clerks.join(", ")}${e.rows.length > 1 ? ` on ${e.rows.length} lines (CSV ${e.rows.join(", ")})` : ` (CSV line ${e.rows[0]})`}.`.slice(0, 2000),
      "stk_countsheet@odata.bind": bind("stk_countsheets", sheetOf.get(e.site)!),
      "stk_stack@odata.bind": bind("stk_stacks", stackId.get(`${e.site}|${e.stack}`)!),
      "stk_site@odata.bind": bind("stk_sites", siteId.get(e.site)!),
      "stk_packtype@odata.bind": bind("stk_packtypes", packOf(e.packKg)!),
      ...(e.lot ? { "stk_xbsline@odata.bind": bind("stk_xbslines", e.lot.id) } : {}),
    } as never);
    if (!res.success && !isDuplicateKey(res.error)) unwrap(res, `save ${e.outturn}`);
    tick();
  });
}

/** Day settings (AfloatAgeingDays "30,60", ThirdPartyAgeingDays, ThirdPartyAgeDays): ascending whole days; anything else -> the default. */
const ageingDays = (v?: string) => {
  const d = (v ?? "").split(/[,; ]+/).map(Number).filter((x) => Number.isInteger(x) && x > 0);
  return d.length ? [...new Set(d)].sort((a, b) => a - b) : undefined;
};

/**
 * XBS stuffing dates are a snapshot like the tracker, but a stock take takes one report per month
 * (the look-back spans three): rows already saved are skipped, so a report loads once.
 */
async function importXbsStuffing(u: XbsStuffingUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; XBS stuffing dates are loaded for it.");
  const saved = (await all((o) => Stk_xbsstuffingsService.getAll(o), { select: ["stk_key"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "check the XBS stuffing dates")) as unknown as { stk_key?: string }[];
  const have = new Set(saved.map((r) => r.stk_key));
  const keyOf = (x: XbsStuffing) => `${x.salesContract}|${x.si}|${x.stuffedOn}`.slice(0, 60);
  const queue = u.rows.filter((x) => !have.has(keyOf(x)));
  if (!queue.length) throw new Error(`Every stuffing in ${u.file} is already loaded for this stock take.`);
  let done = u.rows.length - queue.length;
  let failed = false;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let x = queue.shift(); x && !failed; x = queue.shift()) {
        const res = await Stk_xbsstuffingsService.create({
          stk_name: `${x.salesContract} · SI ${x.si || "-"} · ${x.stuffedOn}`.slice(0, 100),
          statecode: 0,
          stk_key: keyOf(x),
          stk_source: u.file.slice(0, 200),
          stk_salescontract: x.salesContract.slice(0, 20),
          stk_si: x.si.slice(0, 20),
          stk_stuffedon: x.stuffedOn,
          stk_bags: Math.round(x.bags * 100) / 100,
          stk_lots: x.lots,
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        } as never);
        if (!res.success && !isDuplicateKey(res.error)) {
          failed = true;
          unwrap(res, `save XBS stuffing ${x.salesContract}`);
        }
        onProgress?.(++done, u.rows.length);
      }
    }),
  );
}

/** Both report tables are written the same way (same shared columns): one service type for either. */
const transferService = (kind: "transfers" | "tickets") =>
  (kind === "transfers" ? Stk_transferlinesService : Stk_weighticketsService) as unknown as typeof Stk_transferlinesService;

/**
 * XBS's stock transfer or ticket report for the active stock take. Each report is a copy keyed by its
 * time; a load that stopped part way is finished with the same file (rows already saved are skipped).
 */
async function importTransfers(u: TransferUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the transfer and ticket reports are loaded for it.");
  if (!u.reportedAt) throw new Error(`${u.file}: can't tell when XBS produced it (no "Report Generated On" and no time in the file name).`);
  const t = new Date(u.reportedAt);
  const stampOf = `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}${pad2(t.getUTCHours())}${pad2(t.getUTCMinutes())}`;
  const service = transferService(u.kind);
  const saved = (await all((o) => service.getAll(o), { select: ["stk_key"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "check the loaded reports")) as unknown as { stk_key?: string }[];
  const have = new Set(saved.map((r) => r.stk_key));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const st = { "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId) };
  const base = { statecode: 0, stk_source: u.file.slice(0, 200), stk_reportedat: u.reportedAt };
  const rows: { key: string; body: Record<string, unknown> }[] =
    u.kind === "transfers"
      ? u.transfers.map((x) => ({
          key: `${stampOf}|${x.row}`,
          body: {
            ...base,
            stk_name: `${x.instruction} · ${x.batch}`.slice(0, 100),
            stk_rownumber: x.row,
            stk_instruction: x.instruction.slice(0, 30),
            stk_type: x.type.slice(0, 100),
            stk_instructedon: x.instructedOn ?? null,
            stk_outturn: x.outturn.slice(0, 30),
            stk_batch: x.batch.slice(0, 100),
            stk_grade: x.grade.slice(0, 50),
            stk_fromzone: x.fromZone.slice(0, 100),
            stk_tozone: x.toZone.slice(0, 100),
            stk_instructedkg: r2(x.instructedKg),
            stk_issuedkg: r2(x.issuedKg),
            stk_issuedon: x.issuedOn ?? null,
            stk_receivedkg: r2(x.receivedKg),
            stk_receivedon: x.receivedOn ?? null,
            stk_gainkg: r2(x.gainKg),
            stk_missingkg: r2(x.missingKg),
            stk_balancekg: r2(x.balanceKg),
            stk_status: x.status.slice(0, 30),
            stk_ticket: x.ticket ?? null,
          },
        }))
      : u.tickets.map((x) => ({
          key: `${stampOf}|${x.ticket}`,
          body: {
            ...base,
            stk_name: x.ticket.slice(0, 100),
            stk_type: x.type.slice(0, 100),
            stk_status: x.status.slice(0, 30),
            stk_arrivedon: x.arrivedOn ?? null,
            stk_netkg: r2(x.netKg),
            stk_grossqtykg: r2(x.grossQtyKg),
            stk_variancekg: r2(x.varianceKg),
            stk_units: Math.round(x.units),
            stk_vehicle: x.vehicle.slice(0, 30),
            stk_items: x.items.join(",").slice(0, 200),
          },
        }));
  const queue = rows.filter((r) => !have.has(r.key));
  if (!queue.length) throw new Error(`${u.file} is already loaded for this stock take.`);
  let done = rows.length - queue.length;
  let failed = false;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let x = queue.shift(); x && !failed; x = queue.shift()) {
        const res = await service.create({ ...x.body, stk_key: x.key, ...st } as never);
        if (!res.success && !isDuplicateKey(res.error)) {
          failed = true;
          unwrap(res, `save ${u.file} row ${x.key}`);
        }
        onProgress?.(++done, rows.length);
      }
    }),
  );
}

/** The tracker is a snapshot like XBS and the 537: loaded once per stock take, never changed. */
async function importShipments(u: ShipmentUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the shipment tracker is loaded for it.");
  // A load that stopped part way can be finished with the same file: rows already saved are skipped.
  const saved = (await all((o) => Stk_shipmentsService.getAll(o), { select: ["stk_rownumber", "stk_source"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId}` }, "check the shipment tracker")) as unknown as { stk_rownumber?: number; stk_source?: string }[];
  if (saved.length && (saved.length >= u.lines.length || saved.some((r) => r.stk_source !== u.file.slice(0, 200))))
    throw new Error("A shipment tracker is already loaded for this stock take. Snapshots are never re-imported or changed.");
  const have = new Set(saved.map((r) => r.stk_rownumber));
  const d = (iso?: string) => iso || null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  let done = have.size;
  let failed = false;
  const queue = u.lines.filter((l) => !have.has(l.row));
  // A few at a time, like the 537. Stock take + row number is a key, so a resent line is never doubled.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let l = queue.shift(); l && !failed; l = queue.shift()) {
        const res = await Stk_shipmentsService.create({
          stk_name: `${l.salesContract} · SI ${l.si || "-"}`.slice(0, 100),
          statecode: 0,
          stk_rownumber: l.row,
          stk_source: u.file.slice(0, 200),
          stk_salescontract: l.salesContract.slice(0, 20),
          stk_purchasecontract: l.purchaseContract.slice(0, 40),
          stk_si: l.si.slice(0, 20),
          stk_buyer: l.buyer.slice(0, 100),
          stk_bags: r2(l.bags),
          stk_qualitycode: l.qualityCode.slice(0, 10),
          stk_quality: l.quality.slice(0, 100),
          stk_packaging: l.packaging.slice(0, 60),
          stk_destination: l.destination.slice(0, 60),
          stk_contractdate: d(l.contractDate),
          stk_stuffedon: d(l.stuffedOn),
          stk_sailedon: d(l.sailedOn),
          stk_etapod: d(l.etaPod),
          stk_bl: l.bl.slice(0, 40),
          stk_vessel: l.vessel.slice(0, 100),
          stk_status: l.status.slice(0, 20),
          stk_usdvalue: r2(l.usdValue),
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        } as never);
        if (!res.success && !isDuplicateKey(res.error)) {
          failed = true;
          unwrap(res, `save shipment row ${l.row}`);
        }
        onProgress?.(++done, u.lines.length);
      }
    }),
  );
}

/** The Comtras position is a snapshot like XBS: loaded once per stock take, never changed. */
async function importComtras(u: ComtrasUpload, onProgress?: (done: number, total: number) => void) {
  if (!ids.stockTakeId || ids.stockTakeId === NO_STOCK_TAKE) throw new Error("Start the stock take first; the Comtras position is loaded for it.");
  const already = await all((o) => Stk_comtraspositionsService.getAll(o), { select: ["stk_name"], filter: `_stk_stocktake_value eq ${ids.stockTakeId}`, top: 1 }, "check the Comtras position");
  if (already.length) throw new Error("A Comtras position is already loaded for this stock take. Comtras snapshots are never re-imported or changed.");
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const l of u.lines) {
    unwrap(
      await Stk_comtraspositionsService.create({
        stk_name: `${l.lineType} ${l.contract} ${l.quality}`.slice(0, 100),
        statecode: 0,
        stk_snapshotdate: today,
        stk_basketcode: l.quality.slice(0, 10),
        stk_bags: Math.round(l.bags60 * 100) / 100,
        stk_kg: Math.round(l.kg * 100) / 100,
        stk_linetype: l.lineType,
        stk_contract: l.contract.slice(0, 20),
        stk_origin: l.origin.slice(0, 60),
        stk_counterparty: l.counterparty.slice(0, 60),
        stk_source: u.file.slice(0, 200),
        "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      } as never),
      `save Comtras line ${l.contract}`,
    );
    onProgress?.(++done, u.lines.length);
  }
}

async function importXbs(u: XbsUploadToSave, onProgress?: (done: number, total: number) => void) {
  // XBS is never changed: an upload becomes a new, locked import.
  const t = u.snapshotAt ? new Date(u.snapshotAt) : new Date();
  const name = `IMP-${String(t.getFullYear()).slice(2)}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}-${pad2(t.getHours())}${pad2(t.getMinutes())}`;
  if (ids.importId.has(name)) throw new Error(`${name} is already imported — XBS snapshots are never re-imported or changed`);
  const header = unwrap(
    await Stk_xbsimportsService.create({
      stk_name: name,
      statecode: 0,
      stk_snapshotat: t.toISOString(),
      stk_filenames: u.files.join("\n"),
      stk_rowcount: u.lines.length,
      stk_status: code(Stk_xbsimportsstk_status, "Validating"),
      stk_checks: u.checks,
      stk_warningcount: u.warnings,
      stk_failcount: u.fails,
      "stk_importedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    "start the import",
  );
  const importId = header.stk_xbsimportid;
  let done = 0;
  let failed: Error | undefined;
  const queue = u.lines.map((l, i) => ({ l, row: i + 1 }));
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length && !failed) {
        const { l, row } = queue.shift()!;
        const res = await Stk_xbslinesService.create({
          stk_name: l.b,
          statecode: 0,
          stk_rownumber: row,
          stk_stocktype: l.t === "W" ? 614500000 : 614500001,
          stk_zone: l.z ?? null,
          stk_outturn: l.o,
          stk_grade: l.i,
          stk_basketcode: l.bc ?? null,
          stk_basketname: l.bn ?? null,
          stk_bags: l.bg,
          stk_pocketkg: l.pk,
          stk_units: l.u,
          stk_kg: l.kg,
          stk_growermark: l.g ?? null,
          stk_warrant: l.wr ?? null,
          stk_certification: l.c ?? null,
          stk_cupscore: l.cs ?? null,
          stk_blocked: l.bl,
          stk_salescontract: l.so ?? null,
          stk_instruction: l.in ?? null,
          stk_daysinstock: l.d ?? null,
          stk_cropyear: l.cy ?? null,
          "stk_import@odata.bind": bind("stk_xbsimports", importId),
          "stk_site@odata.bind": bind("stk_sites", ids.site.get(l.wh)!),
        } as never);
        if (!res.success) failed = new Error(`row ${row}: ${res.error?.message ?? "not saved"}`);
        onProgress?.(++done, u.lines.length);
      }
    }),
  );
  if (failed) {
    await Stk_xbsimportsService.update(importId, { stk_status: code(Stk_xbsimportsstk_status, "Failed") } as never);
    throw new Error(`the import stopped at ${failed.message}. It's marked Failed; fix the file and import again.`);
  }
  // Older imports stay for history, marked Superseded.
  const imported = code(Stk_xbsimportsstk_status, "Imported");
  for (const [, id] of ids.importId) {
    const old = await Stk_xbsimportsService.get(id, { select: ["stk_status"] });
    if (old.success && old.data.stk_status === imported)
      await Stk_xbsimportsService.update(id, { stk_status: code(Stk_xbsimportsstk_status, "Superseded") } as never);
  }
  unwrap(await Stk_xbsimportsService.update(importId, { stk_status: imported } as never), "finish the import");
  ids.importId.set(name, importId);
  return name;
}

/** "31/08/2026" (or an ISO date) → "2026-08-31"; today if it can't be read. */
function isoDay(d: string) {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

async function createStockTake(st: StockTake) {
  const importId = ids.importId.get(st.importId);
  if (!importId) throw new Error(`XBS import ${st.importId} not found`);
  const created = unwrap(
    await Stk_stocktakesService.create({
      stk_name: st.title,
      statecode: 0,
      stk_type: code(Stk_stocktakesstk_type, choiceOfType(st.type)),
      stk_scope: scopeJson(st.scope),
      stk_status: code(Stk_stocktakesstk_status, "Count in progress"),
      stk_countdate: isoDay(st.countDate),
      "stk_import@odata.bind": bind("stk_xbsimports", importId),
    } as never),
    "create the stock take",
  );
  const newId = created.stk_stocktakeid;
  ids.stockTake.set(st.id, newId);
  ids.stockTake.set(st.title, newId);
  // Counters keep their areas until a new allocation is published: copy the current stock take's
  // active assignments (none on the very first stock take). An ad hoc count covers only its scope,
  // so it starts with no areas: allocate counters to the chosen sections.
  const current =
    st.type !== "Ad hoc stock take" && ids.stockTakeId && ids.stockTakeId !== NO_STOCK_TAKE
      ? await all(
          (o) => Stk_assignmentsService.getAll(o),
          { select: ["stk_name", "stk_rows", "stk_sections", "_stk_site_value", "_stk_counter_value"] as never, filter: `_stk_stocktake_value eq ${ids.stockTakeId} and statecode eq 0` },
          "read assignments",
        )
      : [];
  for (const a of current)
    unwrap(
      await Stk_assignmentsService.create({
        stk_name: a.stk_name,
        statecode: 0,
        stk_rows: a.stk_rows ?? null,
        stk_sections: (a as { stk_sections?: string }).stk_sections ?? null,
        "stk_stocktake@odata.bind": bind("stk_stocktakes", newId),
        "stk_counter@odata.bind": bind("systemusers", a._stk_counter_value!),
        "stk_site@odata.bind": bind("stk_sites", a._stk_site_value!),
      } as never),
      "copy assignments",
    );
}

async function closeStockTake(idOrName: string, comment: string) {
  const id = ids.stockTake.get(idOrName);
  if (!id) throw new Error(`Stock take ${idOrName} not found`);
  unwrap(
    await Stk_stocktakesService.update(id, {
      stk_status: code(Stk_stocktakesstk_status, "Completed"),
      stk_closedon: new Date().toISOString(),
      stk_closecomment: comment || null,
    } as never),
    `close ${idOrName}`,
  );
}

async function addSignoff(gate: Gate, action: "signed" | "sent back", comment: string) {
  const chain = chainFor(ids.stockTakeType);
  if (!chain.some((g) => g.gate === gate)) throw new Error(`the ${gate} doesn't sign this type of stock take`);
  const signed = Object.fromEntries([...ids.signedBy.keys()].map((g) => [g, true]));
  if (!openGates(chain, signed).some((g) => g.gate === gate)) throw new Error(`it isn't the ${gate}'s turn to sign yet`);
  if (action === "sent back" && !comment.trim()) throw new Error("say why it's being sent back");
  if (action === "signed" && ids.enforceSoD) {
    const other = [...ids.signedBy].find(([g, by]) => g !== gate && by === ids.me)?.[0];
    if (other) throw new Error(`you signed as ${other}, and one person signs one gate`);
    const who = ids.signers[gate];
    const mine = ((await getContext()).user.userPrincipalName ?? "").toLowerCase();
    const allowed = [who?.email, who?.standIn?.email].filter(Boolean).map((e) => e!.toLowerCase());
    if (allowed.length && !allowed.includes(mine))
      throw new Error(`the ${gate} gate is signed by ${who!.name}${who!.standIn ? ` or ${who!.standIn.name}` : ""}`);
  }
  unwrap(
    await Stk_signoffsService.create({
      stk_name: `${gate} · ${action === "signed" ? "signed" : "sent back"}`,
      statecode: 0,
      stk_gate: code(Stk_signoffsstk_gate, gate),
      stk_action: code(Stk_signoffsstk_action, action === "signed" ? "Signed" : "Sent back"),
      stk_signedon: new Date().toISOString(),
      stk_comment: comment || null,
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      "stk_signedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    `record the ${gate} sign-off`,
  );
  if (action === "sent back") {
    ids.signedBy.clear();
    return ids.me;
  }
  ids.signedBy.set(gate, ids.me);
  // Move the stock take into Sign-off once the first gate signs.
  await Stk_stocktakesService.update(ids.stockTakeId, { stk_status: code(Stk_stocktakesstk_status, "Sign-off") } as never);
  return ids.me;
}

/** The SignOffSigners setting; a gate with no usable entry is left out. */
function parseSigners(json?: string | null): Partial<Record<Gate, Signer>> {
  try {
    const raw = json ? (JSON.parse(json) as Record<string, Signer>) : {};
    return Object.fromEntries(Object.entries(raw).filter(([g, s]) => GATES.some((x) => x.gate === g) && s?.name)) as Partial<Record<Gate, Signer>>;
  } catch {
    console.warn("SignOffSigners isn't valid JSON; using the names in the app.");
    return {};
  }
}

/** One load at a time: React's development double-mount (and quick reloads) must not run the variance sync twice in parallel. */
let loading: Promise<MgmtData> | undefined;
const loadOnce = () => (loading ??= load().finally(() => (loading = undefined)));

const writable: DataSource = {
  getL1Pdf,
  saveKpis,
  askAssistant,
  kind: "dataverse",
  load: loadOnce,
  createStockTake,
  closeStockTake,
  importXbs,
  importComtras,
  importContracts,
  importShipments,
  importXbsStuffing,
  importTransfers,
  importSubProducts,
  importDirectLots,
  planCounts,
  importCounts,
  planRecounts,
  importRecounts,
  addReconItem,
  removeReconItem,
  addComment,
  decideSheet,
  decideVariance,
  recountLine,
  saveCounterProfile,
  publishAllocation,
  addException,
  updateException,
  requestMapping,
  decideMapping,
  setManualEntry,
  updateIssue,
  photo,
  addDirectPurchase,
  addSignoff,
  viewStockTake,
};

/** While a past stock take is being looked at (viewing), every action that writes is refused. */
let viewing = false;
const READS = new Set(["kind", "load", "viewStockTake", "getL1Pdf", "askAssistant", "planCounts", "photo"]);
export const dataverseSource: DataSource = Object.fromEntries(
  Object.entries(writable).map(([k, f]) => [
    k,
    typeof f !== "function" || READS.has(k)
      ? f
      : k === "saveKpis"
        ? (...a: unknown[]) => (viewing ? Promise.resolve() : (f as (...x: unknown[]) => unknown)(...a))
        : (...a: unknown[]) =>
            viewing
              ? Promise.reject(new Error("You're looking at a past stock take: it's read-only. Go back to the current stock take to make changes."))
              : (f as (...x: unknown[]) => unknown)(...a),
  ]),
) as unknown as DataSource;

