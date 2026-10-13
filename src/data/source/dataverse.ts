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
import { Stk_basketmapsstk_primarybasket } from "../../generated/models/Stk_basketmapsModel";
import { Stk_signoffsstk_action, Stk_signoffsstk_gate } from "../../generated/models/Stk_signoffsModel";
import { Stk_mappingchangesstk_state, Stk_mappingchangesstk_target } from "../../generated/models/Stk_mappingchangesModel";
import { Stk_recountsstk_status } from "../../generated/models/Stk_recountsModel";
import { Stk_variancesstk_cause, Stk_variancesstk_state, Stk_variancesstk_suggestedcause } from "../../generated/models/Stk_variancesModel";
import {
  Stk_exceptionsstk_department,
  Stk_exceptionsstk_escalationlevel,
  Stk_exceptionsstk_kind,
  Stk_exceptionsstk_source,
  Stk_exceptionsstk_status,
} from "../../generated/models/Stk_exceptionsModel";
import { draftVariances, type CountFact } from "../variance-rules";
import type {
  AuditEntry,
  BasketMap,
  Counter,
  CountRow,
  CountSheet,
  Dept,
  DirectPurchase,
  Exception,
  StackInfo,
  ImportStatus,
  Role,
  MappingChange,
  PrimaryBasket,
  Issue,
  RootCause,
  SheetStatus,
  Site,
  SiteCode,
  StockTake,
  StockTakeStatus,
  UserRow,
  Variance,
  XbsImport,
  XbsLine,
} from "../types";
import type { DataSource, MgmtData, Signature, Today, XbsUploadToSave } from "./types";
import { MATCH_TOLERANCE_KG } from "../../shared/count-rules";
import { CHAIN } from "../repository";

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
  exception: new Map<string, string>(), // EX-### → id
  issue: new Map<string, string>(), // C-### → id
  change: new Map<string, { id: string; by?: string }>(), // MC-### → id + requester
  basket: new Map<string, string>(), // basket code → stk_basketmap id
  outturnMap: new Map<string, string>(), // outturn → stk_outturnmap id
  site: new Map<SiteCode, string>(),
  importId: new Map<string, string>(), // IMP-… → id
  stockTake: new Map<string, string>(), // stock take name (and app id) → id
  preparedBy: "" as string | undefined,
  enforceSoD: true,
  person: new Map<string, string>(), // display name → systemuserid
  slaDays: 5,
};

function addWorkingDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

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

async function load(): Promise<MgmtData> {
  ids.me = (await signedInUser()).id;

  const [stockTakeRows, siteRows, packRows, settingRows, importRows] = await Promise.all([
    all((o) => Stk_stocktakesService.getAll(o), { select: ["stk_stocktakeid", "stk_name", "stk_type", "stk_status", "stk_countdate", "_stk_import_value", "_createdby_value", "_stk_preparedby_value"] as never, orderBy: ["stk_countdate desc"] }, "read stock takes"),
    all((o) => Stk_sitesService.getAll(o), { select: ["stk_siteid", "stk_code", "stk_name", "stk_shortname", "stk_isthirdparty", "stk_manualentry"], orderBy: ["stk_isthirdparty asc", "stk_name asc"] }, "read warehouses"),
    all((o) => Stk_packtypesService.getAll(o), { select: ["stk_code", "stk_name", "stk_kgperbag", "stk_gradepattern"] }, "read packing types"),
    all((o) => Stk_settingsService.getAll(o), { select: ["stk_name", "stk_value"] }, "read settings"),
    all((o) => Stk_xbsimportsService.getAll(o), { select: ["stk_xbsimportid", "stk_name", "stk_snapshotat", "stk_filenames", "stk_rowcount", "stk_status", "stk_failcount", "stk_warningcount", "_stk_importedby_value", "createdon"], orderBy: ["createdon desc"] }, "read XBS imports"),
  ]);
  if (!stockTakeRows.length) throw new Error("There are no stock takes yet. Create one, or run the seed script.");
  const active = stockTakeRows.find((r) => label(Stk_stocktakesstk_status, r.stk_status) !== "Completed") ?? stockTakeRows[0];
  ids.stockTakeId = active.stk_stocktakeid;
  ids.preparedBy = (active as unknown as { _stk_preparedby_value?: string })._stk_preparedby_value;
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
  ids.enforceSoD = (settingRows.find((x) => x.stk_name === "EnforceSeparationOfDuties")?.stk_value ?? "true").toLowerCase() !== "false";
  for (const r of siteRows) ids.site.set(r.stk_code as SiteCode, r.stk_siteid);
  const siteIdOf = new Map<SiteCode, string>(siteRows.map((r) => [r.stk_code as SiteCode, r.stk_siteid]));

  // XBS lines of the active stock take's import.
  const xbs = await all(
    (o) => Stk_xbslinesService.getAll(o),
    {
      select: [
        "stk_name", "stk_stocktype", "_stk_site_value", "stk_zone", "stk_outturn", "stk_grade", "stk_basketcode", "stk_basketname", "stk_bags", "stk_pocketkg",
        "stk_units", "stk_kg", "stk_growermark", "stk_warrant", "stk_certification", "stk_cupscore", "stk_blocked", "stk_salescontract", "stk_instruction",
        "stk_daysinstock", "stk_cropyear", "stk_rownumber",
      ],
      filter: `_stk_import_value eq ${active._stk_import_value}`,
      orderBy: ["stk_rownumber asc"],
    },
    "read the XBS stock",
  );
  const lines: XbsLine[] = xbs.map((r) => ({
    t: r.stk_stocktype === 614500001 ? "B" : "W",
    wh: siteCode.get(r._stk_site_value!)!,
    z: r.stk_zone ?? undefined,
    b: r.stk_name,
    o: r.stk_outturn ?? "",
    i: r.stk_grade ?? "",
    bc: r.stk_basketcode ?? undefined,
    bn: r.stk_basketname ?? undefined,
    bg: r.stk_bags ?? 0,
    pk: Number(r.stk_pocketkg ?? 0),
    u: r.stk_units ?? 0,
    kg: Number(r.stk_kg ?? 0),
    g: r.stk_growermark ?? undefined,
    wr: r.stk_warrant ?? undefined,
    c: r.stk_certification ?? undefined,
    cs: r.stk_cupscore ?? undefined,
    bl: !!r.stk_blocked,
    so: r.stk_salescontract ?? undefined,
    in: r.stk_instruction ?? undefined,
    d: r.stk_daysinstock ?? undefined,
    cy: r.stk_cropyear ?? undefined,
  }));

  // Count work on the active stock take.
  const [sheetRows, assignmentRows, stackRows, recountRows] = await Promise.all([
    all((o) => Stk_countsheetsService.getAll(o), { select: ["stk_countsheetid", "stk_name", "stk_status", "stk_submittedon", "stk_countercomment", "stk_decisioncomment", "stk_linecount", "stk_variancecount", "stk_bags", "_stk_site_value", "_stk_assignment_value", "_stk_stocktake_value", "_createdby_value"] }, "read count sheets"),
    all((o) => Stk_assignmentsService.getAll(o), { select: ["stk_assignmentid", "stk_rows", "_stk_site_value", "_stk_counter_value", "_stk_stocktake_value"], filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` }, "read assignments"),
    all((o) => Stk_stacksService.getAll(o), { select: ["stk_stackid", "stk_name", "_stk_site_value", "stk_status"], filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` }, "read stacks"),
    all((o) => Stk_recountsService.getAll(o), { select: ["stk_recountid", "_ownerid_value"] as never, filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}` }, "read recounts"),
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
    { select: ["systemuserid", "fullname"], filter: "isdisabled eq false and accessmode eq 0", orderBy: ["fullname asc"], top: 200 },
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
    ...issueRows.flatMap((r) => [r._createdby_value, r._stk_assignedto_value]),
  ]);
  const nm = (id?: string) => (id ? (who.get(id) ?? "Someone") : "");

  /* variances: generate from submitted stacks, then read back */
  for (const r of activeSheets) ids.sheet.set(r.stk_name, r.stk_countsheetid);
  const stackOf = new Map(stackRows.map((r) => [r.stk_stackid, { site: siteCode.get(r._stk_site_value!)!, name: r.stk_name }]));
  for (const st of stackRows) {
    const sheetId = activeSheets.find((x) => countRows.some((c) => c._stk_countsheet_value === x.stk_countsheetid && c._stk_stack_value === st.stk_stackid))?.stk_countsheetid;
    if (sheetId) ids.sheetStacks.set(sheetId, [...(ids.sheetStacks.get(sheetId) ?? []), st.stk_stackid]);
  }
  const submittedStates = new Set(["Submitted", "Approved", "Sent back"]);
  const submittedStacks = stackRows
    .filter((r) => submittedStates.has(label(Stk_stacksstk_status, r.stk_status) ?? ""))
    .map((r) => ({ site: siteCode.get(r._stk_site_value!)!, stack: r.stk_name }));
  const facts: CountFact[] = countRows.map((c) => ({
    lineId: c.stk_countlineid,
    site: siteCode.get(c._stk_site_value!)!,
    stack: stackOf.get(c._stk_stack_value!)?.name ?? "",
    batch: c.stk_batch ?? "",
    outturn: c.stk_outturn ?? "",
    grade: c.stk_grade ?? "",
    units: c.stk_units ?? (c.stk_bags ?? 0) + (c.stk_pocketbags ?? 0),
    kg: Number(c.stk_kg ?? 0),
    by: nm(c._createdby_value),
    at: hhmm(c.stk_countedon),
    other: !!c.stk_isother,
  }));
  const thirdParty = new Set(sites.filter((x) => x.thirdParty).map((x) => x.code));
  const drafts = draftVariances(facts, lines, submittedStacks, thirdParty, (c) => sites.find((x) => x.code === c)?.short ?? c);
  await syncVariances(drafts, stackRows, countRows, siteIdOf, thirdParty);

  const [varianceRows, exceptionRows] = await Promise.all([
    all(
      (o) => Stk_variancesService.getAll(o),
      {
        select: ["stk_varianceid", "stk_name", "_stk_site_value", "_stk_stack_value", "stk_outturn", "stk_grade", "stk_expectedunits", "stk_countedunits", "stk_expectedkg", "stk_countedkg", "stk_suggestedcause", "stk_suggestionwhy", "stk_cause", "stk_state", "_stk_countline_value", "createdon"],
        filter: `_stk_stocktake_value eq ${active.stk_stocktakeid}`,
        orderBy: ["stk_name asc"],
      },
      "read variances",
    ),
    all(
      (o) => Stk_exceptionsService.getAll(o),
      { select: ["stk_exceptionid", "stk_name", "stk_kind", "stk_source", "stk_reference", "stk_department", "stk_bags", "stk_duedate", "stk_status", "stk_escalationlevel", "stk_resolution", "createdon", "_ownerid_value"] as never, orderBy: ["createdon desc"] },
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
      batch: line?.stk_batch ?? "",
      counterId: line?._createdby_value,
      lineId: v._stk_countline_value,
      siteId: v._stk_site_value,
    });
    const state = label(Stk_variancesstk_state, v.stk_state) ?? "Open";
    return {
      id: v.stk_name,
      photo: photoOf.get(v._stk_countline_value),
      site,
      zone: thirdParty.has(site) ? `${sites.find((x) => x.code === site)?.short} · ${where?.name ?? ""}` : (where?.name ?? ""),
      outturn: v.stk_outturn ?? "",
      grade: v.stk_grade ?? "",
      expected: v.stk_expectedunits ?? 0,
      counted: v.stk_countedunits ?? 0,
      expectedKg: v.stk_expectedkg ?? undefined,
      countedKg: v.stk_countedkg ?? undefined,
      cause: (label(Stk_variancesstk_cause, v.stk_cause) ?? label(Stk_variancesstk_suggestedcause, v.stk_suggestedcause) ?? "Not yet known") as RootCause,
      why: v.stk_suggestionwhy ?? "",
      counter: line ? nm(line._createdby_value) : "—",
      at: line?.stk_countedon ? stamp(line.stk_countedon) : stamp(v.createdon),
      state: ({ Open: "open", "Recount sent": "recount", Accepted: "accepted", "Exception raised": "exception" } as const)[state as "Open"] ?? "open",
      ageHours: v.createdon ? Math.round((Date.now() - new Date(v.createdon).getTime()) / 36e5) : 0,
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
    };
  });

  /* stock takes */
  const importName = new Map(importRows.map((r) => [r.stk_xbsimportid, r.stk_name]));
  const stockTakes: StockTake[] = stockTakeRows.map((r) => {
    const sh = sheetRows.filter((x) => x._stk_stocktake_value === r.stk_stocktakeid).map((x) => label(Stk_countsheetsstk_status, x.stk_status));
    return {
      id: r.stk_name,
      title: r.stk_name,
      type: label(Stk_stocktakesstk_type, r.stk_type) === "100% (zero-out)" ? "100% stock take" : "Monthly stock take",
      status: (label(Stk_stocktakesstk_status, r.stk_status) ?? "Count in progress") as StockTakeStatus,
      countDate: day(r.stk_countdate),
      importId: importName.get(r._stk_import_value!) ?? "",
      sites: sites.map((x) => x.code),
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
  const sheets: CountSheet[] = activeSheets.map((r) => {
    const mine = countRows.filter((c) => c._stk_countsheet_value === r.stk_countsheetid);
    return {
      id: r.stk_name,
      counter: nm(r._createdby_value),
      site: siteCode.get(r._stk_site_value!) ?? "IBR",
      area: areaOf(assignment.get(r._stk_assignment_value!)),
      status: SHEET_STATUS[label(Stk_countsheetsstk_status, r.stk_status) ?? "In progress"] ?? "In progress",
      lots: r.stk_linecount ?? mine.length,
      variances: r.stk_variancecount ?? mine.filter((c) => c.stk_reason != null || c.stk_isfound).length,
      bags: r.stk_bags ?? mine.reduce((a, c) => a + (c.stk_bags ?? 0), 0),
      submittedAt: r.stk_submittedon ? stamp(r.stk_submittedon) : undefined,
      comment: r.stk_decisioncomment ?? r.stk_countercomment ?? undefined,
    };
  });

  /* count day: counters, bags per hour, bags per site */
  const recountsByOwner = new Map<string, number>();
  for (const r of recountRows as unknown as { _ownerid_value?: string }[]) if (r._ownerid_value) recountsByOwner.set(r._ownerid_value, (recountsByOwner.get(r._ownerid_value) ?? 0) + 1);
  const counters: Counter[] = assignmentRows.map((a) => {
    const theirs = countRows.filter((c) => c._createdby_value === a._stk_counter_value);
    const first = theirs.map((c) => (c.stk_countedon ? new Date(c.stk_countedon).getHours() : 24)).sort((x, y) => x - y)[0];
    return {
      name: nm(a._stk_counter_value),
      site: siteCode.get(a._stk_site_value!) ?? "IBR",
      area: areaOf(a),
      bagsSoFar: theirs.reduce((s, c) => s + (c.stk_bags ?? 0), 0),
      startedAt: first == null || first === 24 ? 7 : first,
      recounts: recountsByOwner.get(a._stk_counter_value!) ?? 0,
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
    const expected = lines.filter((l) => l.b === c.stk_batch && l.wh === site && (site !== "IBR" || l.z === stack));
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
  const signatures: Partial<Record<Role, Signature>> = {};
  for (const x of signRows) {
    if (label(Stk_signoffsstk_action, x.stk_action) === "Sent back") {
      for (const k of Object.keys(signatures)) delete signatures[k as Role];
      continue;
    }
    const gate = CHAIN.find((c) => c.title === label(Stk_signoffsstk_gate, x.stk_gate));
    if (gate) signatures[gate.role] = { by: who4.get(x._stk_signedby_value ?? "") ?? "Someone", at: stamp(x.stk_signedon), comment: x.stk_comment ?? undefined };
  }

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
  const counts: CountRow[] = countRows.map((c) => {
    const x = c as typeof c & { stk_pocketkg?: number; stk_category?: number; _stk_recount_value?: string };
    return {
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
  }));

  return {
    counts,
    stacks,
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
      // Shipment tracker isn't in Dataverse yet, so the contract checks have nothing to compare against.
      contracts: { cancelled: [], shipped: [], stuffed: [] },
      people: [...ids.person.keys()],
      physDelta,
      comtrasDelta: {},
    },
    stockTakes,
    sheets,
    variances,
    exceptions,
    changes,
    baskets,
    signatures,
    issues,
    audit,
  };
}

/* ---------- variance sync (7b) ---------- */

type StackRow = { stk_stackid: string; stk_name: string; _stk_site_value?: string };
type LineRow = { stk_countlineid: string; _stk_stack_value?: string; stk_batch?: string; _createdby_value?: string };

/**
 * Creates a stk_variance for each new difference and refreshes open ones.
 * Decided variances are left alone, except that a recount which now matches
 * XBS is accepted automatically.
 */
/** Dataverse refused a create because a row with the same alternate key exists. */
const isDuplicateKey = (e?: { message?: string; code?: string } | Error) =>
  /0x80060892|Entity Key .* violated|matching key|duplicate record|already exists/i.test(`${(e as { code?: string })?.code ?? ""} ${e?.message ?? ""}`);

async function syncVariances(
  drafts: ReturnType<typeof draftVariances>,
  stacks: StackRow[],
  lines: LineRow[],
  siteIdOf: Map<SiteCode, string>,
  thirdParty: Set<SiteCode>,
) {
  const existing = await all(
    (o) => Stk_variancesService.getAll(o),
    { select: ["stk_varianceid", "stk_name", "_stk_site_value", "_stk_stack_value", "stk_outturn", "stk_countedunits", "stk_expectedunits", "stk_countedkg", "stk_expectedkg", "stk_state", "_stk_countline_value", "stk_lotkey"], filter: `_stk_stocktake_value eq ${ids.stockTakeId}` },
    "read variances",
  );
  const siteCodeOf = new Map([...siteIdOf.entries()].map(([k, v]) => [v, k]));
  const stackName = new Map(stacks.map((s) => [s.stk_stackid, s.stk_name]));
  const stackId = (site: SiteCode, name: string) => stacks.find((s) => s._stk_site_value === siteIdOf.get(site) && s.stk_name === name)?.stk_stackid;
  const lineBatch = new Map(lines.map((l) => [l.stk_countlineid, l.stk_batch ?? ""]));
  // stk_lotkey is "<stock take id>|<draft key>" and unique in Dataverse, so two
  // people loading at once can't create the same variance twice.
  const lotKey = (draftKey: string) => `${ids.stockTakeId}|${draftKey}`;
  const keyOf = (v: (typeof existing)[number]) => {
    if (v.stk_lotkey?.startsWith(`${ids.stockTakeId}|`)) return v.stk_lotkey.slice(ids.stockTakeId.length + 1);
    const site = siteCodeOf.get(v._stk_site_value!)!;
    return `${site}|${thirdParty.has(site) ? "" : (stackName.get(v._stk_stack_value!) ?? "")}|${lineBatch.get(v._stk_countline_value!) ?? v.stk_outturn ?? ""}`;
  };
  const byKey = new Map(existing.map((v) => [keyOf(v), v]));
  const open = code(Stk_variancesstk_state, "Open");
  const recountSent = code(Stk_variancesstk_state, "Recount sent");
  let next = existing.reduce((m, v) => Math.max(m, Number(v.stk_name.replace(/\D/g, "")) || 0), 0);

  const draftKeys = new Set(drafts.map((d) => d.key));
  // An open or recounted variance whose lot now matches XBS: accept it.
  for (const v of existing) {
    if ((v.stk_state === recountSent || v.stk_state === open) && !draftKeys.has(keyOf(v)))
      unwrap(
        await Stk_variancesService.update(v.stk_varianceid, {
          stk_state: code(Stk_variancesstk_state, "Accepted"),
          stk_countedunits: v.stk_expectedunits,
          stk_suggestionwhy:
            v.stk_countedunits === v.stk_expectedunits && Math.abs((v.stk_countedkg ?? 0) - (v.stk_expectedkg ?? 0)) < MATCH_TOLERANCE_KG
              ? `Within ${MATCH_TOLERANCE_KG} kg of XBS (pockets are weighed to the whole kilo); accepted automatically.`
              : v.stk_state === recountSent
                ? "The blind recount matched XBS."
                : "The count was corrected and now matches XBS.",
          stk_decidedon: new Date().toISOString(),
        } as never),
        "accept a matched recount",
      );
  }
  for (const d of drafts) {
    const fields = {
      stk_outturn: d.outturn,
      stk_grade: d.grade.slice(0, 100),
      stk_expectedunits: d.expectedUnits,
      stk_countedunits: d.countedUnits,
      stk_expectedkg: Math.round(d.expectedKg * 100) / 100,
      stk_countedkg: Math.round(d.countedKg * 100) / 100,
      stk_suggestedcause: code(Stk_variancesstk_suggestedcause, d.cause),
      stk_suggestionwhy: d.why.slice(0, 2000),
      ...(d.lineId ? { "stk_countline@odata.bind": bind("stk_countlines", d.lineId) } : {}),
    };
    const had = byKey.get(d.key);
    if (!had) {
      const sid = stackId(d.site, d.stack);
      const res = await Stk_variancesService.create({
        stk_name: `V-${String(++next).padStart(4, "0")}`,
        statecode: 0,
        stk_state: open,
        stk_lotkey: lotKey(d.key),
        ...fields,
        "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
        "stk_site@odata.bind": bind("stk_sites", siteIdOf.get(d.site)!),
        ...(sid ? { "stk_stack@odata.bind": bind("stk_stacks", sid) } : {}),
      } as never);
      // Someone else's load created it a moment ago: theirs stands.
      if (!res.success && isDuplicateKey(res.error)) next--;
      else unwrap(res, `record a variance for ${d.outturn}`);
    } else if ((had.stk_state === open || had.stk_state === recountSent) && (had.stk_countedunits !== d.countedUnits || had.stk_expectedunits !== d.expectedUnits)) {
      unwrap(await Stk_variancesService.update(had.stk_varianceid, fields as never), `update variance ${had.stk_name}`);
    }
  }
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

async function decideVariance(name: string, state: Variance["state"], cause: RootCause) {
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
        // Assign it to whoever counted, so it lands on their phone.
        ...(v.counterId ? { "ownerid@odata.bind": bind("systemusers", v.counterId) } : {}),
      } as never),
      "send the recount",
    );
  }
}

const KIND_FALLBACK = "Not yet known";
async function addException(e: Exception) {
  const v = ids.variance.get(e.ref);
  const kind = Object.values(Stk_exceptionsstk_kind).includes(e.kind as never) ? e.kind : KIND_FALLBACK;
  const created = unwrap(
    await Stk_exceptionsService.create({
      stk_name: `${e.id} — ${e.title}`.slice(0, 200),
      statecode: 0,
      stk_kind: code(Stk_exceptionsstk_kind, kind),
      stk_source: code(Stk_exceptionsstk_source, e.source),
      stk_reference: e.ref,
      stk_department: code(Stk_exceptionsstk_department, e.dept),
      stk_bags: e.bags,
      stk_duedate: addWorkingDays(new Date(), ids.slaDays).toISOString().slice(0, 10),
      stk_status: code(Stk_exceptionsstk_status, "Open"),
      stk_escalationlevel: code(Stk_exceptionsstk_escalationlevel, "Owner"),
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
  const rows = await all(
    (o) => AuditsService.getAll(o),
    {
      select: ["createdon", "action", "objecttypecode", "_objectid_value", "_userid_value", "changedata"] as never,
      filter: tables.map((t) => `objecttypecode eq '${t}'`).join(" or "),
      orderBy: ["createdon desc"],
      top: 150,
    },
    "read the audit history",
  );
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

async function decideMapping(name: string, approve: boolean) {
  const c = ids.change.get(name);
  if (!c) throw new Error(`Change ${name} not found`);
  if (ids.enforceSoD && c.by === ids.me) throw new Error("you requested this change, so someone else must approve it");
  const row = unwrap(
    await Stk_mappingchangesService.get(c.id, { select: ["stk_target", "stk_targetkey", "stk_to", "stk_state"] }),
    `read ${name}`,
  );
  if (label(Stk_mappingchangesstk_state, row.stk_state) !== "Pending") throw new Error(`${name} has already been decided`);
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

async function createStockTake(st: StockTake) {
  const importId = ids.importId.get(st.importId);
  if (!importId) throw new Error(`XBS import ${st.importId} not found`);
  const created = unwrap(
    await Stk_stocktakesService.create({
      stk_name: st.title,
      statecode: 0,
      stk_type: code(Stk_stocktakesstk_type, st.type === "100% stock take" ? "100% (zero-out)" : "Monthly"),
      stk_status: code(Stk_stocktakesstk_status, "Count in progress"),
      stk_countdate: new Date().toISOString().slice(0, 10),
      "stk_import@odata.bind": bind("stk_xbsimports", importId),
    } as never),
    "create the stock take",
  );
  const newId = created.stk_stocktakeid;
  ids.stockTake.set(st.id, newId);
  ids.stockTake.set(st.title, newId);
  // Counters keep their areas: copy the current stock take's assignments.
  const current = await all(
    (o) => Stk_assignmentsService.getAll(o),
    { select: ["stk_name", "stk_rows", "_stk_site_value", "_stk_counter_value"], filter: `_stk_stocktake_value eq ${ids.stockTakeId}` },
    "read assignments",
  );
  for (const a of current)
    unwrap(
      await Stk_assignmentsService.create({
        stk_name: a.stk_name,
        statecode: 0,
        stk_rows: a.stk_rows ?? null,
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

async function addSignoff(role: Role, action: "signed" | "sent back", comment: string) {
  const gate = CHAIN.find((c) => c.role === role);
  if (!gate) throw new Error(`${role} doesn't sign a gate`);
  if (action === "signed" && gate.title === "Finance" && ids.enforceSoD && ids.preparedBy && ids.preparedBy === ids.me)
    throw new Error("you prepared this reconciliation, so someone else in Finance must sign it");
  if (action === "sent back" && !comment.trim()) throw new Error("say why it's being sent back");
  unwrap(
    await Stk_signoffsService.create({
      stk_name: `${gate.title} · ${action === "signed" ? "signed" : "sent back"}`,
      statecode: 0,
      stk_gate: code(Stk_signoffsstk_gate, gate.title),
      stk_action: code(Stk_signoffsstk_action, action === "signed" ? "Signed" : "Sent back"),
      stk_signedon: new Date().toISOString(),
      stk_comment: comment || null,
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ids.stockTakeId),
      "stk_signedby@odata.bind": bind("systemusers", ids.me),
    } as never),
    `record the ${gate.title} sign-off`,
  );
  // Move the stock take into Sign-off once the first gate signs.
  if (action === "signed")
    await Stk_stocktakesService.update(ids.stockTakeId, { stk_status: code(Stk_stocktakesstk_status, "Sign-off") } as never);
}

/** One load at a time: React's development double-mount (and quick reloads) must not run the variance sync twice in parallel. */
let loading: Promise<MgmtData> | undefined;
const loadOnce = () => (loading ??= load().finally(() => (loading = undefined)));

export const dataverseSource: DataSource = {
  kind: "dataverse",
  load: loadOnce,
  createStockTake,
  closeStockTake,
  importXbs,
  decideSheet,
  decideVariance,
  addException,
  updateException,
  requestMapping,
  decideMapping,
  setManualEntry,
  updateIssue,
  photo,
  addDirectPurchase,
  addSignoff,
};
