import { useState } from "react";
import { BellRing } from "lucide-react";
import { ESCALATION, SLA_DAYS } from "../data/repository";
import { useStore } from "../data/store";
import type { Exception } from "../data/types";
import { Chip, PageHead, Tabs, n, type Tone } from "../ui/kit";

type F = "open" | "overdue" | "escalated" | "closed" | "all";
const STATUS_TONE: Record<Exception["status"], Tone> = { Open: "warn", "In progress": "info", Escalated: "crit", Closed: "ok" };
const OWNERS = ["Peter M.", "Joseph O.", "Mary W.", "Dennis I.", "Samuel K."];

function due(e: Exception) {
  if (e.status === "Closed") return <span className="muted">Closed</span>;
  if (e.dueDays < 0) return <Chip tone="crit">{-e.dueDays} day{e.dueDays === -1 ? "" : "s"} overdue</Chip>;
  if (e.dueDays === 0) return <Chip tone="warn">Due today</Chip>;
  return <span>{e.dueDays} day{e.dueDays === 1 ? "" : "s"} left</span>;
}

export default function Exceptions() {
  const store = useStore();
  const [f, setF] = useState<F>("open");
  const match = (e: Exception) =>
    f === "all" ||
    (f === "open" && e.status !== "Closed") ||
    (f === "overdue" && e.status !== "Closed" && e.dueDays < 0) ||
    (f === "escalated" && e.status === "Escalated") ||
    (f === "closed" && e.status === "Closed");
  const rows = store.exceptions.filter(match);
  const [sel, setSel] = useState<string | undefined>(rows[0]?.id);
  const ex = store.exceptions.find((e) => e.id === sel);
  const [resolution, setResolution] = useState("");

  const byKind = new Map<string, number>();
  for (const e of store.exceptions) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...kinds.map((k) => k[1]));

  return (
    <div className="page">
      <PageHead
        title="Exceptions"
        sub={`Every issue that needs fixing at source, with an owner and a ${SLA_DAYS}-working-day deadline. Overdue items alert the owner in Teams, then escalate to their head of department, then to the Country Finance Manager.`}
      />

      <Tabs
        value={f}
        onChange={(v) => {
          setF(v);
          setSel(store.exceptions.find((e) => (v === "all" ? true : v === "closed" ? e.status === "Closed" : e.status !== "Closed"))?.id);
        }}
        items={[
          ["open", "Open", store.exceptions.filter((e) => e.status !== "Closed").length],
          ["overdue", "Overdue", store.exceptions.filter((e) => e.status !== "Closed" && e.dueDays < 0).length],
          ["escalated", "Escalated", store.exceptions.filter((e) => e.status === "Escalated").length],
          ["closed", "Closed", store.exceptions.filter((e) => e.status === "Closed").length],
          ["all", "All", store.exceptions.length],
        ]}
      />

      <div className="split split-wide">
        <div className="table-wrap">
          <table className="table table-select">
            <thead>
              <tr>
                <th>Exception</th>
                <th>Cause</th>
                <th>Owner</th>
                <th>Due</th>
                <th className="num">Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} aria-selected={e.id === sel} tabIndex={0} onClick={() => setSel(e.id)} onKeyDown={(k) => k.key === "Enter" && setSel(e.id)}>
                  <td>
                    <div className="code small">{e.id}</div>
                    {e.title}
                  </td>
                  <td className="muted">{e.kind}</td>
                  <td>
                    {e.owner}
                    <div className="muted small">{e.dept}</div>
                  </td>
                  <td>{due(e)}</td>
                  <td className="num">{e.ageDays}d</td>
                  <td>
                    <Chip tone={STATUS_TONE[e.status]}>{e.status}</Chip>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {ex && (
          <section className="panel">
            <div className="row-between">
              <span className="code">{ex.id}</span>
              <Chip tone={STATUS_TONE[ex.status]}>{ex.status}</Chip>
            </div>
            <h2 className="h3">{ex.title}</h2>
            <dl className="kv">
              <dt>Cause</dt>
              <dd>{ex.kind}</dd>
              <dt>From</dt>
              <dd>
                {ex.source} · {ex.ref}
              </dd>
              <dt>Raised</dt>
              <dd>{ex.raised}</dd>
              <dt>Bags</dt>
              <dd>{n(ex.bags)}</dd>
              <dt>Due</dt>
              <dd>{due(ex)}</dd>
            </dl>

            <div>
              <span className="field-label">Escalation</span>
              <ol className="ladder">
                {ESCALATION.map((step, i) => (
                  <li key={step} className={i < ex.escalation ? "done" : i === ex.escalation ? (ex.escalation ? "now hot" : "now") : ""}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            {ex.status !== "Closed" && (
              <>
                <label className="field">
                  <span className="field-label">Owner</span>
                  <select className="input" value={ex.owner} onChange={(e) => store.updateException(ex.id, { owner: e.target.value })}>
                    {OWNERS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <div className="btn-row">
                  <button className="btn" onClick={() => (store.updateException(ex.id, { status: "In progress" }), store.flash(`Reminder sent to ${ex.owner} in Teams.`))}>
                    <BellRing size={16} aria-hidden /> Remind owner
                  </button>
                  <button
                    className="btn"
                    disabled={ex.escalation >= ESCALATION.length - 1}
                    onClick={() => {
                      store.updateException(ex.id, { status: "Escalated", escalation: ex.escalation + 1 });
                      store.flash(`Escalated to ${ESCALATION[ex.escalation + 1]}.`);
                    }}
                  >
                    Escalate
                  </button>
                </div>
                <label className="field">
                  <span className="field-label">How it was fixed</span>
                  <textarea className="input" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. Gate-out posted in XBS on 4 Mar, GRN 55120" />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!resolution.trim()}
                  onClick={() => {
                    store.updateException(ex.id, { status: "Closed" });
                    store.flash(`${ex.id} closed.`);
                    setResolution("");
                  }}
                >
                  Close exception
                </button>
              </>
            )}
          </section>
        )}
      </div>

      <section className="panel">
        <h2 className="h3">By cause, this stock take</h2>
        <ul className="bars">
          {kinds.map(([k, c]) => (
            <li key={k}>
              <span>{k}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(c / max) * 100}%` }} />
              </span>
              <span className="num">{c}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
