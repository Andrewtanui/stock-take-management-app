import { useState } from "react";
import { ChevronRight, Download, Info } from "lucide-react";
import { exportReport } from "../data/excel";
import { basketLines, threeWay, type ReconInput, type ReconRow } from "../data/recon";
import { TARGET_PCT } from "../data/repository";
import { useStore } from "../data/store";
import type { PrimaryBasket } from "../data/types";
import { Chip, Code, Diff, PageHead, n, signed } from "../ui/kit";

/** Average coffee value for value-at-risk (Kenya Variables sheet, setting AvgValueUsdPerTonne). */
const USD_PER_TONNE = 7383;
const pct = (x: number) => `${n(x * 100, 0)}%`;

export default function Reconciliation() {
  const store = useStore();
  const input: ReconInput = { counts: store.counts, stacks: store.stacks, baskets: store.baskets };
  const { primary, secondary, hasComtras, totals } = threeWay(input);
  const [pb, setPb] = useState<PrimaryBasket | null>(null);
  const [sb, setSb] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const compared = totals.xbs > 0 || totals.physical > 0;
  const netEq = totals.physical - totals.xbs;
  const net = totals.xbs ? (netEq / totals.xbs) * 100 : 0;
  const differs = (r: ReconRow) => Math.abs(r.physical - r.xbs) >= 0.05 || (r.comtras !== undefined && Math.abs(r.comtras - r.xbsWhole) >= 0.05);

  const rows = pb ? secondary.filter((s) => s.primary === pb) : primary;
  const shown = onlyDiff ? rows.filter(differs) : rows;
  const sbRow = secondary.find((s) => s.key === sb);
  const stockTake = store.stockTakes[0]?.title ?? "Stock take";

  const download = () =>
    exportReport("Three-way reconciliation", stockTake, {
      note: "60 kg equivalents. Physical is compared with the XBS stock that has been counted; coverage = share of XBS compared." + (hasComtras ? "" : " No Comtras extract loaded."),
      tables: [
        { title: "By primary basket", rows: primary.map(toRow), columns: COLS(hasComtras) },
        { title: "By secondary basket", rows: secondary.map(toRow), columns: COLS(hasComtras) },
      ],
    }).then(
      () => store.flash("Reconciliation downloaded as Excel."),
      (e) => store.flash(`Couldn't create the Excel file: ${e instanceof Error ? e.message : String(e)}`),
    );

  return (
    <div className="page">
      <PageHead
        title="Three-way reconciliation"
        sub="Physical count vs XBS vs Comtras in 60 kg equivalents, matched at outturn and rolled up to secondary and primary basket. Only stock that has been counted is compared; the rest shows as not counted."
        actions={
          <button className="btn" onClick={download}>
            <Download size={18} aria-hidden /> Export to Excel
          </button>
        }
      />

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Net variance, physical vs XBS</div>
          <div className={"stat-value " + (!compared ? "" : Math.abs(net) <= TARGET_PCT ? "t-ok" : "t-crit")}>{compared ? `${signed(net, 2)}%` : "—"}</div>
          <div className="stat-note">{compared ? `Target within ±${TARGET_PCT}% · on ${pct(totals.cover)} of XBS` : "Nothing counted and submitted yet"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Net, 60 kg equivalents</div>
          <div className="stat-value">{compared ? signed(netEq, 1) : "—"}</div>
          <div className="stat-note">
            Gross {n(totals.gross, 1)} · counted {n(totals.physical, 1)} of {n(totals.xbsWhole, 1)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Comtras vs XBS</div>
          <div className="stat-value">{hasComtras ? signed((totals.comtras ?? 0) - totals.xbsWhole, 1) : "No data"}</div>
          <div className="stat-note">{hasComtras ? "60 kg equivalents" : "No Comtras extract loaded yet"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Value at risk</div>
          <div className="stat-value">${n((totals.gross * 60 * USD_PER_TONNE) / 1000 / 1000, 0)}k</div>
          <div className="stat-note">Gross difference at ${n(USD_PER_TONNE)}/t average</div>
        </div>
      </div>

      {!hasComtras && (
        <p className="callout callout-warn">
          <Info size={16} aria-hidden /> Comtras columns stay empty until a Comtras extract is loaded. They are never filled with a copy of XBS.
        </p>
      )}

      <nav className="crumbs" aria-label="Drill-down">
        <button className="link" onClick={() => (setPb(null), setSb(null))}>
          All baskets
        </button>
        {pb && (
          <>
            <ChevronRight size={16} aria-hidden />
            <button className="link" onClick={() => setSb(null)}>
              {pb}
            </button>
          </>
        )}
        {sbRow && (
          <>
            <ChevronRight size={16} aria-hidden />
            <span>{sbRow.label}</span>
          </>
        )}
        <label className="check-line push">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only rows with a difference
        </label>
      </nav>

      {!sb ? (
        <div className="table-wrap">
          <table className="table table-select">
            <thead>
              <tr>
                <th>{pb ? "Secondary basket" : "Primary basket"}</th>
                <th className="num">XBS, whole</th>
                <th className="num">XBS, counted part</th>
                <th className="num">Physical</th>
                <th className="num">Physical − XBS</th>
                <th className="num">Coverage</th>
                <th className="num">Comtras</th>
                <th className="num">Comtras − XBS</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.key}
                  tabIndex={0}
                  onClick={() => (pb ? setSb(r.key) : setPb(r.key as PrimaryBasket))}
                  onKeyDown={(e) => e.key === "Enter" && (pb ? setSb(r.key) : setPb(r.key as PrimaryBasket))}
                >
                  <td>{r.key === "—" ? <Chip tone="crit">No basket</Chip> : r.label}</td>
                  <Cells r={r} />
                  <td>
                    <ChevronRight size={16} aria-hidden />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Total{pb ? ` ${pb}` : ""}</td>
                <Cells r={totalRow(rows, hasComtras)} />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Lines input={input} basket={sb} onlyDiff={onlyDiff} />
      )}
      <p className="muted small">
        Physical comes from submitted count lines (a recount replaces the first count). XBS is the snapshot the stock take was set up from, Warehouse plus Blocked for
        Processing. Baskets follow the current basket mapping.
      </p>
    </div>
  );
}

function Cells({ r }: { r: ReconRow }) {
  const counted = r.xbs > 0 || r.physical > 0;
  return (
    <>
      <td className="num">{n(r.xbsWhole, 1)}</td>
      <td className="num">{counted ? n(r.xbs, 1) : <span className="muted">not counted</span>}</td>
      <td className="num">{counted ? n(r.physical, 1) : "—"}</td>
      <td className="num">{counted ? <Diff value={r.physical - r.xbs} d={1} /> : "—"}</td>
      <td className="num">{pct(r.cover)}</td>
      <td className="num">{r.comtras === undefined ? "—" : n(r.comtras, 1)}</td>
      <td className="num">{r.comtras === undefined ? "—" : <Diff value={r.comtras - r.xbsWhole} d={1} />}</td>
    </>
  );
}

function Lines({ input, basket, onlyDiff }: { input: ReconInput; basket: string; onlyDiff: boolean }) {
  const all = basketLines(input, basket);
  const ls = onlyDiff ? all.filter((r) => Math.abs(r.physical - r.xbs) >= 0.05) : all;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Outturn</th>
            <th>Grade</th>
            <th>Where</th>
            <th className="num">Physical</th>
            <th className="num">XBS, counted part</th>
            <th className="num">Difference</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {ls.slice(0, 120).map((r, i) => (
            <tr key={i}>
              <td>
                <Code>{r.outturn}</Code>
              </td>
              <td>{r.grade}</td>
              <td className="muted">{r.where}</td>
              <td className="num">{r.counted ? n(r.physical, 1) : "—"}</td>
              <td className="num">{r.compared ? n(r.xbs, 1) : "—"}</td>
              <td className="num">{r.counted || r.compared ? <Diff value={r.physical - r.xbs} d={1} /> : "—"}</td>
              <td className="muted small">{r.note}</td>
            </tr>
          ))}
          {!ls.length && (
            <tr>
              <td colSpan={7} className="muted">
                No differences in this basket.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {ls.length > 120 && <p className="muted small pad">Showing 120 of {ls.length}, biggest differences first. Tick "Only rows with a difference" to narrow.</p>}
    </div>
  );
}

function totalRow(rows: ReconRow[], hasComtras: boolean): ReconRow {
  const xbsWhole = sum(rows, (r) => r.xbsWhole);
  const xbs = sum(rows, (r) => r.xbs);
  return {
    key: "total",
    label: "Total",
    xbsWhole,
    xbs,
    physical: sum(rows, (r) => r.physical),
    comtras: hasComtras ? sum(rows, (r) => r.comtras ?? 0) : undefined,
    cover: xbsWhole ? xbs / xbsWhole : 0,
  };
}

const COLS = (hasComtras: boolean) => [
  { key: "basket", label: "Basket" },
  { key: "xbsWhole", label: "XBS, whole (eq60)", kind: "num1" as const },
  { key: "xbs", label: "XBS, counted part (eq60)", kind: "num1" as const },
  { key: "physical", label: "Physical (eq60)", kind: "num1" as const },
  { key: "diff", label: "Physical − XBS (eq60)", kind: "num1" as const },
  { key: "cover", label: "Coverage", kind: "pct" as const },
  ...(hasComtras
    ? [
        { key: "comtras", label: "Comtras (eq60)", kind: "num1" as const },
        { key: "cdiff", label: "Comtras − XBS (eq60)", kind: "num1" as const },
      ]
    : []),
];
const toRow = (r: ReconRow) => ({
  basket: r.key === "—" ? "No basket" : r.label,
  xbsWhole: r.xbsWhole,
  xbs: r.xbs,
  physical: r.physical,
  diff: r.physical - r.xbs,
  cover: r.cover,
  comtras: r.comtras,
  cdiff: r.comtras === undefined ? undefined : r.comtras - r.xbsWhole,
});
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
