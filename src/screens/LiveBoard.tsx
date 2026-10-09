import { COUNTERS, HOURLY, SITE_CEILING, TODAY, coverage, site, sum } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, PageHead, Progress, Stat, n } from "../ui/kit";

const DAY = { start: 7, end: 17 };
const TARGET = [6000, 7000];

export default function LiveBoard() {
  const store = useStore();
  const cov = coverage();
  const total = sum(cov, (c) => c.total);
  const done = sum(cov, (c) => c.done);
  const recounts = store.variances.filter((v) => v.state === "recount").length;

  return (
    <div className="page">
      <PageHead
        title="Count day live"
        sub={`${TODAY.countDay}, final position at 17:00. On count day this refreshes as counters save, so the lead can move people to where they're needed.`}
      />

      <div className="stats">
        <Stat label="Bags confirmed" value={`${Math.round((done / total) * 100)}%`} note={`${n(done)} of ${n(total)}`} />
        <Stat label="Counters" value={COUNTERS.length} note={`${new Set(COUNTERS.map((c) => c.site)).size} warehouses`} />
        <Stat label="Recounts out" value={recounts} tone={recounts ? "warn" : "ok"} />
        <Stat label="Counted in one day" value={`${n(sum(HOURLY, (h) => h.bags))} bags`} note="Target: whole universe in one day" />
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2 className="h3">Bags counted per hour</h2>
          <HourChart />
        </section>
        <section className="panel">
          <h2 className="h3">Coverage by warehouse</h2>
          <ul className="cov-list">
            {cov.map(({ site: s, total: t, done: d }) => (
              <li key={s.code}>
                <div className="row-between">
                  <span>{s.short}</span>
                  <span className="muted small">
                    <span className="num">{n(d)}</span> / {n(t)}
                  </span>
                </div>
                <Progress value={d} max={t} tone={d >= t ? "ok" : "info"} marker={s.thirdParty && t > SITE_CEILING ? SITE_CEILING : undefined} />
                {s.thirdParty && t > SITE_CEILING && (
                  <span className="small t-crit">
                    {n(t)} bags at one site. The line marks the {n(SITE_CEILING)}-bag count-day ceiling.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">Counter pace</h2>
          <span className="muted small">
            Benchmark {n(TARGET[0])}–{n(TARGET[1])} bags per counter per day
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Counter</th>
                <th>Where</th>
                <th className="num">Bags</th>
                <th className="num">Per hour</th>
                <th>Against benchmark</th>
                <th className="num">Recounts</th>
              </tr>
            </thead>
            <tbody>
              {COUNTERS.map((c) => {
                const rate = c.bagsSoFar / (DAY.end - c.startedAt);
                const siteTotal = cov.find((x) => x.site.code === c.site)!;
                const finished = siteTotal.site.thirdParty && siteTotal.done >= siteTotal.total;
                const tone = c.bagsSoFar >= TARGET[0] ? "ok" : c.bagsSoFar >= TARGET[0] * 0.6 ? "warn" : "crit";
                return (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="muted">
                      {site(c.site).short} · {c.area}
                    </td>
                    <td className="num">{n(c.bagsSoFar)}</td>
                    <td className="num">{n(rate)}</td>
                    <td>
                      {finished ? (
                        <Chip tone="ok">Site finished</Chip>
                      ) : (
                        <div className="pace">
                          <div className="pace-track">
                            <div className="pace-band" style={{ left: `${(TARGET[0] / 8000) * 100}%`, width: `${((TARGET[1] - TARGET[0]) / 8000) * 100}%` }} />
                            <div className={`pace-dot fill-${tone}`} style={{ left: `${Math.min(100, (c.bagsSoFar / 8000) * 100)}%` }} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="num">{c.recounts ? <Chip tone="info">{c.recounts}</Chip> : "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function HourChart() {
  const W = 560, H = 220, padL = 40, padB = 26, padT = 18;
  const max = 10000;
  const bw = (W - padL - 8) / HOURLY.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bags counted per hour on count day">
      {[0, 5000, 10000].map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} className="grid" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">
            {t ? `${t / 1000}k` : "0"}
          </text>
        </g>
      ))}
      {HOURLY.map((h, i) => {
        const x = padL + i * bw + 5;
        const w = bw - 10;
        return (
          <g key={h.h}>
            <rect x={x} y={y(h.bags)} width={w} height={y(0) - y(h.bags)} rx="3" className="bar" />
            <text x={x + w / 2} y={y(h.bags) - 5} textAnchor="middle" className="bar-label">
              {(h.bags / 1000).toFixed(1)}k
            </text>
            <text x={x + w / 2} y={H - 8} textAnchor="middle" className="axis">
              {h.h}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
