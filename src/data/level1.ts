// Level 1 of the stock take: from the count to variances, automatic decisions, blind recounts,
// exceptions and the count closing with its summary. Shared by the Hub (which runs it when it
// loads) and the server engine (stk-level1), so both apply exactly the same rules. It reaches
// Dataverse only through `Level1Db`: the Hub passes its Power Apps services, the engine the Web API.

import { Stk_allocationrunsstk_status } from "../generated/models/Stk_allocationrunsModel";
import {
  Stk_exceptionsstk_department,
  Stk_exceptionsstk_escalationlevel,
  Stk_exceptionsstk_kind,
  Stk_exceptionsstk_priority,
  Stk_exceptionsstk_source,
  Stk_exceptionsstk_status,
} from "../generated/models/Stk_exceptionsModel";
import { Stk_recountsstk_status } from "../generated/models/Stk_recountsModel";
import { Stk_stacksstk_status } from "../generated/models/Stk_stacksModel";
import { Stk_stocktakesstk_status } from "../generated/models/Stk_stocktakesModel";
import { Stk_variancesstk_cause, Stk_variancesstk_state, Stk_variancesstk_suggestedcause } from "../generated/models/Stk_variancesModel";
import { MATCH_TOLERANCE_KG } from "../shared/count-rules";
import { parseZone } from "../shared/sections";
import { pickRecounter, type AllocCounter, type AllocRules, type Plan } from "./allocate";
import { AUTO_DEFAULTS, planAutoDecisions, priorityFor, type AutoSettings, type AutoVariance } from "./auto-decide";
import { closeCheck, l1Summary, type CloseCheck, type SummaryInput } from "./close-count";
import { l1Pdf, toBase64 } from "./l1-pdf";
import { currentCounts } from "./reports";
import type { AllocationData } from "./source/types";
import type { AllocationChange, AllocationRun, CounterProfile, CountRow, Dept, Exception, Priority, RootCause, Site, SiteCode, Variance, XbsLine } from "./types";
import { draftVariances, type CountFact, type EmptySite } from "./variance-rules";

/* ---------- how Level 1 reaches Dataverse ---------- */

/** Entity sets by plural logical name ("stk_variances"), rows as the Web API returns them. */
export interface Level1Db {
  list<T>(set: string, q: { select: string[]; filter?: string; orderBy?: string[]; top?: number }): Promise<T[]>;
  /** Throws on failure; the error's message (and `code`) say why, e.g. a duplicate alternate key. */
  create(set: string, body: Record<string, unknown>): Promise<void>;
  update(set: string, id: string, body: Record<string, unknown>): Promise<void>;
}

/** The stock take Level 1 works on, and the exception due dates by priority (working days). */
export interface Level1Ctx {
  stockTakeId: string;
  dueDays: Record<Priority, number>;
  /** Who owns a new exception: the head of its department (user id); otherwise whoever raised it. */
  owners?: Partial<Record<Dept, string>>;
}

/**
 * Heads of department as user ids, from the setting HeadsOfDepartment (JSON: department to email),
 * matched on each user's email or sign-in name. Departments without a match are left out.
 */
export function departmentHeads(settingRows: { stk_name: string; stk_value?: string | null }[], people: { systemuserid: string; internalemailaddress?: string; domainname?: string }[]) {
  const map = parseJson<Record<string, string>>(settingRows.find((x) => x.stk_name === "HeadsOfDepartment")?.stk_value, {});
  const byEmail = new Map<string, string>();
  for (const u of people) for (const e of [u.internalemailaddress, u.domainname]) if (e) byEmail.set(e.toLowerCase(), u.systemuserid);
  const out: Partial<Record<Dept, string>> = {};
  for (const [dept, email] of Object.entries(map)) {
    const id = byEmail.get(String(email).trim().toLowerCase());
    if (id) out[dept as Dept] = id;
  }
  return out;
}

/* ---------- helpers ---------- */

type Choice = Record<number, string>;
const label = (map: Choice, value?: number | null) => (value == null ? undefined : map[value]);
function code<T extends Choice>(map: T, text: string): keyof T & number {
  const hit = Object.entries(map).find(([, v]) => v === text);
  if (!hit) throw new Error(`"${text}" isn't an allowed value`);
  return Number(hit[0]) as keyof T & number;
}
const bind = (set: string, id: string) => `/${set}(${id})`;
const KIND_FALLBACK = "Not yet known";
const pad = (n: number) => String(n).padStart(2, "0");
// Times in the explanations are Kenyan time, wherever the code runs (browser or server).
const nairobi = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000);
const hhmm = (iso?: string) => (iso ? `${pad(nairobi(iso).getUTCHours())}:${pad(nairobi(iso).getUTCMinutes())}` : "");
const stamp = (iso?: string) =>
  iso ? `${nairobi(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}, ${hhmm(iso)}` : "";
const parseJson = <T,>(t: string | undefined | null, d: T): T => {
  try {
    return t ? (JSON.parse(t) as T) : d;
  } catch {
    return d;
  }
};

export function addWorkingDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

/** Dataverse refused a create because a row with the same alternate key exists. */
export const isDuplicateKey = (e?: { message?: string; code?: string } | Error) =>
  /0x80060892|Entity Key .* violated|matching key|duplicate record|already exists/i.test(`${(e as { code?: string })?.code ?? ""} ${e?.message ?? ""}`);

/** Level 1 settings (stk_setting); anything missing keeps the default in code. */
export function level1Settings(rows: { stk_name: string; stk_value?: string | null }[]) {
  const value = (k: string) => rows.find((x) => x.stk_name === k)?.stk_value ?? undefined;
  const num = (k: string, d: number) => Number(value(k) ?? d);
  const flag = (k: string, d: boolean) => (value(k) ?? String(d)).toLowerCase() !== "false";
  const auto: AutoSettings = {
    on: flag("AutoDecide", AUTO_DEFAULTS.on),
    weightLossKg: num("AutoWeightLossKg", AUTO_DEFAULTS.weightLossKg),
    netUnits: num("AutoNetUnits", AUTO_DEFAULTS.netUnits),
    acceptPocket: flag("AutoAcceptPocket", AUTO_DEFAULTS.acceptPocket),
    unitOnlyKg: num("AutoUnitOnlyKg", AUTO_DEFAULTS.unitOnlyKg),
    highBags: num("ExceptionHighBags", AUTO_DEFAULTS.highBags),
    lowBags: num("ExceptionLowBags", AUTO_DEFAULTS.lowBags),
  };
  return {
    auto,
    /** Who runs Level 1 (setting Level1Runs): the Hub when it opens, or the server engine. */
    runs: (value("Level1Runs") ?? "").trim().toLowerCase() === "engine" ? ("Engine" as const) : ("Hub" as const),
    autoClose: flag("AutoCloseCount", true),
    dueDays: { High: num("ExceptionHighDays", 2), Medium: num("ExceptionSlaWorkingDays", 5), Low: num("ExceptionLowDays", 10) } as Record<Priority, number>,
  };
}

/** Minutes without a finished engine run after which the Hub runs Level 1 itself again. */
export const ENGINE_SILENT_MINUTES = 15;

/**
 * Whether the Hub should run Level 1 on this load. With Level1Runs = Engine it only reads, unless
 * the engine hasn't finished a run in 15 minutes (the worker is down): then the Hub
 * takes over so counting never waits on a server.
 */
export async function level1Runner(db: Level1Db, runs: "Hub" | "Engine", now = new Date()) {
  if (runs !== "Engine") return { runs, hubRuns: true, lastRun: undefined as string | undefined };
  const [last] = await db.list<{ stk_startedon?: string; stk_finishedon?: string }>("stk_engineruns", {
    select: ["stk_startedon", "stk_finishedon"],
    filter: `stk_mode eq 614500000 and stk_outcome eq 614500001`, // Engine, Done
    orderBy: ["stk_finishedon desc"],
    top: 1,
  });
  const lastRun = last?.stk_finishedon ?? undefined;
  const silent = !lastRun || now.getTime() - new Date(lastRun).getTime() > ENGINE_SILENT_MINUTES * 60_000;
  return { runs, hubRuns: silent, lastRun };
}

/* ---------- rows Level 1 reads ---------- */

export type StackRow = { stk_stackid: string; stk_name: string; _stk_site_value?: string; stk_status?: number; stk_nothinghere?: boolean; stk_sitefinished?: boolean; stk_comment?: string; stk_submittedon?: string; _stk_submittedby_value?: string };
export type LineRow = {
  stk_countlineid: string;
  _stk_stack_value?: string;
  _stk_site_value?: string;
  stk_batch?: string;
  stk_outturn?: string;
  stk_grade?: string;
  stk_bags?: number;
  stk_pocketbags?: number;
  stk_units?: number;
  stk_kg?: number;
  stk_countedon?: string;
  stk_isother?: boolean;
  _stk_recount_value?: string;
  _createdby_value?: string;
};
export type RecountRow = { stk_recountid: string; stk_name: string; stk_status?: number; _ownerid_value?: string };

export const XBS_SELECT = [
  "stk_name", "stk_stocktype", "_stk_site_value", "stk_zone", "stk_outturn", "stk_grade", "stk_basketcode", "stk_basketname", "stk_bags", "stk_pocketkg",
  "stk_units", "stk_kg", "stk_growermark", "stk_warrant", "stk_certification", "stk_cupscore", "stk_blocked", "stk_salescontract", "stk_instruction",
  "stk_daysinstock", "stk_cropyear", "stk_rownumber",
];
export type XbsRow = {
  stk_name: string; stk_stocktype?: number; _stk_site_value?: string; stk_zone?: string; stk_outturn?: string; stk_grade?: string; stk_basketcode?: string; stk_basketname?: string;
  stk_bags?: number; stk_pocketkg?: number; stk_units?: number; stk_kg?: number; stk_growermark?: string; stk_warrant?: string; stk_certification?: string; stk_cupscore?: string;
  stk_blocked?: boolean; stk_salescontract?: string; stk_instruction?: string; stk_daysinstock?: number; stk_cropyear?: string;
};
/** One stored XBS row as the rules read it. */
export const xbsLineOf = (r: XbsRow, siteCode: Map<string, SiteCode>): XbsLine => ({
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
});

export const STACK_SELECT = ["stk_stackid", "stk_name", "_stk_site_value", "stk_status", "_stk_countsheet_value", "stk_nothinghere", "stk_sitefinished", "stk_comment", "stk_submittedon", "_stk_submittedby_value"];
export const LINE_SELECT = [
  "stk_countlineid", "stk_outturn", "stk_batch", "stk_grade", "_stk_stack_value", "_stk_site_value", "stk_bags", "stk_pocketbags", "stk_units", "stk_kg",
  "stk_reason", "stk_isfound", "stk_isother", "stk_countedon", "_createdby_value", "_stk_countsheet_value",
  "stk_pocketkg", "stk_category", "_stk_recount_value",
];

/**
 * The count as the rules read it: one fact per count line, the stacks that are in, and the
 * third-party sites the counter closed (reported empty, or finished after counting every stack).
 */
export function level1Facts(o: {
  stackRows: StackRow[];
  countRows: LineRow[];
  recountRows: RecountRow[];
  siteCode: Map<string, SiteCode>;
  nm: (id?: string) => string;
}) {
  const stackOf = new Map(o.stackRows.map((r) => [r.stk_stackid, { site: o.siteCode.get(r._stk_site_value!)!, name: r.stk_name }]));
  const submittedStates = new Set(["Submitted", "Approved", "Sent back"]);
  const isIn = (r: StackRow) => submittedStates.has(label(Stk_stacksstk_status, r.stk_status) ?? "");
  const submittedStacks = o.stackRows.filter(isIn).map((r) => ({ site: o.siteCode.get(r._stk_site_value!)!, stack: r.stk_name }));
  const recountName = new Map(o.recountRows.map((r) => [r.stk_recountid, r.stk_name]));
  const facts: CountFact[] = o.countRows.map((c) => ({
    lineId: c.stk_countlineid,
    site: o.siteCode.get(c._stk_site_value!)!,
    stack: stackOf.get(c._stk_stack_value!)?.name ?? "",
    batch: c.stk_batch ?? "",
    outturn: c.stk_outturn ?? "",
    grade: c.stk_grade ?? "",
    units: c.stk_units ?? (c.stk_bags ?? 0) + (c.stk_pocketbags ?? 0),
    kg: Number(c.stk_kg ?? 0),
    by: o.nm(c._createdby_value),
    at: hhmm(c.stk_countedon),
    other: !!c.stk_isother,
    recount: recountName.get(c._stk_recount_value ?? ""),
  }));
  const emptySites: EmptySite[] = o.stackRows
    .filter((r) => (r.stk_nothinghere || r.stk_sitefinished) && isIn(r))
    .map((r) => ({
      site: o.siteCode.get(r._stk_site_value!)!,
      stack: r.stk_name,
      by: o.nm(r._stk_submittedby_value),
      at: hhmm(r.stk_submittedon),
      reason: r.stk_comment ?? "No reason given",
      finished: !!r.stk_sitefinished && !r.stk_nothinghere,
    }));
  return { stackOf, submittedStacks, facts, emptySites };
}

/* ---------- 1. variances from the count ---------- */

/**
 * Creates a stk_variance for each new difference and refreshes open ones.
 * Decided variances are left alone, except that a recount which now matches
 * XBS is accepted automatically.
 */
export async function syncVariances(
  db: Level1Db,
  ctx: Level1Ctx,
  drafts: ReturnType<typeof draftVariances>,
  stacks: StackRow[],
  lines: LineRow[],
  siteIdOf: Map<SiteCode, string>,
  thirdParty: Set<SiteCode>,
) {
  type Row = { stk_varianceid: string; stk_name: string; _stk_site_value?: string; _stk_stack_value?: string; stk_outturn?: string; stk_countedunits?: number; stk_expectedunits?: number; stk_countedkg?: number; stk_expectedkg?: number; stk_state?: number; _stk_countline_value?: string; stk_lotkey?: string };
  const existing = await db.list<Row>("stk_variances", {
    select: ["stk_varianceid", "stk_name", "_stk_site_value", "_stk_stack_value", "stk_outturn", "stk_countedunits", "stk_expectedunits", "stk_countedkg", "stk_expectedkg", "stk_state", "_stk_countline_value", "stk_lotkey"],
    filter: `_stk_stocktake_value eq ${ctx.stockTakeId}`,
  });
  const siteCodeOf = new Map([...siteIdOf.entries()].map(([k, v]) => [v, k]));
  const stackName = new Map(stacks.map((s) => [s.stk_stackid, s.stk_name]));
  const stackId = (site: SiteCode, name: string) => stacks.find((s) => s._stk_site_value === siteIdOf.get(site) && s.stk_name === name)?.stk_stackid;
  const lineBatch = new Map(lines.map((l) => [l.stk_countlineid, l.stk_batch ?? ""]));
  // stk_lotkey is "<stock take id>|<draft key>" and unique in Dataverse, so two
  // people loading at once can't create the same variance twice.
  const lotKey = (draftKey: string) => `${ctx.stockTakeId}|${draftKey}`;
  const keyOf = (v: Row) => {
    if (v.stk_lotkey?.startsWith(`${ctx.stockTakeId}|`)) return v.stk_lotkey.slice(ctx.stockTakeId.length + 1);
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
      await db.update("stk_variances", v.stk_varianceid, {
        stk_state: code(Stk_variancesstk_state, "Accepted"),
        stk_countedunits: v.stk_expectedunits,
        stk_suggestionwhy:
          v.stk_countedunits === v.stk_expectedunits && Math.abs((v.stk_countedkg ?? 0) - (v.stk_expectedkg ?? 0)) < MATCH_TOLERANCE_KG
            ? `Within ${MATCH_TOLERANCE_KG} kg of XBS (pockets are weighed to the whole kilo); accepted automatically.`
            : v.stk_state === recountSent
              ? "The blind recount matched XBS."
              : "The count was corrected and now matches XBS.",
        stk_decidedon: new Date().toISOString(),
      });
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
      try {
        await db.create("stk_variances", {
          stk_name: `V-${String(++next).padStart(4, "0")}`,
          statecode: 0,
          stk_state: open,
          stk_lotkey: lotKey(d.key),
          ...fields,
          "stk_stocktake@odata.bind": bind("stk_stocktakes", ctx.stockTakeId),
          "stk_site@odata.bind": bind("stk_sites", siteIdOf.get(d.site)!),
          ...(sid ? { "stk_stack@odata.bind": bind("stk_stacks", sid) } : {}),
        });
      } catch (e) {
        // Someone else's load created it a moment ago: theirs stands.
        if (isDuplicateKey(e as Error)) next--;
        else throw new Error(`Couldn't record a variance for ${d.outturn}: ${(e as Error).message}`);
      }
    } else if ((had.stk_state === open || had.stk_state === recountSent) && (had.stk_countedunits !== d.countedUnits || had.stk_expectedunits !== d.expectedUnits)) {
      await db.update("stk_variances", had.stk_varianceid, fields);
    }
  }
}

/* ---------- 2. who can do a blind recount ---------- */

/** Counter profiles and allocation runs: who is counting, so a recount goes to someone else. */
export async function readAllocation(
  db: Level1Db,
  stockTakeId: string,
  settingRows: { stk_name: string; stk_value?: string }[],
  peopleRows: { systemuserid: string; fullname?: string }[],
  siteOf: Map<string, SiteCode>,
): Promise<AllocationData> {
  type ProfileRow = { stk_counterprofileid: string; stk_name: string; stk_homerows?: string; stk_thirdpartyok?: boolean; stk_active?: boolean; stk_notes?: string; _stk_user_value?: string; _stk_homesite_value?: string };
  type RunRow = { stk_allocationrunid: string; stk_name: string; stk_status?: number; stk_seed?: number; stk_spreadpct?: number; stk_present?: string; stk_plan?: string; stk_swaps?: string; stk_publishedon?: string; _stk_publishedby_value?: string; _stk_stocktake_value?: string };
  const [profileRows, runRows] = await Promise.all([
    db.list<ProfileRow>("stk_counterprofiles", { select: ["stk_counterprofileid", "stk_name", "stk_homerows", "stk_thirdpartyok", "stk_active", "stk_notes", "_stk_user_value", "_stk_homesite_value"] }),
    db.list<RunRow>("stk_allocationruns", {
      select: ["stk_allocationrunid", "stk_name", "stk_status", "stk_seed", "stk_spreadpct", "stk_present", "stk_plan", "stk_swaps", "stk_publishedon", "_stk_publishedby_value", "_stk_stocktake_value", "createdon"],
      orderBy: ["createdon desc"],
    }),
  ]);
  const nameOf = new Map(peopleRows.map((u) => [u.systemuserid, u.fullname ?? ""]));
  const profiles: CounterProfile[] = profileRows.map((p) => ({
    id: p.stk_counterprofileid,
    userId: p._stk_user_value!,
    name: nameOf.get(p._stk_user_value!) || p.stk_name,
    homeSite: p._stk_homesite_value ? siteOf.get(p._stk_homesite_value) : undefined,
    homeRows: (p.stk_homerows ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
    thirdPartyOk: !!p.stk_thirdpartyok,
    active: p.stk_active !== false,
    notes: p.stk_notes ?? undefined,
  }));
  const emptyPlan: Plan = { seed: 0, rows: [], unassigned: [], spreadPct: 0, rotationRepeats: 0, multiSite: 0, warnings: [], rules: { homeArea: true, rotation: true, thirdPartyClearance: true } };
  const toRun = (r: RunRow): AllocationRun => ({
    id: r.stk_allocationrunid,
    name: r.stk_name,
    status: (label(Stk_allocationrunsstk_status, r.stk_status) ?? "Draft") as AllocationRun["status"],
    seed: r.stk_seed ?? 0,
    spreadPct: Number(r.stk_spreadpct ?? 0),
    present: parseJson<string[]>(r.stk_present, []),
    plan: parseJson<Plan>(r.stk_plan, emptyPlan),
    changes: parseJson<AllocationChange[]>(r.stk_swaps, []),
    by: r._stk_publishedby_value ? nameOf.get(r._stk_publishedby_value) : undefined,
    at: r.stk_publishedon ? stamp(r.stk_publishedon) : undefined,
  });
  const runs = runRows.filter((r) => r._stk_stocktake_value === stockTakeId).map(toRun);
  // Rotation: the areas each counter had in the latest published plan of another stock take.
  const used = new Set<number>([code(Stk_allocationrunsstk_status, "Published"), code(Stk_allocationrunsstk_status, "Superseded")]);
  const previous = runRows.find((r) => r._stk_stocktake_value !== stockTakeId && used.has(r.stk_status!));
  const lastAreas: Record<string, string[]> = {};
  if (previous) for (const row of toRun(previous).plan.rows) lastAreas[row.counterId] = row.areas.map((a) => a.key.replace(/#\d+$/, ""));
  const rulesText = settingRows.find((x) => x.stk_name === "AllocationRules")?.stk_value;
  const rules: AllocRules = { homeArea: true, rotation: true, thirdPartyClearance: true, ...parseJson<Partial<AllocRules>>(rulesText, {}) };
  const people = peopleRows.filter((u) => u.fullname && !u.fullname.startsWith("#")).map((u) => ({ id: u.systemuserid, name: u.fullname! }));
  return { profiles, runs, lastAreas, rules, people };
}

/** Open recounts per person, so the next one goes to whoever has fewest. */
export function openRecountsOf(recountRows: RecountRow[]) {
  const out: Record<string, number> = {};
  for (const r of recountRows) if (r.stk_status === code(Stk_recountsstk_status, "Open") && r._ownerid_value) out[r._ownerid_value] = (out[r._ownerid_value] ?? 0) + 1;
  return out;
}

/* ---------- 3. automatic decisions ---------- */

/**
 * Applies the automatic Level 1 decisions (auto-decide.ts) to this stock take's variances.
 * Decisions carry no "decided by" person: the explanation says which rule took them.
 * Returns how many variances it decided.
 */
export async function autoDecide(
  db: Level1Db,
  ctx: Level1Ctx,
  facts: CountFact[],
  lines: LineRow[],
  thirdParty: Set<SiteCode>,
  siteCode: Map<string, SiteCode>,
  siteShort: (c: SiteCode) => string,
  settings: AutoSettings,
  allocation: AllocationData,
): Promise<number> {
  if (!settings.on) return 0;
  type Row = { stk_varianceid: string; stk_name: string; stk_lotkey?: string; stk_state?: number; stk_suggestedcause?: number; stk_suggestionwhy?: string; stk_outturn?: string; stk_expectedunits?: number; stk_countedunits?: number; stk_expectedkg?: number; stk_countedkg?: number; _stk_site_value?: string; _stk_stack_value?: string; _stk_countline_value?: string; stk_decidedon?: string };
  const vrows = await db.list<Row>("stk_variances", {
    select: ["stk_varianceid", "stk_name", "stk_lotkey", "stk_state", "stk_suggestedcause", "stk_suggestionwhy", "stk_outturn", "stk_expectedunits", "stk_countedunits", "stk_expectedkg", "stk_countedkg", "_stk_site_value", "_stk_stack_value", "_stk_countline_value", "stk_decidedon"],
    filter: `_stk_stocktake_value eq ${ctx.stockTakeId} and (stk_state eq ${code(Stk_variancesstk_state, "Open")} or stk_state eq ${code(Stk_variancesstk_state, "Recount sent")})`,
  });
  if (!vrows.length) return 0;
  const byId = new Map(vrows.map((r) => [r.stk_varianceid, r]));
  const recountState = code(Stk_variancesstk_state, "Recount sent");
  const vs: AutoVariance[] = vrows.map((r) => {
    const key = r.stk_lotkey?.startsWith(`${ctx.stockTakeId}|`) ? r.stk_lotkey.slice(ctx.stockTakeId.length + 1) : "";
    return {
      id: r.stk_varianceid,
      key,
      site: siteCode.get(r._stk_site_value!) ?? "IBR",
      stack: key.split("|")[1] ?? "",
      outturn: r.stk_outturn ?? "",
      expectedUnits: r.stk_expectedunits ?? 0,
      countedUnits: r.stk_countedunits ?? 0,
      expectedKg: Number(r.stk_expectedkg ?? 0),
      countedKg: Number(r.stk_countedkg ?? 0),
      cause: (label(Stk_variancesstk_suggestedcause, r.stk_suggestedcause) ?? "Not yet known") as RootCause,
      suggestion: r.stk_suggestionwhy,
      state: r.stk_state === recountState ? "recount" : "open",
      decided: !!r.stk_decidedon,
    };
  });
  const plan = planAutoDecisions(vs, facts, thirdParty, settings, siteShort);
  if (!plan.length) return 0;

  const now = new Date().toISOString();
  const lineBy = new Map(lines.map((l) => [l.stk_countlineid, l._createdby_value]));
  const decide = (id: string, state: string, cause: RootCause, why: string) =>
    db.update("stk_variances", id, {
      stk_state: code(Stk_variancesstk_state, state),
      stk_cause: code(Stk_variancesstk_cause, cause),
      stk_suggestionwhy: why.slice(0, 2000),
      stk_decidedon: now,
    });

  // Recounters: a different counter on the published allocation (as the Variances page picks them).
  const live = allocation.runs.find((r) => r.status === "Published");
  const profiles = allocation.profiles.filter((p) => p.active);
  const counters: AllocCounter[] = (live?.present.length ? live.present : profiles.map((p) => p.userId)).map((id) => {
    const p = profiles.find((x) => x.userId === id);
    return p ? { id, name: p.name, homeRows: p.homeRows, homeSite: p.homeSite, thirdPartyOk: p.thirdPartyOk } : { id, name: id, noProfile: true };
  });
  const open = allocation.openRecounts ?? {};
  const recountNames = await db.list<{ stk_name: string }>("stk_recounts", { select: ["stk_name"], filter: `_stk_stocktake_value eq ${ctx.stockTakeId}` });
  let nextRecount = recountNames.reduce((m, r) => Math.max(m, Number(r.stk_name.replace(/\D/g, "")) || 0), 0);
  const exNames = await db.list<{ stk_name: string }>("stk_exceptions", { select: ["stk_name"] });
  let nextEx = exNames.reduce((m, r) => Math.max(m, Number(/^EX-(\d+)/.exec(r.stk_name)?.[1] ?? 0)), 0);
  const raise = (title: string, kind: string, dept: Dept, bags: number, ref: string, varianceId: string, priority: Priority) =>
    db.create("stk_exceptions", {
      stk_name: `EX-${String(++nextEx).padStart(3, "0")} — ${title}`.slice(0, 200),
      statecode: 0,
      stk_kind: code(Stk_exceptionsstk_kind, Object.values(Stk_exceptionsstk_kind).includes(kind as never) ? kind : KIND_FALLBACK),
      stk_source: code(Stk_exceptionsstk_source, "Count"),
      stk_reference: ref.slice(0, 60),
      stk_department: code(Stk_exceptionsstk_department, dept),
      stk_bags: Math.round(bags), // whole bags (column is a whole number)
      // Due date by priority: High sooner, Low later (settings ExceptionHighDays / ExceptionLowDays).
      stk_duedate: addWorkingDays(new Date(), ctx.dueDays[priority]).toISOString().slice(0, 10),
      stk_status: code(Stk_exceptionsstk_status, "Open"),
      stk_escalationlevel: code(Stk_exceptionsstk_escalationlevel, "Owner"),
      stk_priority: code(Stk_exceptionsstk_priority, priority),
      "stk_stocktake@odata.bind": bind("stk_stocktakes", ctx.stockTakeId),
      "stk_variance@odata.bind": bind("stk_variances", varianceId),
      ...(ctx.owners?.[dept] ? { "ownerid@odata.bind": bind("systemusers", ctx.owners[dept]!) } : {}),
    });

  // Open low-priority lists on this stock take ("<site>: low-priority list, N lots ... (B bags)"), read once when needed.
  type LowList = { id: string; ex: string; title: string; lots: number; bags: number };
  let lowLists: LowList[] | undefined;
  const readLowLists = async (): Promise<LowList[]> => {
    const rows = await db.list<{ stk_exceptionid: string; stk_name: string }>("stk_exceptions", {
      select: ["stk_exceptionid", "stk_name"],
      filter: `_stk_stocktake_value eq ${ctx.stockTakeId} and stk_priority eq ${code(Stk_exceptionsstk_priority, "Low")} and stk_status ne ${code(Stk_exceptionsstk_status, "Closed")}`,
    });
    return rows
      .map((r) => {
        const [ex, ...rest] = r.stk_name.split(" — ");
        const title = rest.join(" — ");
        return { id: r.stk_exceptionid, ex, title, lots: Number(/(\d+) lots?/.exec(title)?.[1] ?? 0), bags: Number(/\(([\d.]+) bags\)/.exec(title)?.[1] ?? 0) };
      })
      .filter((x) => x.title.includes(": low-priority list, "));
  };

  let decided = 0;
  const groups = new Map<string, typeof plan>();
  for (const a of plan) {
    const r = byId.get(a.id)!;
    const v = vs.find((x) => x.id === a.id)!;
    if (a.group) {
      groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
      continue;
    }
    if (a.act === "accept") await decide(a.id, "Accepted", a.cause, a.why);
    else if (a.act === "review") await decide(a.id, "Open", a.cause, a.why);
    else if (a.act === "exception") {
      await decide(a.id, "Exception raised", a.cause, a.why);
      const d = v.countedUnits - v.expectedUnits;
      const dkg = Math.round(v.countedKg - v.expectedKg);
      const diff = d === 0 ? `${dkg > 0 ? "+" : ""}${dkg} kg` : `${d > 0 ? "+" : ""}${d} units`;
      await raise(`${v.outturn} at ${v.stack || siteShort(v.site)}: ${diff} (${a.rule})`, a.cause, a.dept ?? "Operations", a.bags ?? Math.abs(d), r.stk_name, a.id, a.priority ?? "Medium");
    } else if (a.act === "recount") {
      if (!r._stk_stack_value) continue; // no stack to send it to: leave for the supervisor
      const original = lineBy.get(r._stk_countline_value ?? "");
      const pick = pickRecounter({ site: v.site, stack: v.stack, exclude: original ? [original] : [], counters, openRecounts: open, rules: allocation.rules, thirdParty });
      const owner = pick?.id ?? original;
      if (pick) open[pick.id] = (open[pick.id] ?? 0) + 1;
      await decide(a.id, "Recount sent", a.cause, `Sent automatically for a blind recount${pick ? ` to ${pick.name}` : ""}: no rule explains the difference.`);
      await db.create("stk_recounts", {
        stk_name: `R-${String(++nextRecount).padStart(3, "0")}`,
        statecode: 0,
        stk_outturn: v.outturn,
        stk_batch: v.key.split("|")[2] ?? v.outturn,
        stk_why: `Count ${v.outturn} again from the bottom tier up. The earlier figure is hidden on purpose.`,
        stk_status: code(Stk_recountsstk_status, "Open"),
        "stk_stocktake@odata.bind": bind("stk_stocktakes", ctx.stockTakeId),
        "stk_stack@odata.bind": bind("stk_stacks", r._stk_stack_value),
        "stk_variance@odata.bind": bind("stk_variances", a.id),
        ...(owner ? { "ownerid@odata.bind": bind("systemusers", owner) } : {}),
      });
    }
    decided++;
  }
  // Grouped exceptions: one per third-party site (lots to confirm, prioritised on the total) and
  // one low-priority list per warehouse. The lots are the variances the exception covers.
  for (const [group, acts] of groups) {
    const first = vs.find((x) => x.id === acts[0].id)!;
    const names = acts.map((x) => byId.get(x.id)!.stk_name).sort();
    const ref = `${names[0]}–${names[names.length - 1]} (${names.length})`;
    const bags = acts.reduce((t, x) => t + (x.bags ?? 0), 0);
    const lots = `${acts.length} lot${acts.length === 1 ? "" : "s"}`;
    if (group.startsWith("low:")) {
      for (const a of acts) await decide(a.id, "Exception raised", a.cause, `${a.why} Low priority (${settings.lowBags} bags or less): on the ${siteShort(first.site)} low-priority list.`);
      // One list per warehouse: add to its open list if there is one (e.g. lots confirmed by a later recount).
      const prefix = `${siteShort(first.site)}: low-priority list, `;
      const list = (lowLists ??= await readLowLists()).find((x) => x.title.startsWith(prefix));
      if (list) {
        list.lots += acts.length;
        list.bags += bags;
        list.title = `${prefix}${list.lots} lots of ${settings.lowBags} bags or less (${Math.round(list.bags * 10) / 10} bags)`;
        await db.update("stk_exceptions", list.id, { stk_name: `${list.ex} — ${list.title}`.slice(0, 200), stk_bags: Math.round(list.bags) });
      } else {
        const kinds = new Set(acts.map((a) => a.cause));
        await raise(`${prefix}${lots} of ${settings.lowBags} bags or less (${Math.round(bags * 10) / 10} bags)`, kinds.size === 1 ? acts[0].cause : KIND_FALLBACK, thirdParty.has(first.site) ? "Logistics" : "Warehouse", bags, ref, acts[0].id, "Low");
      }
    } else {
      const short = acts.reduce((t, x) => { const v = vs.find((y) => y.id === x.id)!; return t + (v.expectedUnits - v.countedUnits); }, 0);
      for (const a of acts) await decide(a.id, "Exception raised", a.cause, a.why);
      await raise(`${siteShort(first.site)}: ${lots} short, ${short} units to confirm with the warehouse`, "Third party", "Logistics", bags, ref, acts[0].id, priorityFor(bags, settings));
    }
    decided += acts.length;
  }
  return decided;
}

/* ---------- 4. counting closes on its own ---------- */

/** Note subject of the Level 1 summary PDF on a stock take (flow F10 attaches it). */
export const L1_PDF_SUBJECT = "Level 1 summary";

/** Builds the NKG-branded Level 1 PDF and stores it as the stock take's one "Level 1 summary" note. */
async function saveL1Pdf(db: Level1Db, stockTakeId: string, name: string, input: SummaryInput) {
  const bytes = await l1Pdf(input);
  const fields = {
    subject: L1_PDF_SUBJECT,
    isdocument: true,
    filename: `Level 1 summary - ${name.replace(/[\\/:*?"<>|]/g, "-")}.pdf`,
    mimetype: "application/pdf",
    documentbody: toBase64(bytes),
  };
  const [old] = await db.list<{ annotationid: string }>("annotations", { select: ["annotationid"], filter: `_objectid_value eq ${stockTakeId} and subject eq '${L1_PDF_SUBJECT}'` });
  if (old) await db.update("annotations", old.annotationid, fields);
  else await db.create("annotations", { ...fields, "objectid_stk_stocktake@odata.bind": bind("stk_stocktakes", stockTakeId) });
}

/**
 * Checks whether counting is finished on the active stock take; if it is (and AutoCloseCount
 * is on), moves it to Reconciliation and writes the Level 1 summary that flow F10 sends.
 */
export async function closeCountIfDone(
  db: Level1Db,
  o: {
    active: { stk_stocktakeid: string; stk_name: string; stk_status?: number; stk_countclosedon?: string; stk_l1summary?: string };
    lines: XbsLine[];
    stackRows: StackRow[];
    emptySites: EmptySite[];
    counts: CountRow[];
    variances: Pick<Variance, "state" | "why">[];
    exceptions: Pick<Exception, "source" | "priority">[];
    countRows: { _stk_recount_value?: string }[];
    thirdParty: Set<SiteCode>;
    sites: Site[];
    autoClose: boolean;
  },
): Promise<CloseCheck & { closedAt?: string; summary?: string; closedNow?: boolean }> {
  const short = (c: SiteCode) => o.sites.find((x) => x.code === c)?.short ?? c;
  const status = label(Stk_stocktakesstk_status, o.active.stk_status);
  // Already closed (a stock take put back into counting is checked again).
  if (o.active.stk_countclosedon && status !== "Count in progress") return { ready: true, missing: [], closedAt: o.active.stk_countclosedon, summary: o.active.stk_l1summary ?? undefined };
  const iberoStacks = [...new Set(o.lines.filter((l) => !o.thirdParty.has(l.wh) && l.z && parseZone(l.z)).map((l) => l.z!))];
  const submittedStates = new Set(["Submitted", "Approved"]);
  const submittedStacks = new Set(o.stackRows.filter((r) => submittedStates.has(label(Stk_stacksstk_status, r.stk_status) ?? "")).map((r) => r.stk_name));
  const check = closeCheck({
    iberoStacks,
    submittedStacks,
    thirdPartySites: [...new Set(o.lines.filter((l) => o.thirdParty.has(l.wh)).map((l) => l.wh))],
    closedSites: new Set(o.emptySites.map((e) => e.site)),
    openRecounts: o.variances.filter((v) => v.state === "recount").length,
    undecidedVariances: o.variances.filter((v) => v.state === "open").length,
    countLines: o.counts.length,
    siteShort: short,
  });
  if (!check.ready || !o.autoClose || status !== "Count in progress") return check;

  const closedAt = new Date();
  const phys = new Map<SiteCode, number>();
  for (const c of currentCounts(o.counts, o.thirdParty).filter((c) => !c.other)) phys.set(c.site, (phys.get(c.site) ?? 0) + c.kg / 60);
  const xbs = new Map<SiteCode, number>();
  for (const l of o.lines) xbs.set(l.wh, (xbs.get(l.wh) ?? 0) + l.kg / 60);
  const fromCount = o.exceptions.filter((e) => e.source === "Count");
  const input: SummaryInput = {
    stockTake: o.active.stk_name,
    closedAt,
    sites: o.sites.filter((x) => xbs.has(x.code) || phys.has(x.code)).map((x) => ({ name: x.short, xbs: xbs.get(x.code) ?? 0, physical: phys.get(x.code) ?? 0 })),
    variances: {
      total: o.variances.length,
      accepted: o.variances.filter((v) => v.state === "accepted").length,
      acceptedAutomatically: o.variances.filter((v) => v.state === "accepted" && v.why.startsWith("Decided automatically")).length,
      exception: o.variances.filter((v) => v.state === "exception").length,
    },
    recountsDone: new Set(o.countRows.map((c) => c._stk_recount_value).filter(Boolean)).size,
    exceptions: {
      High: fromCount.filter((e) => e.priority === "High").length,
      Medium: fromCount.filter((e) => e.priority === "Medium").length,
      Low: fromCount.filter((e) => e.priority === "Low").length,
    },
  };
  const summary = l1Summary(input);
  // The branded PDF goes on the stock take first, so flow F10 finds it when the close fires.
  // A PDF that can't be made doesn't stop the count closing; the email then goes without it.
  await saveL1Pdf(db, o.active.stk_stocktakeid, o.active.stk_name, input).catch((e: unknown) => console.warn("Level 1 PDF not saved:", e));
  await db.update("stk_stocktakes", o.active.stk_stocktakeid, {
    stk_status: code(Stk_stocktakesstk_status, "Reconciliation"),
    stk_countclosedon: closedAt.toISOString(),
    stk_l1summary: summary,
  });
  return { ...check, closedAt: closedAt.toISOString(), summary, closedNow: true };
}

/* ---------- the whole of Level 1 for one stock take (the server engine) ---------- */

export interface Level1Report {
  stockTake: string;
  status?: string;
  drafts: number;
  decided: number;
  close: CloseCheck & { closedAt?: string; closedNow?: boolean };
}

/**
 * Reads one stock take's count and runs Level 1 on it, the same steps as a Hub load:
 * variances from the count, automatic decisions and recounts, then the count close.
 */
export async function runLevel1(db: Level1Db, stockTakeId: string): Promise<Level1Report> {
  type StockTakeRow = { stk_stocktakeid: string; stk_name: string; stk_status?: number; _stk_import_value?: string; stk_countclosedon?: string; stk_l1summary?: string };
  type SiteRow = { stk_siteid: string; stk_code: string; stk_name: string; stk_shortname?: string; stk_isthirdparty?: boolean; stk_manualentry?: boolean };
  const [[active], siteRows, settingRows] = await Promise.all([
    db.list<StockTakeRow>("stk_stocktakes", { select: ["stk_stocktakeid", "stk_name", "stk_status", "_stk_import_value", "stk_countclosedon", "stk_l1summary"], filter: `stk_stocktakeid eq ${stockTakeId}` }),
    db.list<SiteRow>("stk_sites", { select: ["stk_siteid", "stk_code", "stk_name", "stk_shortname", "stk_isthirdparty", "stk_manualentry"] }),
    db.list<{ stk_name: string; stk_value?: string }>("stk_settings", { select: ["stk_name", "stk_value"] }),
  ]);
  if (!active) throw new Error(`Stock take ${stockTakeId} not found`);
  const siteCode = new Map<string, SiteCode>(siteRows.map((r) => [r.stk_siteid, r.stk_code as SiteCode]));
  const siteIdOf = new Map<SiteCode, string>(siteRows.map((r) => [r.stk_code as SiteCode, r.stk_siteid]));
  const sites: Site[] = siteRows.map((r) => ({ code: r.stk_code as SiteCode, name: r.stk_name, short: r.stk_shortname ?? r.stk_name, thirdParty: !!r.stk_isthirdparty, manualEntry: !!r.stk_manualentry }));
  const thirdParty = new Set(sites.filter((x) => x.thirdParty).map((x) => x.code));
  const siteShort = (c: SiteCode) => sites.find((x) => x.code === c)?.short ?? c;
  const l1 = level1Settings(settingRows);
  const st = `_stk_stocktake_value eq ${stockTakeId}`;
  const [xbs, sheets, stackRows, recountRows, peopleRows] = await Promise.all([
    db.list<XbsRow>("stk_xbslines", { select: XBS_SELECT, filter: `_stk_import_value eq ${active._stk_import_value}`, orderBy: ["stk_rownumber asc"] }),
    db.list<{ stk_countsheetid: string }>("stk_countsheets", { select: ["stk_countsheetid"], filter: st }),
    db.list<StackRow>("stk_stacks", { select: STACK_SELECT, filter: st }),
    db.list<RecountRow>("stk_recounts", { select: ["stk_recountid", "stk_name", "stk_status", "_ownerid_value"], filter: st }),
    db.list<{ systemuserid: string; fullname?: string; internalemailaddress?: string; domainname?: string }>("systemusers", { select: ["systemuserid", "fullname", "internalemailaddress", "domainname"], filter: "isdisabled eq false and accessmode eq 0" }),
  ]);
  const lines = xbs.map((r) => xbsLineOf(r, siteCode));
  const ctx: Level1Ctx = { stockTakeId, dueDays: l1.dueDays, owners: departmentHeads(settingRows, peopleRows) };
  const countRows: LineRow[] = [];
  const sheetIds = sheets.map((s) => s.stk_countsheetid);
  for (let i = 0; i < sheetIds.length; i += 15) {
    const chunk = sheetIds.slice(i, i + 15);
    countRows.push(...(await db.list<LineRow>("stk_countlines", { select: LINE_SELECT, filter: chunk.map((id) => `_stk_countsheet_value eq ${id}`).join(" or ") })));
  }
  const who = new Map(peopleRows.map((u) => [u.systemuserid, u.fullname ?? "Someone"]));
  const nm = (id?: string) => (id ? (who.get(id) ?? "Someone") : "");

  // 1. variances from the count
  const { stackOf, submittedStacks, facts, emptySites } = level1Facts({ stackRows, countRows, recountRows, siteCode, nm });
  const drafts = draftVariances(facts, lines, submittedStacks, thirdParty, siteShort, emptySites);
  await syncVariances(db, ctx, drafts, stackRows, countRows, siteIdOf, thirdParty);

  // 2. automatic decisions and blind recounts
  const allocation = await readAllocation(db, stockTakeId, settingRows, peopleRows, new Map(siteRows.map((r) => [r.stk_siteid, r.stk_code as SiteCode])));
  allocation.openRecounts = openRecountsOf(recountRows);
  const decided = await autoDecide(db, ctx, facts, countRows, thirdParty, siteCode, siteShort, l1.auto, allocation);

  // 3. the count closes once everything is in
  const STATE = { Open: "open", "Recount sent": "recount", Accepted: "accepted", "Exception raised": "exception" } as const;
  const [vrows, xrows] = await Promise.all([
    db.list<{ stk_state?: number; stk_suggestionwhy?: string }>("stk_variances", { select: ["stk_state", "stk_suggestionwhy"], filter: st }),
    db.list<{ stk_source?: number; stk_priority?: number; stk_bags?: number }>("stk_exceptions", { select: ["stk_source", "stk_priority", "stk_bags"] }),
  ]);
  const variances = vrows.map((v) => ({ state: STATE[(label(Stk_variancesstk_state, v.stk_state) ?? "Open") as keyof typeof STATE] ?? "open", why: v.stk_suggestionwhy ?? "" }));
  const exceptions = xrows.map((e) => ({
    source: (label(Stk_exceptionsstk_source, e.stk_source) ?? "Count") as Exception["source"],
    priority: (label(Stk_exceptionsstk_priority, e.stk_priority) as Priority | undefined) ?? priorityFor(e.stk_bags ?? 0, l1.auto),
  }));
  const counts: CountRow[] = countRows.map((c) => ({
    id: c.stk_countlineid,
    site: siteCode.get(c._stk_site_value!)!,
    stack: stackOf.get(c._stk_stack_value!)?.name ?? "",
    batch: c.stk_batch ?? "",
    outturn: c.stk_outturn ?? "",
    grade: c.stk_grade ?? "",
    bags: c.stk_bags ?? 0,
    pocketKg: 0,
    units: c.stk_units ?? (c.stk_bags ?? 0) + (c.stk_pocketbags ?? 0),
    kg: Number(c.stk_kg ?? 0),
    by: nm(c._createdby_value),
    countedOn: c.stk_countedon ?? undefined,
    found: false,
    other: !!c.stk_isother,
    recount: !!c._stk_recount_value,
  }));
  const close = await closeCountIfDone(db, { active, lines, stackRows, emptySites, counts, variances, exceptions, countRows, thirdParty, sites, autoClose: l1.autoClose });
  return { stockTake: active.stk_name, status: label(Stk_stocktakesstk_status, active.stk_status), drafts: drafts.length, decided, close: { ready: close.ready, missing: close.missing, closedAt: close.closedAt, closedNow: close.closedNow } };
}
