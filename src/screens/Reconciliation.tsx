import { useState } from "react";
import { ChevronRight, Download } from "lucide-react";
import { TARGET_PCT, reconLines, reconciliation, site, sum } from "../data/repository";
import { useStore } from "../data/store";
import type { PrimaryBasket } from "../data/types";
import { Chip, Code, Diff, PageHead, n, signed } from "../ui/kit";

export default function Reconciliation() {
  const store = useStore();
  const { primary, secondary } = reconciliation(store.baskets);
  const [pb, setPb] = useState<PrimaryBasket | null>(null);
  const [sb, setSb] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const xbs = sum(primary, (r) => r.xbs);
  const phys = sum(primary, (r) => r.physical);
  const com = sum(primary, (r) => r.comtras);
  const net = ((phys - xbs) / xbs) * 100;
  const gross = sum(secondary, (r) => Math.abs(r.physical - r.xbs));

  const rows = pb ? secondary.filter((s) => s.primary === pb) : primary;
  const shown = onlyDiff ? rows.filter((r) => r.physical !== r.xbs || r.comtras !== r.xbs) : rows;
  const sbRow = secondary.find((s) => s.key === sb);

  return (
    <div className="page">
      <PageHead
        title="Three-way reconciliation"
        sub="Physical count vs XBS vs Comtras, in bags, matched at outturn and rolled up to secondary and primary basket. Comtras is net of 537 sales relief."
        actions={
          <button className="btn">
            <Download size={18} aria-hidden /> Export to Excel
          </button>
        }
      />

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Net variance, physical vs XBS</div>
          <div className={"stat-value " + (Math.abs(net) <= TARGET_PCT ? "t-ok" : "t-crit")}>{signed(net, 2)}%</div>
          <div className="stat-note">Target within ±{TARGET_PCT}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Net bags</div>
          <div className="stat-value">{signed(phys - xbs)}</div>
          <div className="stat-note">Gross {n(gross)} bags</div>
        </div>
        <div className="stat">
          <div className="stat-label">Comtras vs XBS</div>
          <div className="stat-value">{signed(com - xbs)}</div>
          <div className="stat-note">bags</div>
        </div>
        <div className="stat">
          <div className="stat-label">Value at risk</div>
          <div className="stat-value">${n((gross * 60 * 7383) / 1000 / 1000, 0)}k</div>
          <div className="stat-note">at $7,383/t average</div>
        </div>
      </div>

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
                <th className="num">Physical</th>
                <th className="num">XBS</th>
                <th className="num">Comtras</th>
                <th className="num">Physical − XBS</th>
                <th className="num">Comtras − XBS</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} tabIndex={0} onClick={() => (pb ? setSb(r.key) : setPb(r.key as PrimaryBasket))} onKeyDown={(e) => e.key === "Enter" && (pb ? setSb(r.key) : setPb(r.key as PrimaryBasket))}>
                  <td>{r.key === "—" ? <Chip tone="crit">No basket</Chip> : r.label}</td>
                  <td className="num">{n(r.physical)}</td>
                  <td className="num">{n(r.xbs)}</td>
                  <td className="num">{n(r.comtras)}</td>
                  <td className="num">
                    <Diff value={r.physical - r.xbs} />
                  </td>
                  <td className="num">
                    <Diff value={r.comtras - r.xbs} />
                  </td>
                  <td>
                    <ChevronRight size={16} aria-hidden />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Total{pb ? ` ${pb}` : ""}</td>
                <td className="num">{n(sum(rows, (r) => r.physical))}</td>
                <td className="num">{n(sum(rows, (r) => r.xbs))}</td>
                <td className="num">{n(sum(rows, (r) => r.comtras))}</td>
                <td className="num">
                  <Diff value={sum(rows, (r) => r.physical - r.xbs)} />
                </td>
                <td className="num">
                  <Diff value={sum(rows, (r) => r.comtras - r.xbs)} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Lines basket={sb} onlyDiff={onlyDiff} />
      )}
      <p className="muted small">Physical and Comtras figures are samples until count sheets and the Comtras extract are connected.</p>
    </div>
  );
}

function Lines({ basket, onlyDiff }: { basket: string; onlyDiff: boolean }) {
  const ls = reconLines(basket).filter((r) => !onlyDiff || r.physical !== r.xbs);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Outturn</th>
            <th>Grade</th>
            <th>Where</th>
            <th className="num">Physical</th>
            <th className="num">XBS</th>
            <th className="num">Difference</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {ls.slice(0, 80).map(({ line: l, xbs, physical, note }, i) => (
            <tr key={i}>
              <td>
                <Code>{l.o}</Code>
              </td>
              <td>{l.i}</td>
              <td className="muted">
                {site(l.wh).short} {l.z !== "TEMP-0-0" ? l.z : ""}
              </td>
              <td className="num">{n(physical)}</td>
              <td className="num">{n(xbs)}</td>
              <td className="num">
                <Diff value={physical - xbs} />
              </td>
              <td className="muted small">{note}</td>
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
      {ls.length > 80 && <p className="muted small pad">Showing 80 of {ls.length}. Tick "Only rows with a difference" to narrow.</p>}
    </div>
  );
}
