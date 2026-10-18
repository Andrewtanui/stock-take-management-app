import { Fragment, useState } from "react";
import { MessageSquare } from "lucide-react";
import { can, site } from "../data/repository";
import { useStore } from "../data/store";
import type { CountRow, SheetStatus } from "../data/types";
import { Chip, PageHead, ReadOnly, Tabs, n, type Tone } from "../ui/kit";
import { PhotoButton } from "../ui/PhotoButton";

const TONE: Record<SheetStatus, Tone> = { "In progress": "info", Submitted: "warn", Approved: "ok", Rejected: "crit" };
const LABEL: Record<SheetStatus, string> = { "In progress": "In progress", Submitted: "Waiting", Approved: "Approved", Rejected: "Sent back" };

export default function Approvals() {
  const store = useStore();
  const allowed = can(store.role, "Approve or reject count sheets");
  const [tab, setTab] = useState<SheetStatus | "all">("Submitted");
  const rows = store.sheets.filter((s) => tab === "all" || s.status === tab);
  const [sel, setSel] = useState<string | undefined>(rows[0]?.id);
  const s = store.sheets.find((x) => x.id === sel);
  const [comment, setComment] = useState("");

  return (
    <div className="page">
      <PageHead
        title="Count approval"
        sub="Approve each counter's sheet, or send it back with a reason. To check just one outturn, ask for a blind recount of that line; the rest of the sheet stays as it is."
      />
      {!allowed && <ReadOnly who="Operations Admin or the Warehouse Manager" />}

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setSel(store.sheets.find((x) => t === "all" || x.status === t)?.id);
        }}
        items={(["Submitted", "Rejected", "Approved", "all"] as const).map((k) => [
          k,
          k === "all" ? "All" : LABEL[k],
          k === "all" ? store.sheets.length : store.sheets.filter((x) => x.status === k).length,
        ])}
      />

      <div className="split">
        <div className="table-wrap">
          <table className="table table-select">
            <thead>
              <tr>
                <th>Counter</th>
                <th>Where</th>
                <th className="num">Lots</th>
                <th className="num">Bags</th>
                <th className="num">Variances</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} aria-selected={r.id === sel} onClick={() => setSel(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(r.id)}>
                  <td>{r.counter}</td>
                  <td className="muted">
                    {site(r.site).short} · {r.area}
                  </td>
                  <td className="num">{r.lots}</td>
                  <td className="num">{n(r.bags)}</td>
                  <td className="num">{r.variances ? <Chip tone="warn">{r.variances}</Chip> : "0"}</td>
                  <td>
                    <Chip tone={TONE[r.status]}>{LABEL[r.status]}</Chip>
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

        {s && (
          <section className="panel">
            <div className="row-between">
              <h2 className="h3">
                {s.counter} · {site(s.site).short} {s.area}
              </h2>
              <Chip tone={TONE[s.status]}>{LABEL[s.status]}</Chip>
            </div>
            <dl className="kv">
              <dt>Sheet</dt>
              <dd className="code">{s.id}</dd>
              <dt>Submitted</dt>
              <dd>{s.submittedAt ?? "—"}</dd>
              <dt>Lots counted</dt>
              <dd>{s.lots}</dd>
              <dt>Bags</dt>
              <dd>{n(s.bags)}</dd>
              <dt>Variances to decide</dt>
              <dd>{s.variances}</dd>
            </dl>
            {s.comment && (
              <p className="quote">
                <MessageSquare size={16} aria-hidden /> {s.comment}
              </p>
            )}
            {s.variances > 0 && <p className="hint">These variances are on the Variances page, each with a suggested cause. Decide them there, or ask for a recount of a line below.</p>}
            <SheetLines sheet={s.id} canRecount={allowed && s.status !== "Approved"} />
            {s.status === "Rejected" && (
              <div className="callout callout-warn">
                <div>
                  <strong>Waiting for the counter's recount.</strong> It comes back here as a new submission.{" "}
                  <button className="link" onClick={() => store.decideSheet(s.id, "Submitted", "Recount submitted")}>
                    Demo: recount received
                  </button>
                </div>
              </div>
            )}
            {allowed && s.status === "Submitted" && (
              <>
                <label className="field">
                  <span className="field-label">Comment (required to send back)</span>
                  <textarea
                    className="input"
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="e.g. Recount the lots behind the pillar"
                  />
                  <span className="muted small">The counter sees this. Don't include XBS figures — counting is blind.</span>
                </label>
                <div className="btn-row">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      store.decideSheet(s.id, "Approved", comment);
                      setComment("");
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="btn"
                    disabled={!comment.trim()}
                    onClick={() => {
                      store.decideSheet(s.id, "Rejected", comment);
                      setComment("");
                    }}
                  >
                    Send back for recount
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** The lines on a sheet, with the counter's photo of the tag where one was taken,
 *  and a blind recount of a single outturn when one line looks wrong. */
function SheetLines({ sheet, canRecount }: { sheet: string; canRecount: boolean }) {
  const store = useStore();
  const [asking, setAsking] = useState<CountRow | null>(null);
  const [note, setNote] = useState("");
  const lines = store.counts
    .filter((c) => c.sheet === sheet)
    .sort((a, b) => a.stack.localeCompare(b.stack) || a.outturn.localeCompare(b.outturn));
  if (!lines.length) return null;
  const photos = lines.filter((l) => l.photo).length;
  const cols = 5;
  return (
    <section className="sheet-lines">
      <h3 className="field-label">
        Lines on this sheet · {lines.length}
        {photos ? ` · ${photos} with a photo` : ""}
      </h3>
      <div className="table-wrap scroll-y">
        <table className="table table-tight">
          <thead>
            <tr>
              <th>Stack</th>
              <th>Outturn</th>
              <th className="num">Units</th>
              <th className="num">Kg</th>
              <th>
                <span className="sr-only">Photo and recount</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const asked = store.lineRecount(l);
              const open = asking === l;
              return (
                <Fragment key={l.id ?? i}>
                  <tr>
                    <td className="code nowrap">{l.stack}</td>
                    <td>
                      <span className="code">{l.other ? l.category ?? "Other stock" : l.outturn}</span>
                      <span className="line-sub">{[l.grade, l.reason ?? (l.found ? "Found here" : "")].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="num">{n(l.units)}</td>
                    <td className="num">{n(l.kg, 1)}</td>
                    <td className="line-actions">
                      {l.photo && <PhotoButton id={l.photo} title={`${l.outturn || l.category} at ${l.stack}`} />}
                      {canRecount &&
                        (asked ? (
                          <span title={asked === "sending" ? "Sending the recount" : `Blind recount ${asked} sent to ${store.recountTo(asked) ?? "another counter"}`}>
                            <Chip tone="info">{asked === "sending" ? "Sending…" : asked}</Chip>
                          </span>
                        ) : l.other ? null : (
                          <button
                            className="link"
                            aria-expanded={open}
                            onClick={() => {
                              setAsking(open ? null : l);
                              setNote("");
                            }}
                          >
                            Recount
                          </button>
                        ))}
                    </td>
                  </tr>
                  {open && (
                    <tr className="row-form">
                      <td colSpan={cols}>
                        <div className="inline-form">
                          <p>
                            <strong>
                              Blind recount of <span className="code">{l.outturn}</span> at <span className="code">{l.stack}</span>
                            </strong>{" "}
                            <span className="muted">· goes to a different counter picked at random (not {l.by}); the other lines stay as they are.</span>
                          </p>
                          <label className="field">
                            <span className="field-label">Reason for the counter (optional)</span>
                            <input
                              className="input"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder="e.g. Tag on the second tier looks different"
                            />
                            <span className="muted small">The counter sees this. Don't include XBS figures or the earlier count; counting is blind.</span>
                          </label>
                          <div className="btn-row">
                            <button
                              className="btn btn-primary"
                              onClick={() => {
                                store.recountLine(l, note);
                                setAsking(null);
                              }}
                            >
                              Send recount
                            </button>
                            <button className="btn" onClick={() => setAsking(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
