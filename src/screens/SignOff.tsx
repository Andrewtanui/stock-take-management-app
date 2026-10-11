import { useState } from "react";
import { Check, Download, Mail, ShieldAlert } from "lucide-react";
import { CHAIN, TARGET_PCT, TODAY, reconciliation, sum, warehouseSummary } from "../data/repository";
import { PEOPLE, PREPARER, useStore } from "../data/store";
import { Chip, Diff, PageHead, n, signed } from "../ui/kit";

export default function SignOff() {
  const store = useStore();
  const rows = warehouseSummary();
  const rec = reconciliation(store.baskets).primary;
  const xbs = sum(rec, (r) => r.xbs);
  const phys = sum(rec, (r) => r.physical);
  const net = ((phys - xbs) / xbs) * 100;
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);

  const openVar = store.variances.filter((v) => v.state === "open").length;
  const waitingSheets = store.sheets.filter((s) => s.status !== "Approved").length;
  const nextIdx = CHAIN.findIndex((c) => !store.signatures[c.role]);
  const next = CHAIN[nextIdx];
  const mine = next?.role === store.role;
  const blockers = [
    openVar > 0 && `${openVar} variances still need a decision`,
    waitingSheets > 0 && `${waitingSheets} count sheets aren't approved yet`,
  ].filter(Boolean) as string[];
  const blocked = nextIdx === 0 && blockers.length > 0;
  const isPreparer = store.me === PREPARER;
  // The SOP clock only runs once counting is over.
  const status = store.stockTakes[0]?.status;
  const clockRunning = status === "Reconciliation" || status === "Sign-off";

  return (
    <div className="page">
      <PageHead
        title="Sign-off"
        sub={`${clockRunning ? `Day ${TODAY.signOffDay} of ${TODAY.signOffTarget}.` : "Not started — counting is still open."} The SOP asks for sign-off within ${TODAY.signOffTarget} working days of the count. Each gate signs in order; the next signer is told in Teams.`}
        actions={
          <>
            <button className="btn">
              <Download size={18} aria-hidden /> PDF
            </button>
            <button className="btn">
              <Download size={18} aria-hidden /> Excel
            </button>
          </>
        }
      />

      <ol className="steps">
        {CHAIN.map((c, i) => {
          const s = store.signatures[c.role];
          const state = s ? "done" : i === nextIdx ? "active" : "todo";
          return (
            <li key={c.role} className={`step st-${state}`}>
              <span className="step-dot">{s ? <Check size={16} aria-hidden /> : i + 1}</span>
              <div>
                <div className="step-who">{c.title}</div>
                <div className="muted small">{s ? `${s.by} · ${s.at}` : `${PEOPLE[c.role]} · ${c.signs}`}</div>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">Stock sign-off, by warehouse</h2>
          <span>
            Net variance{" "}
            <Chip tone={Math.abs(net) <= TARGET_PCT ? "ok" : "crit"}>
              {signed(net, 2)}% · target ±{TARGET_PCT}%
            </Chip>
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="num">Physical units</th>
                <th className="num">System units</th>
                <th className="num">Variance units</th>
                <th className="num">Physical 60 kg bags</th>
                <th className="num">System 60 kg bags</th>
                <th className="num">Variance 60 kg bags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.code}>
                  <td>{r.site.name}</td>
                  <td className="num">{n(r.physUnits)}</td>
                  <td className="num">{n(r.sysUnits)}</td>
                  <td className="num">
                    <Diff value={r.physUnits - r.sysUnits} />
                  </td>
                  <td className="num">{n(r.phys60, 1)}</td>
                  <td className="num">{n(r.sys60, 1)}</td>
                  <td className="num">
                    <Diff value={Math.round((r.phys60 - r.sys60) * 10) / 10} />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td className="num">{n(sum(rows, (r) => r.physUnits))}</td>
                <td className="num">{n(sum(rows, (r) => r.sysUnits))}</td>
                <td className="num">
                  <Diff value={sum(rows, (r) => r.physUnits - r.sysUnits)} />
                </td>
                <td className="num">{n(sum(rows, (r) => r.phys60), 1)}</td>
                <td className="num">{n(sum(rows, (r) => r.sys60), 1)}</td>
                <td className="num">
                  <Diff value={Math.round(sum(rows, (r) => r.phys60 - r.sys60) * 10) / 10} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">
          By grade, with Operations and Trading comments per line, in the PDF and Excel pack. Prepared by {PREPARER} (Finance).
        </p>
      </section>

      {CHAIN.some((c) => store.signatures[c.role]?.comment) && (
        <section className="panel">
          <h2 className="h3">Comments</h2>
          <ul className="plain">
            {CHAIN.filter((c) => store.signatures[c.role]?.comment).map((c) => (
              <li key={c.role}>
                <strong>{c.title}:</strong> {store.signatures[c.role]!.comment}
              </li>
            ))}
          </ul>
        </section>
      )}

      {next ? (
        <section className="panel signbox">
          <h2 className="h3">
            {mine ? `Your sign-off: ${next.title}` : `Waiting for ${next.title} (${PEOPLE[next.role]})`}
          </h2>
          {!mine && <p className="muted">Switch "Viewing as" to {next.role} to sign this step.</p>}
          {(isPreparer || next.role === "Finance") && (
            <p className="readonly">
              <ShieldAlert size={16} aria-hidden />{" "}
              {isPreparer
                ? "You prepared this pack, so you can't approve it."
                : `Separation of duties: ${PREPARER} prepared this pack, so Finance sign-off has to come from someone else.`}
            </p>
          )}
          {mine && blocked && (
            <div className="callout callout-warn">
              <div>
                <strong>Not ready for sign-off.</strong>
                <ul className="plain">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {mine && !isPreparer && (
            <>
              <label className="field">
                <span className="field-label">Comment</span>
                <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <label className="check-line">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I've reviewed this position: {next.signs.toLowerCase()}.</span>
              </label>
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  disabled={!ack || blocked}
                  onClick={() => {
                    store.sign(next.role, comment);
                    setComment("");
                    setAck(false);
                  }}
                >
                  Sign as {next.title}
                </button>
                {nextIdx > 0 && (
                  <button className="btn" disabled={!comment.trim()} onClick={() => (store.sendBack(next.role, comment), setComment(""))}>
                    Send back to Operations
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="panel signbox">
          <h2 className="h3">Certified</h2>
          <p>
            All four gates have signed. The sign-off pack went to the stock take distribution list. <Mail size={16} aria-hidden />
          </p>
        </section>
      )}
    </div>
  );
}
