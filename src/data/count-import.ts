// Reads a count done in the old Physical Count app (its CSV export) and plans it as count sheets,
// stacks and lines the way the counter app writes them, so Level 1 and the reconciliation run on it.
// Pure: no Dataverse. The Hub's Physical count import page and scripts/counts/import-counts.mjs both
// use it, then write the plan each in their own way.
//
// What it does with the file:
// - the old app writes "Sept-01, 2026 8:58 AM" unquoted (the comma splits the cell) or "11/02/2026 09:08"
//   (month or day first: the reading nearest the count date wins); times are Nairobi time;
// - warehouses by code, name or short name, else a third party by the first word of XBS's name
//   ("KENYA CO-OPERATIVE COFFEE EXPORTERS" = KCCE);
// - each line goes to the XBS lot of its outturn AND grade at that site (49MM0018 AA and AB are two lots);
// - at Ibero, the old app's "Location" is the bay (G-01) and "Zone" the last number: a line goes on the
//   XBS stack where XBS has its lot, else on the XBS stack at that bay and zone (in the row before
//   between-rows, one bay before a span), else on the bay itself. Zone 0 isn't a location: read as 1;
// - at a third party, one stack per clerk (their area) and a "Whole site" marker, finished;
// - the same lot on one stack is one line (the old app often splits a lot over lines);
// - Ibero XBS stacks nobody recorded are submitted empty (it is a full count), unless switched off.

import type { SiteCode } from "./types";

export const WHOLE_SITE = "Whole site"; // the counter app's EMPTY_STACK

export interface ImportSite {
  code: SiteCode;
  name: string;
  shortName?: string;
  thirdParty: boolean;
}

/** One XBS line of the stock take's import. */
export interface ImportLot {
  id: string;
  batch: string;
  outturn: string;
  grade: string;
  zone: string;
  site: SiteCode;
  bfp: boolean;
  kg: number;
}

/**
 * A third-party site with stock in XBS and no lines in the file:
 * "empty" = checked, nothing there; "notCounted" = not counted on purpose (too little to count),
 * the XBS figure stands; "open" = still to come (its count or statement), the count can't close.
 */
export type SiteChoice = "empty" | "notCounted" | "open";

export interface ImportOptions {
  /** Submit the Ibero XBS stacks with nothing recorded as empty (default true: a full count). */
  emptyStacks?: boolean;
  siteChoices?: Partial<Record<SiteCode, SiteChoice>>;
  /** Why the not-counted sites weren't counted, kept on their marker. */
  notCountedReason?: string;
}

export interface PlannedLine {
  /** CSV line numbers merged into this line (the first keys it). */
  rows: number[];
  site: SiteCode;
  stack: string;
  outturn: string;
  grade: string;
  bags: number;
  pocketKg: number;
  pocketBags: number;
  kg: number;
  packKg: 50 | 60;
  at: string;
  clerks: string[];
  lot?: ImportLot;
  /** Not where XBS has it (moved here), or not in XBS at that site at all (no lot). */
  found: boolean;
  /** XBS has the outturn somewhere (another site). */
  inXbs: boolean;
}

export interface PlannedStack {
  site: SiteCode;
  name: string;
  landmark?: string;
  comment?: string;
  /** An Ibero XBS stack with nothing recorded, submitted empty. */
  empty?: boolean;
  /** Third party: every stack counted. */
  finished?: boolean;
  /** Third party: checked, nothing there. */
  nothing?: boolean;
  /** Third party: not counted on purpose, the XBS figure stands. */
  notCounted?: boolean;
}

export interface SiteSummary {
  site: SiteCode;
  thirdParty: boolean;
  countedKg: number;
  xbsKg: number;
  lines: number;
  stacks: number;
  emptyStacks: number;
  /** For a third party with stock in XBS and no lines: what will happen to it. */
  choice?: SiteChoice;
}

export interface CountImportPlan {
  rows: number;
  withStock: number;
  lines: PlannedLine[];
  stacks: PlannedStack[];
  sites: SiteSummary[];
  /** Notes about single lines (time not read, zone 0, units that don't add up). */
  notes: string[];
  /** Lines that can't be loaded (unknown warehouse, no location): the load is refused while there are any. */
  errors: string[];
  clerks: number;
  from?: string;
  to?: string;
}

/** The import page's preview: the plan against the active stock take, before anything is written. */
export interface CountPreview {
  plan: CountImportPlan;
  stockTake: string;
  countDate: string;
  /** The stock take is in Count in progress (the only state a count can be loaded into). */
  counting: boolean;
  /** Lines of this file already in the stock take (an earlier load, finished or stopped part way). */
  alreadyLoaded: number;
  /** XBS total of the stock take's import, kg. */
  xbsKg: number;
}

/* ---------- the CSV ---------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** The old app's unquoted "Sept-01, 2026 8:58 AM" spans two cells: join them back. */
function joinDates(r: string[]) {
  const out: string[] = [];
  for (let i = 0; i < r.length; i++) {
    if (/^[A-Za-z]{3,5}-\d{1,2}$/.test(r[i].trim()) && /^\s*\d{4}\b/.test(r[i + 1] ?? "")) out.push(`${r[i]},${r[++i]}`);
    else out.push(r[i]);
  }
  return out;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Old-app time (Nairobi) -> ISO, or undefined. */
export function oldAppTime(s: string | undefined, countDate: string) {
  s = (s ?? "").trim();
  const hm = (h: string, m: string, ap?: string) => [ap ? (Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0) : Number(h), Number(m)];
  let m = s.match(/^([A-Za-z]{3,5})-(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    const [h, mi] = hm(m[4], m[5], m[6]);
    return new Date(Date.UTC(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), h - 3, mi)).toISOString();
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    const [h, mi] = hm(m[4], m[5], m[6]);
    const y = Number(m[3]);
    const mk = (mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? new Date(Date.UTC(y, mo - 1, d, h - 3, mi)) : undefined);
    const ref = Date.parse(countDate);
    const opts = [mk(Number(m[1]), Number(m[2])), mk(Number(m[2]), Number(m[1]))].filter((x): x is Date => !!x);
    return opts.sort((a, b) => Math.abs(+a - ref) - Math.abs(+b - ref))[0]?.toISOString();
  }
  return undefined;
}

/** Warehouse names in the old app -> site codes. */
export function siteMatcher(sites: ImportSite[]) {
  const norm = (x?: string) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const first = (x?: string) => (x ?? "").trim().toUpperCase().split(/\s+/)[0];
  return (name: string): SiteCode | undefined => {
    const n = norm(name);
    if (!n) return undefined;
    return (
      sites.find((s) => [s.code, s.name, s.shortName].some((x) => norm(x) === n))?.code ??
      sites.find((s) => (s.shortName && n.includes(norm(s.shortName))) || norm(s.name).includes(n))?.code ??
      sites.find((s) => s.thirdParty && first(s.name) === first(name))?.code
    );
  };
}

// Location codes: "A-01-1" or "A/B-01/02-1" (rows, bays, zone). Rows A-J cover both Ibero buildings.
const ZONE = /^([A-Z])(?:\/([A-Z]))?-(\d{2})(?:\/(\d{2}))?-(\d+)$/;
const covers = (z: string, row: string, bay: number, zone: number) => {
  const m = ZONE.exec(z ?? "");
  if (!m) return false;
  const [b1, b2] = [Number(m[3]), Number(m[4] ?? m[3])];
  return (row === m[1] || row === (m[2] ?? m[1])) && b1 <= bay && bay <= b2 && Number(m[5]) === zone;
};
/** In the row itself before between two rows (C/D-...), one bay before a span of two. */
const fit = (z: string) => (/^[A-Z]\//.test(z) ? 2 : 0) + (/-\d{2}\/\d{2}-/.test(z) ? 1 : 0);

/* ---------- the plan ---------- */

export function planCountImport(csvText: string, countDate: string, sites: ImportSite[], lots: ImportLot[], opt: ImportOptions = {}): CountImportPlan {
  const [header = [], ...body] = parseCsv(csvText.replace(/^﻿/, ""));
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase()); // the first one (Receive Location is there twice)
  const C = { o: col("Outturn"), wh: col("Warehouse"), grade: col("Grade"), bags: col("Bags"), pockets: col("Pockets"), units: col("Units"), kg: col("Physical Weight"), loc: col("Location"), zone: col("Zone"), at: col("Created"), by: col("Created By") };
  const missing = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`This isn't the old app's Physical Count export: no ${missing.join(", ")} column.`);
  const rows = body.map(joinDates);
  const siteOf = siteMatcher(sites);
  const siteBy = new Map(sites.map((s) => [s.code, s]));
  const notes: string[] = [];
  const errors: string[] = [];
  const num = (x?: string) => Number(String(x ?? "").replace(/,/g, "").trim() || 0);
  const up = (x?: string) => (x ?? "").trim().toUpperCase();
  const clerkAreas = new Map<string, string>();

  type Parsed = Omit<PlannedLine, "rows" | "pocketBags" | "packKg" | "clerks"> & { n: number; clerk: string; landmark?: string };
  const parsed: Parsed[] = [];
  rows.forEach((r, i) => {
    const n = i + 2; // the CSV line number
    const site = siteOf(r[C.wh] ?? "");
    if (!site) return void errors.push(`Line ${n}: warehouse "${r[C.wh]}" isn't a known site.`);
    const o = up(r[C.o]);
    const bags = Math.round(num(r[C.bags]));
    const pocketKg = num(r[C.pockets]);
    const units = Math.round(num(r[C.units]));
    const kg = num(r[C.kg]);
    if (!o) return void errors.push(`Line ${n}: no outturn.`);
    if (!bags && !pocketKg && !kg) return; // an empty line
    const clerk = (r[C.by] ?? "").split(" - ").pop()!.trim() || "unknown";
    const at = oldAppTime(r[C.at], countDate);
    if (!at) notes.push(`Line ${n}: time "${r[C.at]}" not read; the count date is used.`);
    const grade = up(r[C.grade]);
    const same = lots.filter((l) => up(l.outturn) === o && l.site === site);
    const cand = [...same.filter((l) => up(l.grade) === grade), ...same.filter((l) => up(l.grade) !== grade)];
    let stack: string;
    let lot: ImportLot | undefined;
    let found = false;
    let landmark: string | undefined;
    if (!siteBy.get(site)!.thirdParty) {
      const locs = up(r[C.loc]).split(/[\s,;/]+/).filter((x) => /^[A-Z]-?\d{1,2}$/.test(x));
      let zone = /^\d+$/.test((r[C.zone] ?? "").trim()) ? Number(r[C.zone].trim()) : 1;
      if (zone === 0) {
        notes.push(`Line ${n}: ${o} at ${up(r[C.loc])} has zone 0, which isn't a location; read as zone 1.`);
        zone = 1;
      }
      const bayOf = (loc: string) => Number(loc.replace(/\D/g, ""));
      for (const loc of locs) {
        lot = cand.find((l) => covers(l.zone, loc[0], bayOf(loc), zone));
        if (lot) break;
      }
      if (lot) stack = lot.zone;
      else if (locs.length) {
        const here = locs
          .map((loc) => [...new Set(lots.filter((l) => l.site === site && covers(l.zone, loc[0], bayOf(loc), zone)).map((l) => l.zone))].sort((a, b) => fit(a) - fit(b))[0])
          .find(Boolean);
        stack = here ?? `${locs[0][0]}-${String(bayOf(locs[0])).padStart(2, "0")}-${zone}`;
        lot = cand[0];
        found = true;
      } else return void errors.push(`Line ${n}: ${o} has no readable location ("${r[C.loc]}").`);
    } else {
      const k = `${site}|${clerk}`;
      if (!clerkAreas.has(k)) clerkAreas.set(k, `Area ${[...clerkAreas.keys()].filter((x) => x.startsWith(site + "|")).length + 1}`);
      stack = clerkAreas.get(k)!;
      landmark = `Counted by ${clerk} (old app location: ${(r[C.loc] ?? "").trim() || "none"})`.slice(0, 200);
      lot = cand[0];
      found = !lot;
    }
    if (units && units !== bags + (pocketKg > 0 ? 1 : 0))
      notes.push(`Line ${n}: ${o} has ${units} units against ${bags} bags + ${pocketKg ? "1 pocket" : "no pocket"}; bags and pocket used.`);
    parsed.push({ n, site, stack, landmark, outturn: o, grade: (r[C.grade] ?? "").trim(), bags, pocketKg, kg, at: at ?? `${countDate}T12:00:00Z`, clerk, lot, found, inXbs: lots.some((l) => up(l.outturn) === o) });
  });

  // One line per stack and lot.
  const merged = new Map<string, PlannedLine & { landmark?: string }>();
  for (const p of parsed) {
    const k = `${p.site}|${p.stack}|${p.lot?.batch ?? "NEW:" + p.outturn}`;
    const e = merged.get(k) ?? { ...p, rows: [], bags: 0, pocketKg: 0, pocketBags: 0, kg: 0, clerks: [], packKg: 60 as const };
    e.bags += p.bags;
    e.pocketKg += p.pocketKg;
    e.pocketBags += p.pocketKg > 0 ? 1 : 0;
    e.kg += p.kg;
    e.rows.push(p.n);
    if (!e.clerks.includes(p.clerk)) e.clerks.push(p.clerk);
    if (p.at > e.at) e.at = p.at;
    merged.set(k, e);
  }
  const lines: PlannedLine[] = [...merged.values()].map(({ landmark: _l, ...e }) => ({
    ...e,
    packKg: e.bags && Math.abs((e.kg - e.pocketKg) / e.bags - 50) < 0.5 ? 50 : 60,
  }));

  // Stacks: counted ones, Ibero XBS stacks nobody recorded, third-party markers.
  const stacks = new Map<string, PlannedStack>();
  for (const p of merged.values()) if (!stacks.has(`${p.site}|${p.stack}`)) stacks.set(`${p.site}|${p.stack}`, { site: p.site, name: p.stack, landmark: p.landmark });
  const countedSites = new Set(lines.map((l) => l.site));
  if (opt.emptyStacks !== false)
    for (const l of lots)
      if (!siteBy.get(l.site)?.thirdParty && countedSites.has(l.site) && l.zone && !stacks.has(`${l.site}|${l.zone}`))
        stacks.set(`${l.site}|${l.zone}`, { site: l.site, name: l.zone, empty: true, comment: "Nothing recorded at this stack in the old app count" });
  for (const s of countedSites)
    if (siteBy.get(s)!.thirdParty) stacks.set(`${s}|${WHOLE_SITE}`, { site: s, name: WHOLE_SITE, finished: true, comment: "Every stack counted (old app count, loaded)" });

  // Third parties with stock in XBS and nothing in the file.
  const choices: Partial<Record<SiteCode, SiteChoice>> = {};
  for (const s of sites.filter((x) => x.thirdParty && !countedSites.has(x.code) && lots.some((l) => l.site === x.code && l.kg > 0))) {
    const c = opt.siteChoices?.[s.code] ?? "open";
    choices[s.code] = c;
    if (c === "empty") stacks.set(`${s.code}|${WHOLE_SITE}`, { site: s.code, name: WHOLE_SITE, nothing: true, comment: "Checked: nothing to count here (old app count)" });
    if (c === "notCounted")
      stacks.set(`${s.code}|${WHOLE_SITE}`, { site: s.code, name: WHOLE_SITE, notCounted: true, comment: `Not counted: ${opt.notCountedReason?.trim() || "too little to count"}. The XBS figure stands.`.slice(0, 2000) });
  }

  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const all = [...stacks.values()];
  const siteList = [...new Set([...lots.map((l) => l.site), ...lines.map((l) => l.site)])];
  const times = parsed.map((p) => p.at).sort();
  return {
    rows: rows.length,
    withStock: parsed.length,
    lines,
    stacks: all,
    sites: siteList.map((s) => ({
      site: s,
      thirdParty: !!siteBy.get(s)?.thirdParty,
      countedKg: sum(lines.filter((l) => l.site === s), (l) => l.kg),
      xbsKg: sum(lots.filter((l) => l.site === s), (l) => l.kg),
      lines: lines.filter((l) => l.site === s).length,
      stacks: all.filter((x) => x.site === s && !x.empty && x.name !== WHOLE_SITE).length,
      emptyStacks: all.filter((x) => x.site === s && x.empty).length,
      choice: choices[s],
    })),
    notes,
    errors,
    clerks: new Set(parsed.map((p) => p.clerk)).size,
    from: times[0],
    to: times.at(-1),
  };
}
