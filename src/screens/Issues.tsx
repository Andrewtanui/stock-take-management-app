import { useState } from "react";
import { site } from "../data/repository";
import { useStore } from "../data/store";
import type { Issue, RootCause } from "../data/types";
import { Chip, PageHead, Tabs, type Tone } from "../ui/kit";
import { PhotoButton } from "../ui/PhotoButton";

const TONE: Record<Issue["status"], Tone> = { Open: "warn", "In progress": "info", Resolved: "ok" };
const CAUSES: (RootCause | "")[] = ["", "Split lot", "Unposted receipt", "Duplicate entry", "Mapping error", "Pocket / unit difference", "In transit", "Not yet known"];

export default function Issues() {
  const store = useStore();
  const [tab, setTab] = useState<Issue["status"] | "all">("Open");
  const rows = store.issues.filter((i) => tab === "all" || i.status === tab);
  const [sel, setSel] = useState<string | undefined>(rows[0]?.id);
  const it = store.issues.find((i) => i.id === sel);
  const [reply, setReply] = useState("");

  return (
    <div className="page">
      <PageHead
        title="Problem reports"
        sub="Raised by counters from the Stock Take app at Ibero and third-party sites. Link a report to a variance cause so recurring problems show up in the variance analysis."
      />
      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setSel(store.issues.find((i) => t === "all" || i.status === t)?.id);
        }}
        items={(["Open", "In progress", "Resolved", "all"] as const).map((k) => [
          k,
          k === "all" ? "All" : k,
          k === "all" ? store.issues.length : store.issues.filter((i) => i.status === k).length,
        ])}
      />
      <div className="split">
        <ul className="cards">
          {rows.map((i) => (
            <li key={i.id}>
              <button className="card card-btn" aria-pressed={i.id === sel} onClick={() => setSel(i.id)}>
                <span className="row-between">
                  <strong>{i.category}</strong>
                  <Chip tone={TONE[i.status]}>{i.status}</Chip>
                </span>
                <span>{i.text}</span>
                <span className="muted small">
                  {i.id} · {i.by} · {site(i.site).short} · {i.screen} · {i.at}
                </span>
              </button>
            </li>
          ))}
          {!rows.length && <li className="empty">Nothing here.</li>}
        </ul>

        {it && (
          <section className="panel">
            <div className="row-between">
              <h2 className="h3">{it.category}</h2>
              <Chip tone={TONE[it.status]}>{it.status}</Chip>
            </div>
            <p>{it.text}</p>
            {it.photo && <PhotoButton id={it.photo} title={`${it.id} · ${it.category}`} />}
            <p className="muted small">
              {it.by} · {site(it.site).name} · screen: {it.screen} · {it.at}
            </p>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Owner</span>
                <select className="input" value={it.owner ?? ""} onChange={(e) => store.updateIssue(it.id, { owner: e.target.value || undefined, status: it.status === "Open" ? "In progress" : it.status })}>
                  <option value="">Not assigned</option>
                  {[...new Set([...(it.owner ? [it.owner] : []), ...store.people])].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Variance cause it explains</span>
                <select className="input" value={it.linkedCause ?? ""} onChange={(e) => store.updateIssue(it.id, { linkedCause: (e.target.value || undefined) as RootCause | undefined })}>
                  {CAUSES.map((c) => (
                    <option key={c} value={c}>
                      {c || "None"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {it.resolution && (
              <p className="quote">
                <strong>Reply:</strong> {it.resolution}
              </p>
            )}
            {it.status !== "Resolved" && (
              <>
                <label className="field">
                  <span className="field-label">Reply to {it.by}</span>
                  <textarea className="input" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="What was done; the counter sees this in the app" />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!reply.trim()}
                  onClick={() => {
                    store.updateIssue(it.id, { status: "Resolved", resolution: reply.trim() });
                    store.flash(`${it.id} resolved. ${it.by} sees the reply in the app.`);
                    setReply("");
                  }}
                >
                  Resolve and reply
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
