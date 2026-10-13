// The Reports page: each report is built from the live data the Hub already
// holds (XBS snapshot, count lines, stacks, imports, exceptions, problem
// reports, variances, sign-off) and shown as one or more tables. The same
// tables are written to Excel, so screen and file always agree.
//
// Quantities that Finance compares are in 60 kg equivalents (kg ÷ 60), and
// Ibero's system stock is XBS Warehouse + Blocked for Processing, as on the
// September month-end workbook.

import { CHAIN, IMPORTS, SITES, allLines, basketMap, site } from "./repository";
import type { Signature } from "./source";
import type { CountRow, Exception, Issue, Role, SiteCode, StackInfo, Variance, XbsLine } from "./types";

export type ColKind = "text" | "int" | "num1" | "pct";
export interface Col {
  key: string;
  label: string;
  kind?: ColKind;
}
export type Row = Record<string, string | number | undefined>;
export interface ReportTable {
  title?: string;
  columns: Col[];
  rows: Row[];
  total?: Row;
}
export interface ReportOut {
  note?: string;
  tables: ReportTable[];
}

export interface ReportInput {
  counts: CountRow[];
  stacks: StackInfo[];
  exceptions: Exception[];
  issues: Issue[];
  variances: Variance[];
  signatures: Partial<Record<Role, Signature>>;
  stockTake: string;
}

const eq = (kg: number) => kg / 60;
const short = (c: SiteCode) => site(c)?.short ?? c;
const add = (a: Row, k: string, v: number) => (a[k] = ((a[k] as number) ?? 0) + v);
const totalOf = (rows: Row[], label: string, keys: string[]): Row => {
  const t: Row = { [Object.keys(rows[0] ?? { x: 0 })[0]]: label };
  for (const k of keys) t[k] = rows.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  return t;
};
const lotKey = (c: { site: string; stack: string; batch: string }) => `${c.site}|${c.stack}|${c.batch}`;

/** Counts as they stand: a recount replaces earlier lines of the same lot. */
export function currentCounts(counts: CountRow[]): CountRow[] {
  const byLot = new Map<string, CountRow[]>();
  for (const c of counts) byLot.set(lotKey(c), [...(byLot.get(lotKey(c)) ?? []), c]);
  const out: CountRow[] = [];
  for (const rows of byLot.values()) {
    const recounts = rows.filter((r) => r.recount).sort((a, b) => (b.countedOn ?? "").localeCompare(a.countedOn ?? ""));
    out.push(...(recounts.length ? [recounts[0]] : rows));
  }
  return out;
}

/** Sites with at least one count line; the others are reported as not counted, not as 100% short. */
const countedSites = (counts: CountRow[]) => new Set(counts.map((c) => c.site));

/**
 * The XBS lines a count can already be compared with: lines on submitted
 * Ibero stacks (and the line of an outturn on the stack it was counted on),
 * and every line at a third-party site whose count has started (lots there
 * are site-wide).
 * Comparing a half-finished count with the whole warehouse would make it
 * look short when it is only unfinished.
 */
export function comparable(input: { stacks: StackInfo[] }, counts: CountRow[]) {
  const done = new Set(input.stacks.filter((s) => s.status !== "In progress").map((s) => `${s.site}|${s.name}`));
  const counted = countedSites(counts);
  const thirdParty = new Set(SITES.filter((s) => s.thirdParty).map((s) => s.code));
  // An outturn counted on a stack compares with its XBS line on that stack only;
  // its lines on stacks not counted yet wait for those stacks.
  const countedHere = new Set(counts.map((c) => `${c.site}|${c.stack}|${c.outturn}`));
  return (l: XbsLine) =>
    thirdParty.has(l.wh) ? counted.has(l.wh) : done.has(`${l.wh}|${l.z}`) || countedHere.has(`${l.wh}|${l.z}|${l.o}`);
}

/* ---------- physical ---------- */

function physicalBy(input: ReportInput, by: "site" | "grade"): ReportOut {
  const counts = currentCounts(input.counts);
  const groups = new Map<string, Row>();
  const lots = new Map<string, Set<string>>();
  const people = new Map<string, Set<string>>();
  for (const c of counts) {
    const k = by === "site" ? short(c.site) : c.other ? `Other: ${c.category ?? "other stock"}` : c.grade || "—";
    const r = groups.get(k) ?? { group: k };
    if (!c.other) lots.set(k, (lots.get(k) ?? new Set()).add(lotKey(c)));
    people.set(k, (people.get(k) ?? new Set()).add(c.by));
    add(r, "bags", c.other ? 0 : c.bags);
    add(r, "pockets", !c.other && c.pocketKg > 0 ? 1 : 0);
    add(r, "units", c.other ? 0 : c.units);
    add(r, "kg", c.other ? 0 : c.kg);
    add(r, "other", c.other ? c.kg : 0);
    groups.set(k, r);
  }
  const rows = [...groups.values()].map((r) => ({
    ...r,
    lots: lots.get(r.group as string)?.size ?? 0,
    eq60: eq((r.kg as number) ?? 0),
    counters: people.get(r.group as string)?.size ?? 0,
  }));
  rows.sort((a, b) => (b.eq60 as number) - (a.eq60 as number));
  const cols: Col[] = [
    { key: "group", label: by === "site" ? "Warehouse" : "Grade" },
    { key: "lots", label: "Lots", kind: "int" },
    { key: "bags", label: "Full bags", kind: "int" },
    { key: "pockets", label: "Pockets", kind: "int" },
    { key: "units", label: "Units", kind: "int" },
    { key: "kg", label: "Kg", kind: "num1" },
    { key: "eq60", label: "60 kg equivalents", kind: "num1" },
    ...(by === "site" ? [{ key: "other", label: "Other stock kg", kind: "num1" as ColKind }, { key: "counters", label: "Counters", kind: "int" as ColKind }] : []),
  ];
  return {
    note: counts.length
      ? `${counts.length} count lines on ${input.stockTake}. Units = full bags + 1 per pocket. Recounts replace the first count of a lot.`
      : "No count lines yet on this stock take.",
    tables: [{ columns: cols, rows, total: rows.length ? totalOf(rows, "Total", ["lots", "bags", "pockets", "units", "kg", "eq60", "other"]) : undefined }],
  };
}

/* ---------- system (XBS) ---------- */

function systemByWarehouse(): ReportOut {
  const rows = SITES.map((s) => {
    const ls = allLines().filter((l) => l.wh === s.code);
    const w = ls.filter((l) => l.t === "W");
    const b = ls.filter((l) => l.t === "B");
    const kg = ls.reduce((a, l) => a + l.kg, 0);
    return {
      group: s.short,
      lots: new Set(ls.map((l) => l.b)).size,
      bags: ls.reduce((a, l) => a + l.bg, 0),
      units: ls.reduce((a, l) => a + l.u, 0),
      kg,
      eqW: eq(w.reduce((a, l) => a + l.kg, 0)),
      eqB: eq(b.reduce((a, l) => a + l.kg, 0)),
      eq60: eq(kg),
    };
  }).filter((r) => r.lots > 0);
  return {
    note: "XBS stock the stock take was set up from. Ibero includes Blocked for Processing.",
    tables: [{
      columns: [
        { key: "group", label: "Warehouse" },
        { key: "lots", label: "Lots", kind: "int" },
        { key: "bags", label: "Full bags", kind: "int" },
        { key: "units", label: "Units", kind: "int" },
        { key: "kg", label: "Kg", kind: "num1" },
        { key: "eqW", label: "Warehouse eq60", kind: "num1" },
        { key: "eqB", label: "Blocked for Processing eq60", kind: "num1" },
        { key: "eq60", label: "Total eq60", kind: "num1" },
      ],
      rows,
      total: totalOf(rows, "Total", ["lots", "bags", "units", "kg", "eqW", "eqB", "eq60"]),
    }],
  };
}

/* ---------- variance ---------- */

function varianceBy(input: ReportInput, by: "site" | "grade"): ReportOut {
  const counts = currentCounts(input.counts).filter((c) => !c.other);
  const inScope = comparable(input, counts);
  const key = (wh: SiteCode, grade: string) => (by === "site" ? short(wh) : grade || "—");
  const groups = new Map<string, Row>();
  const get = (k: string) => groups.get(k) ?? { group: k, whole: 0, xbs: 0, phys: 0 };
  for (const l of allLines()) {
    const k = key(l.wh, l.i);
    const r = get(k);
    add(r, "whole", eq(l.kg));
    if (inScope(l)) add(r, "xbs", eq(l.kg));
    groups.set(k, r);
  }
  for (const c of counts) {
    const k = key(c.site, c.grade);
    const r = get(k);
    add(r, "phys", eq(c.kg));
    groups.set(k, r);
  }
  const rows = [...groups.values()]
    .filter((r) => by === "site" || (r.xbs as number) > 0 || (r.phys as number) > 0)
    .map((r) => {
      const compared = (r.xbs as number) > 0 || (r.phys as number) > 0;
      const cover = (r.whole as number) ? (r.xbs as number) / (r.whole as number) : undefined;
      const status = !compared ? "Not counted" : cover !== undefined && cover < 0.995 ? "Partly counted" : "Counted";
      const diff = compared ? (r.phys as number) - (r.xbs as number) : undefined;
      return {
        ...r,
        status,
        cover,
        xbs: compared ? r.xbs : undefined,
        phys: compared ? r.phys : undefined,
        diff,
        pct: diff === undefined || !r.xbs ? undefined : diff / (r.xbs as number),
      };
    });
  rows.sort((a, b) => Math.abs((b.diff as number) ?? 0) - Math.abs((a.diff as number) ?? 0));
  const countedRows = rows.filter((r) => r.diff !== undefined);
  const total = countedRows.length ? totalOf(countedRows, "Total (compared)", ["whole", "xbs", "phys", "diff"]) : undefined;
  if (total) {
    total.pct = (total.xbs as number) ? (total.diff as number) / (total.xbs as number) : undefined;
    total.cover = (total.whole as number) ? (total.xbs as number) / (total.whole as number) : undefined;
  }
  return {
    note:
      "Physical vs XBS (Warehouse + Blocked for Processing) in 60 kg equivalents, as Finance reconciles at month-end. " +
      "Only stock already counted is compared: submitted Ibero stacks, and third-party sites whose count has started. " +
      "Coverage = share of the XBS stock compared so far.",
    tables: [{
      columns: [
        { key: "group", label: by === "site" ? "Warehouse" : "Grade" },
        ...(by === "site" ? [{ key: "status", label: "Status" }] : []),
        { key: "whole", label: "XBS whole eq60", kind: "num1" as ColKind },
        { key: "xbs", label: "XBS compared eq60", kind: "num1" as ColKind },
        { key: "phys", label: "Physical eq60", kind: "num1" as ColKind },
        { key: "diff", label: "Difference eq60", kind: "num1" as ColKind },
        { key: "pct", label: "Difference %", kind: "pct" as ColKind },
        { key: "cover", label: "Coverage %", kind: "pct" as ColKind },
      ],
      rows,
      total,
    }],
  };
}

/** Per outturn per warehouse, like the "General Stock Summary View" Finance uses. */
function varianceByOutturn(input: ReportInput): ReportOut {
  const counts = currentCounts(input.counts).filter((c) => !c.other);
  const inScope = comparable(input, counts);
  const groups = new Map<string, Row>();
  const get = (wh: SiteCode, o: string, g: string) => groups.get(`${wh}|${o}`) ?? { wh: short(wh), outturn: o, grade: g, xbsU: 0, xbs: 0, physU: 0, phys: 0 };
  for (const l of allLines()) {
    if (!inScope(l)) continue;
    const r = get(l.wh, l.o, l.i);
    add(r, "xbsU", l.u);
    add(r, "xbs", eq(l.kg));
    groups.set(`${l.wh}|${l.o}`, r);
  }
  for (const c of counts) {
    const r = get(c.site, c.outturn, c.grade);
    add(r, "physU", c.units);
    add(r, "phys", eq(c.kg));
    groups.set(`${c.site}|${c.outturn}`, r);
  }
  const rows: (Row & { diff: number })[] = [...groups.values()].map((r) => ({ ...r, diff: (r.phys as number) - (r.xbs as number) }));
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || String(a.outturn).localeCompare(String(b.outturn)));
  const off = rows.filter((r) => Math.abs(r.diff) >= 0.5).length;
  return {
    note: `${rows.length} outturns: every counted outturn, plus XBS outturns on submitted stacks and at counted third-party sites. ${off} differ by half a bag or more. Sorted by size of difference.`,
    tables: [{
      columns: [
        { key: "wh", label: "Warehouse" },
        { key: "outturn", label: "Outturn" },
        { key: "grade", label: "Grade" },
        { key: "xbsU", label: "XBS units", kind: "int" },
        { key: "xbs", label: "XBS eq60", kind: "num1" },
        { key: "physU", label: "Counted units", kind: "int" },
        { key: "phys", label: "Counted eq60", kind: "num1" },
        { key: "diff", label: "Difference eq60", kind: "num1" },
      ],
      rows,
      total: rows.length ? totalOf(rows, "Total", ["xbsU", "xbs", "physU", "phys", "diff"]) : undefined,
    }],
  };
}

/* ---------- locations ---------- */

function locationSummary(input: ReportInput): ReportOut {
  const counts = currentCounts(input.counts);
  const status = new Map(input.stacks.map((s) => [`${s.site}|${s.name}`, s.status]));
  const keys = new Set([...input.stacks.map((s) => `${s.site}|${s.name}`), ...counts.map((c) => `${c.site}|${c.stack}`)]);
  const rows: Row[] = [...keys].map((k) => {
    const [wh, stack] = k.split("|") as [SiteCode, string];
    const here = counts.filter((c) => c.site === wh && c.stack === stack);
    const xbsLots = wh === "IBR" ? new Set(allLines().filter((l) => l.wh === wh && l.z === stack).map((l) => l.b)).size : undefined;
    return {
      wh: short(wh),
      stack,
      xbsLots,
      lots: new Set(here.filter((c) => !c.other).map((c) => c.batch)).size,
      units: here.filter((c) => !c.other).reduce((a, c) => a + c.units, 0),
      eq60: eq(here.filter((c) => !c.other).reduce((a, c) => a + c.kg, 0)),
      counters: [...new Set(here.map((c) => c.by))].join(", "),
      status: status.get(k) ?? "In progress",
    };
  });
  rows.sort((a, b) => String(a.wh).localeCompare(String(b.wh)) || String(a.stack).localeCompare(String(b.stack)));
  return {
    note: "Every stack started or submitted on this stock take. XBS lots apply to Ibero stacks; third-party stacks are recorded on the day.",
    tables: [{
      columns: [
        { key: "wh", label: "Warehouse" },
        { key: "stack", label: "Stack" },
        { key: "xbsLots", label: "Lots in XBS", kind: "int" },
        { key: "lots", label: "Lots counted", kind: "int" },
        { key: "units", label: "Units counted", kind: "int" },
        { key: "eq60", label: "Counted eq60", kind: "num1" },
        { key: "counters", label: "Counted by" },
        { key: "status", label: "Status" },
      ],
      rows,
      total: rows.length ? totalOf(rows, "Total", ["lots", "units", "eq60"]) : undefined,
    }],
  };
}

function warehouseSummary(): ReportOut {
  const rows: Row[] = [];
  for (const s of SITES) {
    for (const t of ["W", "B"] as const) {
      const ls = allLines().filter((l) => l.wh === s.code && l.t === t);
      if (!ls.length) continue;
      const kg = ls.reduce((a, l) => a + l.kg, 0);
      rows.push({
        wh: s.short,
        type: t === "W" ? "Warehouse" : "Blocked for Processing",
        lots: new Set(ls.map((l) => l.b)).size,
        blocked: ls.filter((l) => l.bl).length,
        bags: ls.reduce((a, l) => a + l.bg, 0),
        units: ls.reduce((a, l) => a + l.u, 0),
        kg,
        eq60: eq(kg),
      });
    }
  }
  return {
    note: "XBS stock per warehouse and stock type.",
    tables: [{
      columns: [
        { key: "wh", label: "Warehouse" },
        { key: "type", label: "Stock type" },
        { key: "lots", label: "Lots", kind: "int" },
        { key: "blocked", label: "Blocked lines", kind: "int" },
        { key: "bags", label: "Full bags", kind: "int" },
        { key: "units", label: "Units", kind: "int" },
        { key: "kg", label: "Kg", kind: "num1" },
        { key: "eq60", label: "eq60", kind: "num1" },
      ],
      rows,
      total: totalOf(rows, "Total", ["lots", "blocked", "bags", "units", "kg", "eq60"]),
    }],
  };
}

/* ---------- registers of activity ---------- */

function historicalImports(): ReportOut {
  const rows: Row[] = IMPORTS.map((i) => ({ id: i.id, at: i.at, by: i.by, files: i.files.length, rows: i.rows, issues: i.issues, status: i.status }));
  return {
    note: "Every XBS upload. Imports are never changed; a newer import supersedes the older one.",
    tables: [{
      columns: [
        { key: "id", label: "Import" },
        { key: "at", label: "Snapshot" },
        { key: "by", label: "Imported by" },
        { key: "files", label: "Files", kind: "int" },
        { key: "rows", label: "Rows", kind: "int" },
        { key: "issues", label: "Warnings + fails", kind: "int" },
        { key: "status", label: "Status" },
      ],
      rows,
    }],
  };
}

function exceptionAnalytics(input: ReportInput): ReportOut {
  const ex = input.exceptions;
  const by = (f: (e: Exception) => string): Row[] => {
    const m = new Map<string, Row>();
    for (const e of ex) {
      const k = f(e);
      const r = m.get(k) ?? { group: k, open: 0, overdue: 0, escalated: 0, closed: 0, bags: 0 };
      if (e.status === "Closed") add(r, "closed", 1);
      else {
        add(r, "open", 1);
        if (e.dueDays < 0) add(r, "overdue", 1);
        if (e.status === "Escalated") add(r, "escalated", 1);
        add(r, "bags", e.bags ?? 0);
      }
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => (b.open as number) - (a.open as number));
  };
  const cols = (first: string): Col[] => [
    { key: "group", label: first },
    { key: "open", label: "Open", kind: "int" },
    { key: "overdue", label: "Overdue", kind: "int" },
    { key: "escalated", label: "Escalated", kind: "int" },
    { key: "closed", label: "Closed", kind: "int" },
    { key: "bags", label: "Bags affected (open)", kind: "int" },
  ];
  const age = (e: Exception) => (e.ageDays <= 5 ? "0–5 days" : e.ageDays <= 10 ? "6–10 days" : "Over 10 days");
  const sum5 = ["open", "overdue", "escalated", "closed", "bags"];
  const t = (title: string, rows: Row[], first: string): ReportTable => ({ title, columns: cols(first), rows, total: rows.length ? totalOf(rows, "Total", sum5) : undefined });
  return {
    note: `${ex.length} exceptions in total.`,
    tables: [t("By root cause", by((e) => e.kind), "Root cause"), t("By department", by((e) => e.dept), "Department"), t("By owner", by((e) => e.owner || "Not assigned"), "Owner"), t("By age", by(age), "Age")],
  };
}

function complaintsLog(input: ReportInput): ReportOut {
  const rows: Row[] = input.issues.map((i) => ({
    id: i.id, at: i.at, by: i.by, wh: short(i.site), category: i.category, text: i.text, status: i.status,
    owner: i.owner ?? "", cause: i.linkedCause ?? "", reply: i.resolution ?? "",
  }));
  return {
    note: `${rows.length} problem reports from counters; ${input.issues.filter((i) => i.status !== "Resolved").length} not yet resolved.`,
    tables: [{
      columns: [
        { key: "id", label: "Report" }, { key: "at", label: "Raised" }, { key: "by", label: "By" }, { key: "wh", label: "Warehouse" },
        { key: "category", label: "Category" }, { key: "text", label: "Description" }, { key: "status", label: "Status" },
        { key: "owner", label: "Owner" }, { key: "cause", label: "Linked cause" }, { key: "reply", label: "Reply" },
      ],
      rows,
    }],
  };
}

function signOffPack(input: ReportInput): ReportOut {
  const gates: Row[] = CHAIN.map((c) => {
    const s = input.signatures[c.role];
    return { gate: c.title, signs: c.signs, by: s?.by ?? "Not signed", at: s?.at ?? "", comment: s?.comment ?? "" };
  });
  // Reconciliation by primary basket, physical vs XBS at counted warehouses.
  const counts = currentCounts(input.counts).filter((c) => !c.other);
  const inScope = comparable(input, counts);
  const primaryOf = new Map(basketMap().map((b) => [b.code, b.primary]));
  const basketOfBatch = new Map(allLines().map((l) => [l.b, l.bc]));
  const prim = (bc?: string) => (bc ? primaryOf.get(bc) ?? "Not mapped" : "No basket");
  const recon = new Map<string, Row>();
  const get = (k: string) => recon.get(k) ?? { basket: k, xbs: 0, phys: 0 };
  for (const l of allLines()) {
    if (!inScope(l)) continue;
    const r = get(prim(l.bc));
    add(r, "xbs", eq(l.kg));
    recon.set(r.basket as string, r);
  }
  for (const c of counts) {
    const r = get(prim(basketOfBatch.get(c.batch)));
    add(r, "phys", eq(c.kg));
    recon.set(r.basket as string, r);
  }
  const reconRows = [...recon.values()].map((r) => ({ ...r, diff: (r.phys as number) - (r.xbs as number) }));
  const vRows: Row[] = input.variances.map((v) => ({
    id: v.id, wh: short(v.site), stack: v.zone, outturn: v.outturn, grade: v.grade, expected: v.expected, counted: v.counted,
    diff: v.counted - v.expected, cause: v.cause, state: { open: "Open", recount: "Recount sent", accepted: "Accepted", exception: "Exception raised" }[v.state],
  }));
  return {
    note: `${input.stockTake}: sign-off gates, reconciliation by primary basket for the stock counted so far, and every variance.`,
    tables: [
      { title: "Sign-off", columns: [{ key: "gate", label: "Gate" }, { key: "signs", label: "Certifies" }, { key: "by", label: "Signed by" }, { key: "at", label: "When" }, { key: "comment", label: "Comment" }], rows: gates },
      {
        title: "Reconciliation by primary basket (eq60, counted stock)",
        columns: [{ key: "basket", label: "Primary basket" }, { key: "xbs", label: "XBS eq60", kind: "num1" }, { key: "phys", label: "Physical eq60", kind: "num1" }, { key: "diff", label: "Difference eq60", kind: "num1" }],
        rows: reconRows,
        total: reconRows.length ? totalOf(reconRows, "Total", ["xbs", "phys", "diff"]) : undefined,
      },
      {
        title: "Variances (units)",
        columns: [
          { key: "id", label: "Variance" }, { key: "wh", label: "Warehouse" }, { key: "stack", label: "Stack" }, { key: "outturn", label: "Outturn" }, { key: "grade", label: "Grade" },
          { key: "expected", label: "XBS units", kind: "int" }, { key: "counted", label: "Counted units", kind: "int" }, { key: "diff", label: "Difference", kind: "int" },
          { key: "cause", label: "Cause" }, { key: "state", label: "Decision" },
        ],
        rows: vRows,
      },
    ],
  };
}

/* ---------- catalogue ---------- */

export const REPORTS: { id: string; name: string; what: string; build: (i: ReportInput) => ReportOut }[] = [
  { id: "phys-wh", name: "Physical count by warehouse", what: "Lots, bags, pockets, units, kg and 60 kg equivalents counted, per warehouse", build: (i) => physicalBy(i, "site") },
  { id: "phys-grade", name: "Physical count by grade", what: "The same, per grade", build: (i) => physicalBy(i, "grade") },
  { id: "sys-wh", name: "System count by warehouse", what: "XBS stock per warehouse, Warehouse and Blocked for Processing", build: () => systemByWarehouse() },
  { id: "var-wh", name: "Variance by warehouse", what: "Physical − XBS in 60 kg equivalents and %, per warehouse", build: (i) => varianceBy(i, "site") },
  { id: "var-grade", name: "Variance by grade", what: "Physical − XBS in 60 kg equivalents and %, per grade", build: (i) => varianceBy(i, "grade") },
  { id: "var-outturn", name: "Variance by outturn", what: "Per outturn per warehouse, as on Finance's month-end summary", build: varianceByOutturn },
  { id: "locations", name: "Location summary", what: "Per stack: lots in XBS, lots and units counted, status", build: locationSummary },
  { id: "wh-summary", name: "Warehouse summary", what: "XBS stock by warehouse and stock type", build: () => warehouseSummary() },
  { id: "imports", name: "Historical imports", what: "Every XBS upload with its checks", build: () => historicalImports() },
  { id: "exceptions", name: "Exception analytics", what: "Exceptions by root cause, department, owner and age", build: exceptionAnalytics },
  { id: "complaints", name: "Complaints log", what: "Problems raised by counters and how they were resolved", build: complaintsLog },
  { id: "signoff", name: "Sign-off pack", what: "Signatures, reconciliation by primary basket and every variance", build: signOffPack },
];
