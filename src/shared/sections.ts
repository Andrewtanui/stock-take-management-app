// Ibero locations and the sections counters are allocated to. Shared by the
// Stock Take app (which stacks are mine) and the Hub (random counter allocation),
// so both read a section the same way. Keep identical in both apps
// (`npm run check:shared`).
//
// Stack codes (XBS zone): "D-05-1" = row D, bay 5, level 1; "D-05/06-1" spans
// bays 5–6; "A/B-14-1" sits between rows A and B.
// Section tokens: "D" = all of row D · "D1-7" = row D, bays 1–7 ·
// "C/D" = the stacks between rows C and D · "C/D1-7" = those in bays 1–7.
// A stack belongs to the section of its FIRST bay, so every stack has exactly
// one section and nothing is counted twice or missed.

const ZONE_RE = /^([A-G])(?:\/([A-G]))?-(\d{2})(?:\/(\d{2}))?-(\d+)$/;
const SECTION_RE = /^([A-G])(?:\/([A-G]))?(?:(\d{1,2})-(\d{1,2}))?$/;
export const IBERO_ROWS = "ABCDEFG";
export const IBERO_BAYS = 14;

export interface Zone {
  row: string;
  rowTo: string;
  between: boolean;
  bay: number;
  bayTo: number;
  level: number;
}

export function parseZone(z: string): Zone | null {
  const m = z.match(ZONE_RE);
  if (!m) return null;
  const row = m[1];
  const rowTo = m[2] ?? row;
  return { row, rowTo, between: rowTo !== row, bay: +m[3], bayTo: m[4] ? +m[4] : +m[3], level: +m[5] };
}

export interface Section {
  token: string;
  row: string;
  rowTo: string;
  between: boolean;
  bayFrom: number;
  bayTo: number;
}

export function parseSection(token: string): Section | null {
  const t = token.trim().toUpperCase();
  const m = t.match(SECTION_RE);
  if (!m) return null;
  const row = m[1];
  const rowTo = m[2] ?? row;
  if (m[2] && IBERO_ROWS.indexOf(rowTo) !== IBERO_ROWS.indexOf(row) + 1) return null; // between neighbouring rows only
  const bayFrom = m[3] ? +m[3] : 1;
  const bayTo = m[4] ? +m[4] : IBERO_BAYS;
  if (bayFrom < 1 || bayTo > IBERO_BAYS || bayFrom > bayTo) return null;
  return { token: t, row, rowTo, between: rowTo !== row, bayFrom, bayTo };
}

/** Section tokens from an assignment: "D1-7, D8-14 ,C/D" → ["D1-7","D8-14","C/D"]. */
export const sectionList = (text?: string | null) =>
  (text ?? "")
    .split(/[,;]/)
    .map((x) => x.trim().toUpperCase())
    .filter((x) => parseSection(x));

/** Does this stack belong to this section (by its first bay)? */
export function zoneInSection(zone: string, token: string) {
  const z = parseZone(zone);
  const s = parseSection(token);
  if (!z || !s) return false;
  return z.between === s.between && z.row === s.row && z.rowTo === s.rowTo && z.bay >= s.bayFrom && z.bay <= s.bayTo;
}

export const zoneInSections = (zone: string, tokens: string[]) => tokens.some((t) => zoneInSection(zone, t));

/** Rows a section touches: one, or two for a between-rows section. */
export function sectionRows(token: string) {
  const s = parseSection(token);
  return s ? (s.between ? [s.row, s.rowTo] : [s.row]) : [];
}

/** Plain words for a section: "Row D, bays 1–7", "Between rows C and D". */
export function sectionWords(token: string) {
  const s = parseSection(token);
  if (!s) return token;
  const rows = s.between ? `Between rows ${s.row} and ${s.rowTo}` : `Row ${s.row}`;
  const whole = s.bayFrom === 1 && s.bayTo === IBERO_BAYS;
  return whole ? rows : `${rows}, bays ${s.bayFrom}–${s.bayTo}`;
}

/** Sections in floor order: by row (stacks between two rows after the row above), then by bay. */
export function sortSections(tokens: string[]) {
  return [...tokens].sort((a, b) => {
    const x = parseSection(a);
    const y = parseSection(b);
    if (!x || !y) return a.localeCompare(b);
    return IBERO_ROWS.indexOf(x.row) - IBERO_ROWS.indexOf(y.row) || Number(x.between) - Number(y.between) || x.bayFrom - y.bayFrom;
  });
}

/** Plain words for a counter's sections: "rows A, B and G; row D, bays 1–7; between C and D". */
export function sectionsWords(tokens: string[]) {
  const ss = sortSections(tokens)
    .map(parseSection)
    .filter((x): x is Section => !!x);
  const whole = (x: Section) => x.bayFrom === 1 && x.bayTo === IBERO_BAYS;
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
export function sectionToken(row: string, rowTo: string, bayFrom = 1, bayTo = IBERO_BAYS) {
  const rows = row === rowTo ? row : `${row}/${rowTo}`;
  return bayFrom === 1 && bayTo === IBERO_BAYS ? rows : `${rows}${bayFrom}-${bayTo}`;
}
