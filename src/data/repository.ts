// Reference data for the Stock Management app, plus the checks and
// calculations screens use. The data is loaded once at start-up by the active
// data source (mock or Dataverse, see ./source) and handed to setReference();
// screens never read the JSON or call Dataverse directly.

import type {
  BasketMap,
  Check,
  Counter,
  DirectPurchase,
  ImportCheck,
  PrimaryBasket,
  Role,
  Site,
  SiteCode,
  UserRow,
  XbsImport,
  XbsLine,
} from "./types";
import type { Reference, Today } from "./source/types";

// Live ES-module bindings: importers see the values set by setReference().
let lines: XbsLine[] = [];
let COUNTED_BAGS: Partial<Record<SiteCode, number>> = {};

export function setReference(r: Reference) {
  lines = r.lines;
  TODAY = r.today;
  SITES = r.sites;
  IMPORTS = r.imports;
  COUNTERS = r.counters;
  HOURLY = r.hourly;
  COUNTED_BAGS = r.countedBags;
  DIRECT_PURCHASES = r.directPurchases;
  USERS = r.users;
  PACK_TYPES = r.packTypes;
  STOCK_TAKE_GROUPS = r.stockTakeGroups;
  CANCELLED = new Set(r.contracts.cancelled);
  SHIPPED = new Set(r.contracts.shipped);
  STUFFED_28FEB = new Set(r.contracts.stuffed);
  PHYS_DELTA = r.physDelta;
  COMTRAS_DELTA = r.comtrasDelta;
  GRADES = [...new Set(lines.map((l) => l.i))].sort();
}

export const allLines = () => lines;
export const linesAt = (wh: SiteCode) => lines.filter((l) => l.wh === wh);
export const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

export let TODAY: Today;
export const TARGET_PCT = 0.1;
export const SITE_CEILING = 6000;
export const SLA_DAYS = 5;

export let SITES: Site[] = [];
export const site = (c: SiteCode) => SITES.find((s) => s.code === c)!;

/* ---------- roles & separation of duties ---------- */

export const ROLES: Role[] = ["Operations Admin", "Warehouse Manager", "Trading", "Finance", "IT Admin"];

/** The approval chain agreed with the business: each gate signs in order. */
export const CHAIN: { role: Role; title: string; signs: string }[] = [
  { role: "Operations Admin", title: "Operations", signs: "Counts complete, variances explained" },
  { role: "Warehouse Manager", title: "Warehouse", signs: "Physical position by warehouse" },
  { role: "Trading", title: "Trading", signs: "Contracts, blocks and basket allocation" },
  { role: "Finance", title: "Finance", signs: "Certifies the stock position" },
];

/** What each role may change. Everyone can view. */
export const PERMISSIONS: { area: string; can: Role[] }[] = [
  { area: "Create and close stock takes", can: ["Operations Admin"] },
  { area: "Import XBS stock", can: ["Operations Admin", "IT Admin"] },
  { area: "Approve or reject count sheets", can: ["Operations Admin", "Warehouse Manager"] },
  { area: "Decide variance causes", can: ["Operations Admin", "Warehouse Manager", "Finance"] },
  { area: "Request mapping changes", can: ["Trading", "Finance", "Operations Admin"] },
  { area: "Approve mapping changes", can: ["Finance"] },
  { area: "Warehouses, locations, grades, settings", can: ["IT Admin", "Operations Admin"] },
  { area: "User roles", can: ["IT Admin"] },
];
export const can = (role: Role, area: string) => PERMISSIONS.find((p) => p.area === area)?.can.includes(role) ?? false;

/* ---------- stock takes & imports ---------- */


export let IMPORTS: XbsImport[] = [];

const WARRANT_RE = /^W\d{6}[A-Z0-9]{3}$/;
const where = (l: XbsLine) => `${site(l.wh).short}${l.z && l.z !== "TEMP-0-0" ? " " + l.z : ""}`;

/** Checks run on an XBS upload before it becomes the expected stock for a count. */
/** Adds a just-finished import to the history; older Imported ones become Superseded. */
export function addImport(x: XbsImport) {
  IMPORTS = [x, ...IMPORTS.map((i) => (i.status === "Imported" ? { ...i, status: "Superseded" as const } : i))];
}

/** Checks run on an XBS upload (default: the loaded snapshot) before it becomes expected stock. */
export function importChecks(src: XbsLine[] = lines, unknownWarehouses: string[] = []): ImportCheck[] {
  const lines = src;
  const W = lines.filter((l) => l.t === "W");
  const B = lines.filter((l) => l.t === "B");
  const badWarrant = W.filter((l) => l.wr && !WARRANT_RE.test(l.wr));
  const noBasket = lines.filter((l) => !l.bc);
  const remnants = W.filter((l) => l.bg === 0);
  const noLoc = lines.filter((l) => site(l.wh).thirdParty === false && (!l.z || l.z === "TEMP-0-0"));
  // A true duplicate is an identical row. XBS also splits some batches into
  // several lines at one location (different quantities) — those are fine.
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(JSON.stringify(l), (seen.get(JSON.stringify(l)) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([k]) => JSON.parse(k) as XbsLine);
  const multi = new Set<string>();
  const byLoc = new Map<string, number>();
  for (const l of lines) {
    const k = `${l.t}|${l.b}|${l.wh}|${l.z}`;
    byLoc.set(k, (byLoc.get(k) ?? 0) + 1);
    if (byLoc.get(k)! > 1) multi.add(k);
  }
  const kgOff = lines.filter((l) => {
    const pack = l.bg ? Math.round((l.kg - l.pk) / l.bg) : 60;
    return l.bg > 0 && pack !== 60 && pack !== 50;
  });
  return [
    {
      id: "files",
      label: "Both XBS reports present",
      result: "pass",
      detail: `Warehouse stock (${W.length} rows) and Blocked for Processing (${B.length} rows).`,
      rows: [],
    },
    {
      id: "wh",
      label: "Every row has a known warehouse",
      result: unknownWarehouses.length ? "fail" : "pass",
      detail: unknownWarehouses.length
        ? `${unknownWarehouses.length} warehouse name(s) in the file aren't set up in NKG_config.`
        : `${new Set(lines.map((l) => l.wh)).size} warehouses found, all set up in NKG_config.`,
      rows: unknownWarehouses.map((w) => ({ ref: w, info: "Add it under Set-up → Warehouses, or check the file" })),
    },
    {
      id: "dupe",
      label: "No duplicate rows",
      result: dupes.length ? "fail" : "pass",
      detail: dupes.length
        ? `${dupes.length} rows appear twice, identical in every field.`
        : `No identical rows. ${multi.size} batches have more than one XBS line at the same location; the counter app shows each as one lot.`,
      rows: dupes.slice(0, 20).map((l) => ({ ref: l.o, info: where(l) })),
    },
    {
      id: "pack",
      label: "Weights fit a 60 kg or 50 kg bag",
      result: kgOff.length ? "warn" : "pass",
      detail: kgOff.length ? `${kgOff.length} rows don't divide into either pack size.` : "Every row is bags × 60 or bags × 50 plus pockets.",
      rows: kgOff.slice(0, 20).map((l) => ({ ref: l.o, info: `${l.bg} bags, ${l.kg} kg` })),
    },
    {
      id: "basket",
      label: "Every outturn maps to a basket",
      result: noBasket.length ? "warn" : "pass",
      detail: `${noBasket.length} rows have no secondary basket. They can't be reconciled against Comtras until mapped.`,
      rows: noBasket.map((l) => ({ ref: l.o, info: `${l.i} · ${where(l)}` })),
    },
    {
      id: "warrant",
      label: "Warrant numbers in the right format",
      result: badWarrant.length ? "warn" : "pass",
      detail: `${badWarrant.length} warrants aren't W + date + 3 characters, so tags can't be matched.`,
      rows: badWarrant.slice(0, 40).map((l) => ({ ref: l.o, info: l.wr! })),
    },
    {
      id: "loc",
      label: "Ibero rows have a stack location",
      result: noLoc.length ? "warn" : "pass",
      detail: noLoc.length ? `${noLoc.length} Ibero rows have no location.` : "Every Ibero row has a location.",
      rows: noLoc.map((l) => ({ ref: l.o, info: where(l) })),
    },
    {
      id: "remnant",
      label: "Pocket-only remainders",
      result: remnants.length ? "warn" : "pass",
      detail: `${remnants.length} lots have no full bags left, only loose kilos.`,
      rows: remnants.map((l) => ({ ref: l.o, info: `${l.kg} kg · ${where(l)}` })),
    },
  ];
}

/* ---------- count day ---------- */

export let COUNTERS: Counter[] = [];

export let HOURLY: { h: string; bags: number }[] = [];

export function coverage() {
  const counted = COUNTED_BAGS;
  return SITES.map((s) => {
    const total = sum(linesAt(s.code), (l) => l.bg);
    return { site: s, total, done: Math.min(total, counted[s.code] ?? 0), lots: linesAt(s.code).length };
  });
}


/* ---------- variances ---------- */


/* ---------- pre-count checks (computed from the snapshot) ---------- */

let CANCELLED = new Set<string>();
let SHIPPED = new Set<string>();
export let STUFFED_28FEB = new Set<string>();

export function checks(): Check[] {
  const W = lines.filter((l) => l.t === "W");
  const tp = W.filter((l) => site(l.wh).thirdParty);
  const mk = (rows: XbsLine[], info: (l: XbsLine) => string, ref: (l: XbsLine) => string = (l) => l.o) =>
    rows.map((l) => ({ ref: ref(l), where: where(l), info: info(l), bags: l.bg }));

  const cancelled = W.filter((l) => l.so && CANCELLED.has(l.so));
  const shipped = W.filter((l) => l.so && SHIPPED.has(l.so));
  const stuffed = W.filter((l) => l.so && STUFFED_28FEB.has(l.so));
  const aged = tp.filter((l) => (l.d ?? 0) > 21).sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
  const byOutturn = new Map<string, XbsLine[]>();
  for (const l of W) byOutturn.set(l.o, [...(byOutturn.get(l.o) ?? []), l]);
  const split = [...byOutturn.values()].filter((xs) => new Set(xs.map((x) => x.wh)).size > 1);
  const over = coverage().filter((c) => c.site.thirdParty && c.total > SITE_CEILING);

  return [
    {
      id: "stuffed", severity: "high", owner: "Logistics",
      title: "Stuffed but still in stock",
      detail: "Contracts show stuffing on 28 Feb, but the lots haven't been posted out of XBS. Counters will find nothing at A-01-1.",
      count: new Set(stuffed.map((l) => l.so)).size, bags: sum(stuffed, (l) => l.bg), unit: "contracts",
      rows: mk(stuffed, (l) => `Contract ${l.so} · stuffed 28 Feb`, (l) => l.o),
    },
    {
      id: "cancelled", severity: "high", owner: "Trading",
      title: "Stock blocked to cancelled contracts",
      detail: "The contract is cancelled in the shipment tracker but the lot is still blocked to it in XBS. Release the block in BRIC and XBS.",
      count: new Set(cancelled.map((l) => l.so)).size, bags: sum(cancelled, (l) => l.bg), unit: "contracts",
      rows: mk(cancelled, (l) => `Contract ${l.so} · cancelled`),
    },
    {
      id: "shipped", severity: "high", owner: "Trading",
      title: "Stock blocked to a shipped contract",
      detail: "Contract 3786965 sailed on 8 Nov 2025 and its documents are dispatched. These lots should no longer be on the books.",
      count: shipped.length, bags: sum(shipped, (l) => l.bg), unit: "lots",
      rows: mk(shipped, (l) => `Contract ${l.so} · ${l.d} days`),
    },
    {
      id: "ceiling", severity: "medium", owner: "Operations",
      title: "Third-party sites over the 6,000-bag ceiling",
      detail: "Above this, one count day isn't enough. Call off stock to Ibero before the count, or plan extra counters.",
      count: over.length, bags: sum(over, (c) => c.total - SITE_CEILING), unit: "sites",
      rows: over.map((c) => ({ ref: c.site.short, where: c.site.name, info: `${c.total.toLocaleString("en-GB")} bags`, bags: c.total - SITE_CEILING })),
    },
    {
      id: "aged", severity: "medium", owner: "Operations",
      title: "Third-party stock over 21 days",
      detail: "Past the call-off rule. Each day adds storage cost.",
      count: aged.length, bags: sum(aged, (l) => l.bg), unit: "lots",
      rows: mk(aged, (l) => `${l.d} days · ${l.i}${l.g ? " · " + l.g : ""}`),
    },
    {
      id: "split", severity: "medium", owner: "Operations",
      title: "Outturns split across sites",
      detail: "The same outturn is expected at more than one warehouse. Counters get a prompt so stray bags aren't missed.",
      count: split.length, bags: sum(split.flat(), (l) => l.bg), unit: "outturns",
      rows: split.map((xs) => ({ ref: xs[0].o, where: xs.map((x) => `${site(x.wh).short} ${x.bg}`).join(", "), info: xs[0].g ?? xs[0].i, bags: sum(xs, (x) => x.bg) })),
    },
  ];
}

/* ---------- mapping & reconciliation ---------- */

/** Starting rule for secondary → primary basket. The mapping table below is what's maintained. */
function guessPrimary(name = ""): PrimaryBasket {
  if (/Top|Plus|Better|Certified/i.test(name)) return "Plus";
  if (/Grinder|Minus|MH|ML|UG|NATURAL|below|Light|H CLASS/i.test(name)) return "Grinder";
  return "FAQ";
}

export function basketMap(): BasketMap[] {
  const m = new Map<string, BasketMap>();
  for (const l of lines) {
    if (!l.bc) continue;
    const b = m.get(l.bc) ?? { code: l.bc, name: l.bn ?? "", primary: guessPrimary(l.bn), bags: 0 };
    b.bags += l.bg;
    m.set(l.bc, b);
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function outturnMap() {
  const m = new Map<string, { outturn: string; grade: string; basket?: string; basketName?: string; sites: Set<string>; bags: number }>();
  for (const l of lines) {
    const r = m.get(l.o) ?? { outturn: l.o, grade: l.i, basket: l.bc, basketName: l.bn, sites: new Set<string>(), bags: 0 };
    r.sites.add(site(l.wh).short);
    r.bags += l.bg;
    m.set(l.o, r);
  }
  return [...m.values()];
}


/** Physical differences by outturn (counted − XBS, bags): samples until count lines are connected. */
let PHYS_DELTA: Record<string, number> = {};
/** Comtras differences by secondary basket (Comtras − XBS, bags): samples until the Comtras extract is connected. */
let COMTRAS_DELTA: Record<string, number> = {};
/** Comtras minus XBS per secondary basket; empty until a Comtras extract is loaded. */
export const comtrasDelta = () => COMTRAS_DELTA;

export interface ReconRow {
  key: string;
  label: string;
  xbs: number;
  physical: number;
  comtras: number;
}

export function reconciliation(map = basketMap()): { primary: ReconRow[]; secondary: (ReconRow & { primary: PrimaryBasket })[] } {
  const sec = new Map<string, ReconRow & { primary: PrimaryBasket }>();
  for (const l of lines) {
    const code = l.bc ?? "—";
    const b = map.find((x) => x.code === code);
    const r = sec.get(code) ?? { key: code, label: b ? `${code} ${b.name}` : "No basket", primary: b?.primary ?? "FAQ", xbs: 0, physical: 0, comtras: 0 };
    r.xbs += l.bg;
    const gone = l.so && STUFFED_28FEB.has(l.so);
    r.physical += gone ? 0 : l.bg;
    sec.set(code, r);
  }
  for (const [o, d] of Object.entries(PHYS_DELTA)) {
    const l = lines.find((x) => x.o === o);
    const r = l && sec.get(l.bc ?? "—");
    if (r) r.physical += d;
  }
  for (const r of sec.values()) r.comtras = r.xbs + (COMTRAS_DELTA[r.key] ?? 0);
  const secondary = [...sec.values()].sort((a, b) => a.key.localeCompare(b.key));
  const primary = (["Plus", "FAQ", "Grinder"] as PrimaryBasket[]).map((p) => {
    const xs = secondary.filter((s) => s.primary === p);
    return { key: p, label: p, xbs: sum(xs, (x) => x.xbs), physical: sum(xs, (x) => x.physical), comtras: sum(xs, (x) => x.comtras) };
  });
  return { primary, secondary };
}

/** Outturn-level lines behind a secondary basket, for drill-down. */
export function reconLines(basket: string) {
  const ls = lines.filter((l) => (l.bc ?? "—") === basket && l.t === "W");
  return ls.map((l) => {
    const gone = l.so && STUFFED_28FEB.has(l.so);
    const d = gone ? -l.bg : PHYS_DELTA[l.o] ?? 0;
    return { line: l, xbs: l.bg, physical: l.bg + d, note: gone ? `Stuffed 28 Feb on ${l.so}, not posted out` : d ? "See variance" : "" };
  });
}

/** Rows for the sign-off pack, in the layout of the NKG stock sign-off template. */
export function warehouseSummary() {
  return SITES.map((s) => {
    const ls = linesAt(s.code);
    let physUnits = 0;
    let physKg = 0;
    for (const l of ls) {
      const gone = l.so && STUFFED_28FEB.has(l.so);
      const d = gone ? -l.u : l.t === "W" ? PHYS_DELTA[l.o] ?? 0 : 0;
      physUnits += l.u + d;
      physKg += gone ? 0 : l.kg + d * 60;
    }
    const sysUnits = sum(ls, (l) => l.u);
    const sysKg = sum(ls, (l) => l.kg);
    return { site: s, physUnits, sysUnits, phys60: physKg / 60, sys60: sysKg / 60 };
  });
}

/* ---------- exceptions ---------- */

export const ESCALATION = ["Owner", "Head of department", "Country Finance Manager"];

/* ---------- direct purchases ---------- */

export let DIRECT_PURCHASES: DirectPurchase[] = [];

/* ---------- problem reports from counters ---------- */


/* ---------- admin: config, audit, users ---------- */


export let USERS: UserRow[] = [];

export let GRADES: string[] = [];
export let PACK_TYPES: { id: string; label: string; kg: number; grades: string }[] = [];
export let STOCK_TAKE_GROUPS: { name: string; site: string; locations: string; counters: number }[] = [];

