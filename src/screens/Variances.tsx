import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { allLines, can, site } from "../data/repository";
import { useStore } from "../data/store";
import type { RootCause, Variance } from "../data/types";
import { Chip, Code, Diff, PageHead, ReadOnly, Tabs, n, signed, type Tone } from "../ui/kit";
import { PhotoButton } from "../ui/PhotoButton";

const CAUSES: RootCause[] = [
  "Split lot",
  "Unposted receipt",
  "Unposted gate-out",
  "Duplicate entry",
  "Mapping error",
  "Pocket / unit difference",
  "Wrong basket on sale",
  "In transit",
  "Cancelled contract",
  "Partial delivery: rest still at third party",
  "Weight loss: claim from warehouse",
  "Posting timing / late posting",
  "Not yet known",
];

const STATE: Record<Variance["state"], { label: string; tone: Tone }> = {
  open: { label: "Needs a decision", tone: "warn" },
  recount: { label: "Recount sent", tone: "info" },
  exception: { label: "Exception raised", tone: "neutral" },
  accepted: { label: "Accepted", tone: "ok" },
};

export default function Variances() {
  const store = useStore();
  const allowed = can(store.role, "Decide variance causes");
  const [filter, setFilter] = useState<Variance["state"] | "all">("open");
  const [causeFilter, setCauseFilter] = useState<RootCause | "all">("all");
  // The cause on the card: the suggested one until someone picks another.
  const causeOf = (v: Variance) => store.causes[v.id] ?? v.cause;
  const inTab = store.variances.filter((v) => filter === "all" || v.state === filter);
  const shown = inTab.filter((v) => causeFilter === "all" || causeOf(v) === causeFilter);
  const causeCounts = CAUSES.map((c) => [c, inTab.filter((v) => causeOf(v) === c).length] as const).filter(([c, k]) => k > 0 || c === causeFilter);
  const [selId, setSelId] = useState<string | null>(shown[0]?.id ?? null);
  const sel = store.variances.find((v) => v.id === selId);
  const net = store.variances.reduce((a, v) => a + (v.counted - v.expected), 0);


  return (
    <div className="page">
      <PageHead title="Variances" sub="Every count that differs from XBS. Pick a cause, then accept the count, send a blind recount, or raise an exception for the owner to fix." />
      {!allowed && <ReadOnly who="Operations, the Warehouse Manager or Finance" />}

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Needs a decision</div>
          <div className="stat-value">{store.variances.filter((v) => v.state === "open").length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Net difference</div>
          <div className="stat-value">{signed(net)} units</div>
        </div>
        <div className="stat">
          <div className="stat-label">Close within</div>
          <div className="stat-value">5 working days</div>
        </div>
      </div>

      <Tabs
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setSelId(store.variances.find((v) => (f === "all" || v.state === f) && (causeFilter === "all" || causeOf(v) === causeFilter))?.id ?? null);
        }}
        items={(["open", "recount", "exception", "accepted", "all"] as const).map((k) => [
          k,
          k === "all" ? "All" : STATE[k].label,
          k === "all" ? store.variances.length : store.variances.filter((v) => v.state === k).length,
        ])}
      />

      <fieldset className="causes cause-filter">
        <legend className="field-label">Cause</legend>
        <div className="cause-chips">
          {[["all", "All causes", inTab.length] as const, ...causeCounts.map(([c, k]) => [c, c, k] as const)].map(([value, text, k]) => (
            <label key={value} className="cause">
              <input
                type="radio"
                name="cause-filter"
                checked={causeFilter === value}
                onChange={() => {
                  setCauseFilter(value);
                  setSelId(inTab.find((v) => value === "all" || causeOf(v) === value)?.id ?? null);
                }}
              />
              <span>
                {text} <em className="cause-n">{k}</em>
              </span>
            </label>
          ))}
        </div>
        {causeFilter !== "all" && (
          <p className="muted small cause-sum">
            {shown.length} variance{shown.length === 1 ? "" : "s"} · net {signed(shown.reduce((a, v) => a + (v.counted - v.expected), 0))} units ·{" "}
            <button className="link" onClick={() => setCauseFilter("all")}>
              Show all causes
            </button>
          </p>
        )}
      </fieldset>

      <div className={"review" + (sel ? " review-open" : "")}>
        <ul className="vlist">
          {shown.map((v) => {
            const cause = store.causes[v.id] ?? v.cause;
            return (
              <li key={v.id}>
                <button className="vrow" aria-pressed={v.id === selId} onClick={() => setSelId(v.id)}>
                  <span className="row-between">
                    <Code>{v.outturn}</Code>
                    <strong>
                      <Diff value={v.counted - v.expected} /> units
                      {kgDiff(v) !== undefined && (
                        <>
                          {" · "}
                          <Diff value={kgDiff(v)!} d={1} /> kg
                        </>
                      )}
                    </strong>
                  </span>
                  <span className="muted small">
                    {v.site === "IBR" ? `Ibero ${v.zone}` : v.zone} · {v.grade}
                  </span>
                  <span className="vrow-foot">
                    <span className={"cause-tag" + (cause === "Not yet known" ? " unknown" : "")}>{cause}</span>
                    {filter === "all" && <Chip tone={STATE[v.state].tone}>{STATE[v.state].label}</Chip>}
                    <span className="muted small push-right">
                      {v.counter} · {v.at}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="empty">{causeFilter === "all" ? "Nothing here." : `No "${causeFilter}" variances here.`}</li>}
        </ul>

        {sel && (
          <Detail
            key={sel.id}
            v={sel}
            allowed={allowed}
            onBack={() => setSelId(null)}
            // After a decision, go straight to the next variance in the list (the decided one leaves "Needs a decision").
            onDecided={() => {
              const i = shown.findIndex((x) => x.id === sel.id);
              const next = shown.slice(i + 1).find((x) => x.state === "open") ?? shown.slice(0, i).find((x) => x.state === "open");
              if (next) setSelId(next.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Detail({ v, allowed, onBack, onDecided }: { v: Variance; allowed: boolean; onBack: () => void; onDecided: () => void }) {
  const store = useStore();
  const cause = store.causes[v.id] ?? v.cause;
  const xbsRows = allLines().filter((l) => l.o === v.outturn);
  const d = v.counted - v.expected;

  // One page scroll: a panel taller than the window scrolls with the page until its end is in view,
  // then stays put while the list carries on. A shorter panel just stays at the top.
  const panel = useRef<HTMLElement>(null);
  const [stickTop, setStickTop] = useState<number>();
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const fit = () => {
      const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 59;
      setStickTop(Math.min(topbar + 20, window.innerHeight - el.offsetHeight - 20));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <article ref={panel} className="panel vdetail" style={stickTop === undefined ? undefined : { top: stickTop }}>
      <button className="link review-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden /> Back to the list
      </button>
      <div className="row-between">
        <div>
          <div className="muted small">
            {v.id} · {site(v.site).name}
          </div>
          <h2 className="h2">
            <Code>{v.outturn}</Code>
          </h2>
          <div className="muted">
            {v.zone} · {v.grade}
          </div>
        </div>
        <Chip tone={STATE[v.state].tone}>{STATE[v.state].label}</Chip>
      </div>

      <div className="compare">
        <div>
          <div className="stat-label">XBS expects</div>
          <div className="compare-num">{n(v.expected)}</div>
        </div>
        <div>
          <div className="stat-label">Counted</div>
          <div className="compare-num">{n(v.counted)}</div>
        </div>
        <div className={"compare-diff " + (d < 0 ? "short" : "over")}>
          <div className="stat-label">Difference</div>
          <div className="compare-num">
            <Diff value={d} />
          </div>
        </div>
      </div>
      {v.expectedKg !== undefined && v.countedKg !== undefined && (
        <p className="muted small">
          Weight: XBS {n(v.expectedKg, 1)} kg · counted {n(v.countedKg, 1)} kg · difference <Diff value={kgDiff(v)!} d={1} /> kg
        </p>
      )}

      <div className="assist">
        <div className="assist-head">
          <Sparkles size={18} aria-hidden /> <strong>Suggested cause: {v.cause}</strong>
        </div>
        <p>{v.why}</p>
        <p className="muted small">Advisory only. You decide the cause and what happens next.</p>
      </div>

      <fieldset className="causes" disabled={!allowed}>
        <legend className="field-label">Cause</legend>
        <div className="cause-chips">
          {CAUSES.map((c) => (
            <label key={c} className="cause">
              <input type="radio" name={`cause-${v.id}`} checked={cause === c} onChange={() => store.setCause(v.id, c)} />
              <span>
                {c === v.cause && <Sparkles size={13} aria-label="Suggested" />} {c}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section>
        <h3 className="field-label">Source records</h3>
        <div className="table-wrap">
          <table className="table table-tight">
            <thead>
              <tr>
                <th>Source</th>
                <th>Where</th>
                <th>Detail</th>
                <th className="num">Units</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Count</td>
                <td>{v.zone}</td>
                <td className="muted">
                  {v.counter}, {v.at} {v.photo && <PhotoButton id={v.photo} title={`${v.outturn} at ${v.zone}`} />}
                </td>
                <td className="num">{v.counted}</td>
              </tr>
              {xbsRows.map((l, i) => (
                <tr key={i}>
                  <td>XBS {l.t === "W" ? "warehouse" : "blocked"}</td>
                  <td>
                    {site(l.wh).short} {l.z !== "TEMP-0-0" ? l.z : ""}
                  </td>
                  <td className="muted">
                    {l.bn ?? "No basket"}
                    {l.so ? ` · contract ${l.so}` : ""}
                    {l.wr ? ` · ${l.wr}` : ""}
                  </td>
                  <td className="num">{l.u}</td>
                </tr>
              ))}
              {!xbsRows.length && (
                <tr>
                  <td>XBS</td>
                  <td colSpan={3} className="muted">
                    Not in XBS anywhere
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {allowed && v.state === "open" && (
        // Pinned to the bottom of the panel, so the decision is always in view.
        <div className="vactions">
          {cause === "Not yet known" && <p className="hint">Pick a cause before you accept the count.</p>}
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                store.decideVariance(v.id, "recount");
                onDecided();
              }}
            >
              Send blind recount
            </button>
            <button
              className="btn"
              disabled={cause === "Not yet known"}
              onClick={() => {
                store.decideVariance(v.id, "accepted");
                onDecided();
              }}
            >
              Accept the count
            </button>
            <button
              className="btn"
              onClick={() => {
                store.decideVariance(v.id, "exception");
                onDecided();
              }}
            >
              Raise exception
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** Counted minus XBS in kg, when both weights are known. */
const kgDiff = (v: Variance) => (v.expectedKg === undefined || v.countedKg === undefined ? undefined : v.countedKg - v.expectedKg);
