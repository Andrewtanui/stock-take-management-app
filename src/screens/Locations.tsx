import { Fragment, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import type { SiteCode, XbsLine } from "../data/types";
import { hasLayout, layoutOf, parseZone, zoneFits, zoneSite, type Layout } from "../shared/sections";
import { Chip, PageHead, Stat } from "../ui/kit";

// Reports › Locations: Ibero's locations (XBS's Zone report, the location master `stk_zone`) against the
// stock XBS has on them in the current import. The Zone report is exactly each building's layout in
// src/shared/sections.ts (scripts/xbs/import-zones.mjs checks it), so the locations come from the layout.

const bags60 = (kg: number) => kg / 60;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

/** Every location of a layout: rows and the stacks between neighbouring rows, bays and bay pairs, zones. */
const locations = (l: Layout) => (2 * l.rows.length - 1) * (2 * (l.bayTo - l.bayFrom + 1) - 1) * l.zones;
/** Map rows in floor order: A, A/B, B, B/C … */
const mapRows = (l: Layout) => [...l.rows].flatMap((r, i) => (i < l.rows.length - 1 ? [r, `${r}/${l.rows[i + 1]}`] : [r]));
const rowOf = (z: string) => {
  const p = parseZone(z)!;
  return p.between ? `${p.row}/${p.rowTo}` : p.row;
};

function Building({ code, name, lines }: { code: SiteCode; name: string; lines: XbsLine[] }) {
  const l = layoutOf(code);
  const placed = lines.filter((x) => x.z && zoneFits(x.z, code));
  const zones = new Set(placed.map((x) => x.z!));
  const total = locations(l);
  const bags = bags60(placed.reduce((s, x) => s + x.kg, 0));
  const noLoc = lines.filter((x) => !x.z || !zoneFits(x.z, code));
  // Bags per map row and bay; a stack counts in its first bay, as sections do.
  const cell = new Map<string, { bags: number; stacks: Set<string> }>();
  for (const x of placed) {
    const k = `${rowOf(x.z!)}|${parseZone(x.z!)!.bay}`;
    const c = cell.get(k) ?? { bags: 0, stacks: new Set<string>() };
    c.bags += bags60(x.kg);
    c.stacks.add(x.z!);
    cell.set(k, c);
  }
  const max = Math.max(1, ...[...cell.values()].map((c) => c.bags));
  const bays = Array.from({ length: l.bayTo - l.bayFrom + 1 }, (_, i) => l.bayFrom + i);
  const rows = mapRows(l);
  const perRow = rows.map((r) => {
    const cs = bays.map((b) => cell.get(`${r}|${b}`)).filter(Boolean) as { bags: number; stacks: Set<string> }[];
    return { r, stacks: cs.reduce((s, c) => s + c.stacks.size, 0), bags: cs.reduce((s, c) => s + c.bags, 0), bays: cs.length };
  });

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">{name}</h2>
        <Chip tone="info">
          Rows {l.rows[0]}–{l.rows.slice(-1)} · bays {l.bayFrom}–{l.bayTo} · zones 1–{l.zones}
        </Chip>
      </div>
      <div className="stats">
        <Stat label="Locations" value={n0(total)} note="Every location in XBS's Zone report" />
        <Stat label="With stock" value={n0(zones.size)} note={`${pct(zones.size, total)} of locations`} />
        <Stat label="Bags on locations" value={n0(bags)} note="60 kg bags, current XBS import" />
        <Stat label="No location" value={n0(bags60(noLoc.reduce((s, x) => s + x.kg, 0)))} note={`${noLoc.length} XBS lines (TEMP or no location code)`} tone={noLoc.length ? "warn" : undefined} />
      </div>

      {zones.size === 0 ? (
        <p className="muted">No stock on {name} in the current XBS import. Its locations are ready for the first delivery.</p>
      ) : (
        <>
          <div className="zone-map-wrap">
            <div className="zone-map" role="grid" aria-label={`${name}: bags per bay`} style={{ gridTemplateColumns: `44px repeat(${bays.length}, minmax(26px, 1fr))` }}>
              <div />
              {bays.map((b) => (
                <div key={b} className="zone-bay">
                  {b}
                </div>
              ))}
              {rows.map((r) => (
                <Fragment key={r}>
                  <div className={"zone-row" + (r.includes("/") ? " zone-row-between" : "")}>{r}</div>
                  {bays.map((b) => {
                    const c = cell.get(`${r}|${b}`);
                    const share = c ? Math.max(12, Math.round((c.bags / max) * 100)) : 0;
                    return (
                      <div
                        key={b}
                        role="gridcell"
                        className={"zone-cell" + (r.includes("/") ? " zone-cell-between" : "")}
                        style={c ? { background: `color-mix(in srgb, var(--brand-neumann-green) ${share}%, var(--surface))` } : undefined}
                        title={c ? `${r} bay ${b}: ${n0(c.bags)} bags on ${c.stacks.size} stack${c.stacks.size === 1 ? "" : "s"}` : `${r} bay ${b}: no stock`}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
          <p className="muted small">Darker = more bags. A stack spanning two bays counts in its first bay. Rows like C/D are the stacks between two rows.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th className="num">Stacks with stock</th>
                  <th className="num">Bays used</th>
                  <th className="num">Bags (60 kg)</th>
                </tr>
              </thead>
              <tbody>
                {perRow
                  .filter((x) => x.stacks)
                  .map((x) => (
                    <tr key={x.r}>
                      <td>{x.r.includes("/") ? `Between ${x.r.replace("/", " and ")}` : `Row ${x.r}`}</td>
                      <td className="num">{x.stacks}</td>
                      <td className="num">
                        {x.bays} of {bays.length}
                      </td>
                      <td className="num">{n0(x.bags)}</td>
                    </tr>
                  ))}
                <tr className="total">
                  <td>Total</td>
                  <td className="num">{zones.size}</td>
                  <td className="num" />
                  <td className="num">{n0(bags)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Looks up a location: is it real, which building, what XBS has there. */
function Lookup({ lines, siteName }: { lines: XbsLine[]; siteName: (c: SiteCode) => string }) {
  const [q, setQ] = useState("");
  const z = q.trim().toUpperCase().replace(/\s+/g, "");
  const at = z ? (zoneSite(z) as SiteCode | undefined) : undefined;
  const p = at ? parseZone(z) : null;
  const here = at ? lines.filter((x) => x.wh === at && x.z === z) : [];
  return (
    <section className="panel">
      <h2 className="h3">Look up a location</h2>
      <label className="field">
        <span className="field-label">Location code</span>
        <input className="input code zone-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. D-05-1, A/B-14-2 or D-17-3" spellCheck={false} />
      </label>
      {z &&
        (p && at ? (
          <div className="zone-found">
            <MapPin size={18} aria-hidden />
            <div>
              <strong>
                {siteName(at)} · {p.between ? `between rows ${p.row} and ${p.rowTo}` : `row ${p.row}`} · {p.bayTo !== p.bay ? `bays ${p.bay}–${p.bayTo}` : `bay ${p.bay}`} · zone {p.zone}
              </strong>
              <div className="muted small">
                {here.length
                  ? `${here.length} XBS line${here.length === 1 ? "" : "s"}, ${n0(bags60(here.reduce((s, x) => s + x.kg, 0)))} bags: ${[...new Set(here.map((x) => x.o))].slice(0, 6).join(", ")}`
                  : "A real location; no stock on it in the current XBS import."}
              </div>
            </div>
          </div>
        ) : (
          <p className="callout callout-warn small">Not a location in XBS's floor plan. Locations look like D-05-1 (row D, bay 5, zone 1) or A/B-14-2 (between rows A and B, bay 14, zone 2).</p>
        ))}
    </section>
  );
}

export default function Locations() {
  const store = useStore();
  const lines = allLines();
  const buildings = store.sites.filter((s) => hasLayout(s.code));
  const byBuilding = useMemo(() => new Map(buildings.map((s) => [s.code, lines.filter((x) => x.wh === s.code)])), [lines, buildings]);
  const siteName = (c: SiteCode) => store.sites.find((s) => s.code === c)?.name ?? c;
  const thirdParties = store.sites.filter((s) => s.thirdParty);
  return (
    <div className="page">
      <PageHead
        title="Locations"
        sub="Ibero's stack locations from XBS's Zone report, and the stock XBS has on them in the current import. Third-party warehouses have no locations in XBS (TEMP-0-0); counters record their stacks on the day."
      />
      <Lookup lines={lines} siteName={siteName} />
      {buildings.map((s) => (
        <Building key={s.code} code={s.code} name={s.name} lines={byBuilding.get(s.code) ?? []} />
      ))}
      {thirdParties.length > 0 && (
        <p className="muted small">Third parties: {thirdParties.map((s) => s.short).join(", ")}. Counted by site.</p>
      )}
    </div>
  );
}
