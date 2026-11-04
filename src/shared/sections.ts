// Ibero locations and the sections counters are allocated to. Shared by the
// Stock Take app (which stacks are mine) and the Hub (random counter allocation),
// so both read a section the same way. Keep identical in both apps
// (`npm run check:shared`).
//
// Words (agreed 3 Nov 2026), the same on every screen and in the docs:
//   Location = the whole code, "D-05-1" (XBS's "Zone" column; where you go and stand)
//   Bay      = row + bay, "D-05" ("Location" in the old Physical Count app)
//   Zone     = the last number, "1" (the old app's "Zone" column): the stack position in the bay
//   Level    = height. Not recorded anywhere.
// Location codes: "D-05-1" = row D, bay 5, zone 1; "D-05/06-1" spans bays 5–6; "A/B-14-1" sits
// between rows A and B. parseZone and stk_zone keep XBS's column name.
// Section tokens: "D" = all of row D · "D1-7" = row D, bays 1–7 ·
// "C/D" = the stacks between rows C and D · "C/D1-7" = those in bays 1–7.
// A stack belongs to the section of its FIRST bay, so every stack has exactly
// one section and nothing is counted twice or missed.
//
// Two Ibero buildings, one compound, one count team (layouts from XBS's Zone
// report, 15 Oct 2026, which is exactly this grid; scripts/xbs/import-zones.mjs
// checks a new report still is):
//   IBR Ibero Export Warehouse  rows A–G, bays 1–14, zones 1–18
//   IBM Ibero Mill Export       rows A–J, bays 15–24, zones 1–18 (no stock yet)
// Each building has its own rows and between-rows; a zone or section is read
// against its site's layout. The bay numbers don't overlap, so "D-17-3" can only
// be in Mill Export. The site defaults to IBR, so callers that only know the
// Export Warehouse don't change.

export interface Layout {
  rows: string;
  bayFrom: number;
  bayTo: number;
  /** Zones (stack positions) per bay: 1 to this. */
  zones: number;
}

export const LAYOUTS: Record<string, Layout> = {
  IBR: { rows: "ABCDEFG", bayFrom: 1, bayTo: 14, zones: 18 },
  IBM: { rows: "ABCDEFGHIJ", bayFrom: 15, bayTo: 24, zones: 18 },
};
export const layoutOf = (site = "IBR"): Layout => LAYOUTS[site] ?? LAYOUTS.IBR;
/** Sites counted by location (row, bay, zone) rather than as a whole site. */
export const hasLayout = (site?: string | null) => !!site && site in LAYOUTS;
export const LAYOUT_SITES = Object.keys(LAYOUTS);

// The Export Warehouse's layout, for code that only knows that building.
export const IBERO_ROWS = LAYOUTS.IBR.rows;
export const IBERO_BAYS = LAYOUTS.IBR.bayTo;

const ZONE_RE = /^([A-Z])(?:\/([A-Z]))?-(\d{2})(?:\/(\d{2}))?-(\d+)$/;
const SECTION_RE = /^([A-Z])(?:\/([A-Z]))?(?:(\d{1,2})-(\d{1,2}))?$/;

/** A location code read apart: rows, bays and the zone (stack position in the bay). */
export interface Location {
  row: string;
  rowTo: string;
  between: boolean;
  bay: number;
  bayTo: number;
  zone: number;
}

export function parseZone(z: string): Location | null {
  const m = z.match(ZONE_RE);
  if (!m) return null;
  const row = m[1];
  const rowTo = m[2] ?? row;
  return { row, rowTo, between: rowTo !== row, bay: +m[3], bayTo: m[4] ? +m[4] : +m[3], zone: +m[5] };
}

/** Is this a real location in the site's layout? (Rows next to each other, bays in range, a span is two neighbouring bays, zone 1–18.) */
export function zoneFits(zone: string, site = "IBR") {
  const z = parseZone(zone);
  const l = LAYOUTS[site];
  if (!z || !l) return false;
  const r = l.rows.indexOf(z.row);
  const rowsOk = r >= 0 && (!z.between || l.rows.indexOf(z.rowTo) === r + 1);
  const baysOk = z.bay >= l.bayFrom && z.bayTo <= l.bayTo && (z.bayTo === z.bay || z.bayTo === z.bay + 1);
  return rowsOk && baysOk && z.zone >= 1 && z.zone <= l.zones;
}

/** Which Ibero building a location code belongs to, or undefined (TEMP-0-0, a typo). */
export const zoneSite = (zone: string) => LAYOUT_SITES.find((s) => zoneFits(zone, s));

export interface Section {
  token: string;
  row: string;
  rowTo: string;
  between: boolean;
  bayFrom: number;
  bayTo: number;
}

export function parseSection(token: string, site = "IBR"): Section | null {
  const l = layoutOf(site);
  const t = token.trim().toUpperCase();
  const m = t.match(SECTION_RE);
  if (!m) return null;
  const row = m[1];
  const rowTo = m[2] ?? row;
  if (l.rows.indexOf(row) < 0) return null;
  if (m[2] && l.rows.indexOf(rowTo) !== l.rows.indexOf(row) + 1) return null; // between neighbouring rows only
  const bayFrom = m[3] ? +m[3] : l.bayFrom;
  const bayTo = m[4] ? +m[4] : l.bayTo;
  if (bayFrom < l.bayFrom || bayTo > l.bayTo || bayFrom > bayTo) return null;
  return { token: t, row, rowTo, between: rowTo !== row, bayFrom, bayTo };
}

/** Section tokens from an assignment: "D1-7, D8-14 ,C/D" → ["D1-7","D8-14","C/D"]. */
export const sectionList = (text?: string | null, site = "IBR") =>
  (text ?? "")
    .split(/[,;]/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => parseSection(x, site));

/** Does this stack belong to this section (by its first bay)? */
export function zoneInSection(zone: string, token: string, site = "IBR") {
  const z = parseZone(zone);
  const s = parseSection(token, site);
  if (!z || !s || !zoneFits(zone, site)) return false;
  return z.between === s.between && z.row === s.row && z.rowTo === s.rowTo && z.bay >= s.bayFrom && z.bay <= s.bayTo;
}

export const zoneInSections = (zone: string, tokens: string[], site = "IBR") => tokens.some((t) => zoneInSection(zone, t, site));

/** Rows a section touches: one, or two for a between-rows section. */
export function sectionRows(token: string, site = "IBR") {
  const s = parseSection(token, site);
  return s ? (s.between ? [s.row, s.rowTo] : [s.row]) : [];
}

const wholeRow = (s: Section, l: Layout) => s.bayFrom === l.bayFrom && s.bayTo === l.bayTo;

/** Plain words for a section: "Row D, bays 1–7", "Between rows C and D". */
export function sectionWords(token: string, site = "IBR") {
  const l = layoutOf(site);
  const s = parseSection(token, site);
  if (!s) return token;
  const rows = s.between ? `Between rows ${s.row} and ${s.rowTo}` : `Row ${s.row}`;
  return wholeRow(s, l) ? rows : `${rows}, bays ${s.bayFrom}–${s.bayTo}`;
}

/** Sections in floor order: by row (stacks between two rows after the row above), then by bay. */
export function sortSections(tokens: string[], site = "IBR") {
  const l = layoutOf(site);
  return [...tokens].sort((a, b) => {
    const x = parseSection(a, site);
    const y = parseSection(b, site);
    if (!x || !y) return a.localeCompare(b);
    return l.rows.indexOf(x.row) - l.rows.indexOf(y.row) || Number(x.between) - Number(y.between) || x.bayFrom - y.bayFrom;
  });
}

/** Plain words for a counter's sections: "rows A, B and G; row D, bays 1–7; between C and D". */
export function sectionsWords(tokens: string[], site = "IBR") {
  const l = layoutOf(site);
  const ss = sortSections(tokens, site)
    .map((t) => parseSection(t, site))
    .filter((x): x is Section => !!x);
  const whole = (x: Section) => wholeRow(x, l);
  const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const bays = (x: Section) => (whole(x) ? "" : `, bays ${x.bayFrom}–${x.bayTo}`);
  const rows = ss.filter((x) => !x.between && whole(x)).map((x) => x.row);
  return [
    ...(rows.length ? [`${rows.length === 1 ? "row" : "rows"} ${and(rows)}`] : []),
    ...ss.filter((x) => !x.between && !whole(x)).map((x) => `row ${x.row}${bays(x)}`),
    ...ss.filter((x) => x.between).map((x) => `between ${x.row} and ${x.rowTo}${bays(x)}`),
  ].join("; ");
}

/** The section token for a row (or between-rows pair) and a bay range. */
export function sectionToken(row: string, rowTo: string, bayFrom?: number, bayTo?: number, site = "IBR") {
  const l = layoutOf(site);
  const from = bayFrom ?? l.bayFrom;
  const to = bayTo ?? l.bayTo;
  const rows = row === rowTo ? row : `${row}/${rowTo}`;
  return from === l.bayFrom && to === l.bayTo ? rows : `${rows}${from}-${to}`;
}
