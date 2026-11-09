// Reads the blind recount sheet the warehouse fills in (made from Level 1's recounts: one row per
// R-number, no XBS figures, no first counts) and plans the answers: one blind count line per
// recount, on its stack. Pure; dataverse.ts writes the plan, then Level 1 settles each recount
// (matches XBS -> accepted; repeats the first count -> exception; neither -> back to the supervisor).

type Cell = string | number | boolean | Date | null | undefined;

const text = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)).replace(/ /g, " ").trim();
/** A number cell, or undefined when it is blank (blank is "not filled in", not 0). */
const num = (c: Cell) => {
  if (c == null || text(c) === "") return undefined;
  const x = typeof c === "number" ? c : Number(text(c).replace(/,/g, ""));
  return Number.isFinite(x) ? x : NaN;
};

export interface RecountSheetRow {
  /** Row in the sheet (1-based), for messages. */
  row: number;
  recount: string;
  location: string;
  outturn: string;
  grade: string;
  batch: string;
  fullBags?: number;
  pocketKg?: number;
  totalKg?: number;
  notFound: boolean;
  by: string;
  /** As written: "05/11/2026 10:30", or an ISO time when Excel stored a date. */
  when: string;
  comment: string;
}

/** An open (or answered) recount Level 1 sent, as the Hub knows it. */
export interface RecountTarget {
  id: string;
  name: string;
  outturn: string;
  stack: string;
  open: boolean;
  /** Packing of the lot (50 or 60 kg bags): from its first count, else 60. */
  packKg: 50 | 60;
}

export interface RecountAnswer {
  recountId: string;
  recount: string;
  outturn: string;
  stack: string;
  fullBags: number;
  pocketKg: number;
  /** Full bags + one if there is a pocket. */
  units: number;
  kg: number;
  packKg: 50 | 60;
  notFound: boolean;
  by: string;
  /** ISO time of the recount when the sheet gives one. */
  at?: string;
  comment: string;
}

export interface RecountPlan {
  rows: number;
  answers: RecountAnswer[];
  /** R-numbers on the sheet nobody filled in (they stay open). */
  notFilled: string[];
  /** Rows that can't be loaded; the load is refused while there are any. */
  errors: string[];
  /** Loaded, but worth a look. */
  notes: string[];
  /** Open recounts the sheet doesn't have at all. */
  missing: string[];
}

/** The sheet: header row with "Recount" and "Full bags"; the rows below it that start with an R-number. */
export function parseRecountSheet(data: Cell[][]): RecountSheetRow[] | undefined {
  const at = data.findIndex((r) => text(r?.[0]) === "Recount" && (r ?? []).some((c) => text(c) === "Full bags"));
  if (at < 0) return undefined;
  const h = (data[at] ?? []).map(text);
  const c = (name: string) => {
    const i = h.indexOf(name);
    if (i < 0) throw new Error(`The recount sheet has no "${name}" column.`);
    return i;
  };
  const C = { r: 0, loc: c("Location"), o: c("Outturn"), g: c("Grade"), b: c("Batch (XBS)"), bags: c("Full bags"), pk: c("Pocket kg"), kg: c("Total kg"), nf: c("Not found"), by: c("Recounted by"), when: c("When"), note: c("Comment") };
  const rows: RecountSheetRow[] = [];
  data.slice(at + 1).forEach((r, i) => {
    const name = text(r?.[C.r]).toUpperCase();
    if (!/^R-\d+$/.test(name)) return;
    rows.push({
      row: at + 2 + i,
      recount: name,
      location: text(r[C.loc]),
      outturn: text(r[C.o]),
      grade: text(r[C.g]),
      batch: text(r[C.b]),
      fullBags: num(r[C.bags]),
      pocketKg: num(r[C.pk]),
      totalKg: num(r[C.kg]),
      notFound: /^y(es)?$/i.test(text(r[C.nf])),
      by: text(r[C.by]),
      when: r[C.when] instanceof Date ? (r[C.when] as Date).toISOString() : text(r[C.when]),
      comment: text(r[C.note]),
    });
  });
  return rows;
}

/** "05/11/2026 10:30" (Nairobi time) or an ISO time -> ISO; undefined if it can't be read. */
export function recountTime(s: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?$/);
  if (!m) return undefined;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (m[4] ? +m[4] : 12) - 3, m[5] ? +m[5] : 0)).toISOString();
}

/** Weights agree within this (pockets are weighed to the kilo). */
const TOL_KG = 1;

export function planRecountAnswers(rows: RecountSheetRow[], targets: RecountTarget[]): RecountPlan {
  const plan: RecountPlan = { rows: rows.length, answers: [], notFilled: [], errors: [], notes: [], missing: [] };
  const byName = new Map(targets.map((t) => [t.name.toUpperCase(), t]));
  const seen = new Set<string>();
  for (const r of rows) {
    const where = `Row ${r.row} (${r.recount})`;
    const t = byName.get(r.recount);
    if (!t) {
      plan.errors.push(`${where}: no recount ${r.recount} in this stock take. Is the sheet for another stock take?`);
      continue;
    }
    if (seen.has(r.recount)) {
      plan.errors.push(`${where}: ${r.recount} is on the sheet twice.`);
      continue;
    }
    seen.add(r.recount);
    if (r.outturn && r.outturn.toUpperCase() !== t.outturn.toUpperCase()) {
      plan.errors.push(`${where}: the sheet says ${r.outturn}, but ${r.recount} is ${t.outturn}.`);
      continue;
    }
    const filled = r.fullBags !== undefined || r.pocketKg !== undefined || r.totalKg !== undefined || r.notFound;
    if (!filled) {
      if (t.open) plan.notFilled.push(r.recount);
      continue;
    }
    if (!t.open) {
      plan.notes.push(`${where}: ${r.recount} is already answered; this row is skipped.`);
      continue;
    }
    if ([r.fullBags, r.pocketKg, r.totalKg].some((x) => x !== undefined && (Number.isNaN(x) || x < 0))) {
      plan.errors.push(`${where}: full bags, pocket kg and total kg must be numbers, 0 or more.`);
      continue;
    }
    const fullBags = r.notFound ? 0 : Math.round(r.fullBags ?? 0);
    const pocketKg = r.notFound ? 0 : (r.pocketKg ?? 0);
    if (!r.notFound && fullBags !== (r.fullBags ?? 0)) plan.notes.push(`${where}: ${r.fullBags} full bags read as ${fullBags}.`);
    if (pocketKg >= t.packKg) {
      plan.errors.push(`${where}: a pocket of ${pocketKg} kg is a full ${t.packKg} kg bag or more. Count it in full bags.`);
      continue;
    }
    const worked = fullBags * t.packKg + pocketKg;
    let kg = worked;
    if (r.notFound) {
      if ((r.fullBags ?? 0) > 0 || (r.pocketKg ?? 0) > 0 || (r.totalKg ?? 0) > 0) plan.notes.push(`${where}: marked Not found but has figures; loaded as not found (0).`);
      kg = 0;
    } else if (r.totalKg !== undefined) {
      kg = r.totalKg;
      if (Math.abs(r.totalKg - worked) > TOL_KG)
        plan.notes.push(`${where}: total ${r.totalKg} kg, but ${fullBags} × ${t.packKg} kg + ${pocketKg} kg pocket = ${worked} kg. The total is used.`);
    }
    if (!r.by) plan.notes.push(`${where}: no name under "Recounted by".`);
    const at = r.when ? recountTime(r.when) : undefined;
    if (r.when && !at) plan.notes.push(`${where}: "${r.when}" isn't a date and time like 05/11/2026 10:30; the load time is used.`);
    plan.answers.push({
      recountId: t.id,
      recount: r.recount,
      outturn: t.outturn,
      stack: t.stack,
      fullBags,
      pocketKg,
      units: fullBags + (pocketKg > 0 ? 1 : 0),
      kg: Math.round(kg * 100) / 100,
      packKg: t.packKg,
      notFound: r.notFound || (fullBags === 0 && pocketKg === 0 && kg === 0),
      by: r.by,
      at,
      comment: r.comment,
    });
  }
  plan.missing = targets.filter((t) => t.open && !seen.has(t.name.toUpperCase())).map((t) => t.name);
  return plan;
}
