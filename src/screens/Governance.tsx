import { useStore } from "../data/store";
import type { KpiStatus } from "../data/kpi";
import { Chip, PageHead, Stat, type Tone } from "../ui/kit";

const TONE: Record<KpiStatus, Tone> = {
  "On target": "ok",
  "Off target": "crit",
  Running: "info",
  "For information": "neutral",
  "Not measurable": "neutral",
};
const month = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "");

/**
 * Governance KPIs: whether each stock take met NKG's SOP and business-case targets. Worked out
 * from the Hub's own data while the stock take is open; frozen when Finance signs (stk_kpisnapshot).
 */
export default function Governance() {
  const store = useStore();
  const kpis = store.kpis ?? [];
  const count = (s: KpiStatus) => kpis.filter((k) => k.status === s).length;

  // Trend: one column per stock take (newest first, up to six), the active one from the live figures.
  const takes = [...new Map(store.kpiHistory.map((h) => [h.stockTake, h.countDate])).entries()].filter(([st]) => st !== store.activeStockTake).slice(0, 5);
  const cell = (st: string, codeOf: string) => store.kpiHistory.find((h) => h.stockTake === st && h.code === codeOf);

  return (
    <div className="page">
      <PageHead
        title="Governance"
        sub="Whether the stock take met its targets: NKG's SOP KPI register (stock variance, reconciliation by the 8th, aged items) and the stock take SOP and business case (coverage, blind counting, closure, days to sign-off). Worked out from this app's own records; frozen when Finance signs, so a month's result can't change afterwards."
      />

      {!kpis.length ? (
        <section className="panel">
          <p className="muted">No stock take yet. The KPIs work out once a stock take has started.</p>
        </section>
      ) : (
        <>
          <div className="stats">
            <Stat label="On target" value={count("On target")} tone="ok" />
            <Stat label="Off target" value={count("Off target")} tone={count("Off target") ? "crit" : undefined} />
            <Stat label="Still running" value={count("Running")} note="Not late yet; final at sign-off" />
            <Stat
              label={store.kpisFrozen ? "Frozen" : "Status"}
              value={store.kpisFrozen ? "Final" : "Live"}
              note={store.kpisFrozen ? "Finance signed; these figures no longer change" : "Recalculated each time the Hub opens"}
            />
          </div>

          <section className="panel">
            <div className="row-between">
              <h2 className="h3">Scorecard · {store.activeStockTake}</h2>
              <span className="muted small">Targets can be changed in Settings</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th className="num">Value</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.map((k) => (
                    <tr key={k.code}>
                      <td>
                        <strong>{k.name}</strong>
                        <div className="muted small">{k.detail}</div>
                      </td>
                      <td className="num">{k.display}</td>
                      <td>{k.target}</td>
                      <td>
                        <Chip tone={TONE[k.status]}>{k.status}</Chip>
                      </td>
                      <td>{k.owner}</td>
                      <td className="muted small">{k.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="row-between">
              <h2 className="h3">Trend by month</h2>
              <span className="muted small">Earlier months as frozen at Finance sign-off</span>
            </div>
            {!takes.length && <p className="muted small">The first month is this one; earlier stock takes appear here once they have KPIs saved.</p>}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>{month(store.kpiCountDate ?? "") || "This month"}</th>
                    {takes.map(([st, d]) => (
                      <th key={st}>{month(d) || st}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kpis.map((k) => (
                    <tr key={k.code}>
                      <td>{k.name}</td>
                      <td>
                        <Chip tone={TONE[k.status]}>{k.display}</Chip>
                      </td>
                      {takes.map(([st]) => {
                        const h = cell(st, k.code);
                        return <td key={st}>{h ? <Chip tone={TONE[h.status]}>{h.display}</Chip> : <span className="muted">-</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
