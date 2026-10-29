import { Fragment, useState } from "react";
import { ArrowRight, Check, Download, Mail, ShieldAlert } from "lucide-react";
import { byWarehouse, netVariance } from "../data/recon";
import { TARGET_PCT, TODAY, openGates, sum, type GateDef } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, Diff, PageHead, n, signed } from "../ui/kit";

export default function SignOff() {
  const store = useStore();
  // Counted stock only: warehouses not counted show as such, never as matching XBS.
  const reconInput = { counts: store.counts, stacks: store.stacks, baskets: store.baskets };
  const rows = byWarehouse(reconInput);
  const rec = netVariance(reconInput);
  const net = rec.pct;
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);

  const chain = store.chain;
  const open = openGates(chain, store.signatures);
  // The person viewing signs their own gate, when it is open.
  const mineNow = open.find((g) => g.gate === store.myGate);
  const first = !chain.some((g) => store.signatures[g.gate]);
  const openVar = store.variances.filter((v) => v.state === "open").length;
  const waitingSheets = store.sheets.filter((s) => s.status !== "Approved").length;
  const blockers = [
    openVar > 0 && `${openVar} variances still need a decision`,
    waitingSheets > 0 && `${waitingSheets} count sheets aren't approved yet`,
  ].filter(Boolean) as string[];
  const blocked = first && blockers.length > 0;
  // The SOP clock only runs once counting is over.
  const status = store.stockTakes[0]?.status;
  const clockRunning = status === "Reconciliation" || status === "Sign-off";
  const tiers = [...new Set(chain.map((g) => g.tier))];
  const who = (g: GateDef) => {
    const s = store.signerOf(g.gate);
    return `${s.name}${s.standIn ? ` (stand-in ${s.standIn.name})` : ""}`;
  };

  return (
    <div className="page">
      <PageHead
        title="Sign-off"
        sub={`${clockRunning ? `Day ${TODAY.signOffDay} of ${TODAY.signOffTarget}.` : "Not started — counting is still open."} The SOP asks for sign-off within ${TODAY.signOffTarget} working days of the count. Prepared, then reviewed, then approved; ${chain.at(-1)?.gate ?? "the last gate"} signs last. Each signer is told in Teams when it is their turn.`}
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

      {/* Left to right: prepared, reviewed, approved. Within a tier the gates of one step sign in any
          order; a later step in the same tier (Country Finance Manager) signs after them. */}
      <section className="panel" aria-label="Sign-off chain">
        <div className="signflow">
          {tiers.map((tier, t) => {
            const gates = chain.filter((g) => g.tier === tier);
            return (
              <Fragment key={tier}>
                {t > 0 && (
                  <span className="signflow-arrow" aria-hidden>
                    <ArrowRight size={20} />
                  </span>
                )}
                <div className="signflow-tier">
                  <h2 className="signflow-head">{tier} by</h2>
                  <ol className="signflow-gates">
                    {gates.map((g, i) => {
                      const s = store.signatures[g.gate];
                      const state = s ? "done" : open.includes(g) ? "active" : "todo";
                      const later = i > 0 && g.step > gates[i - 1].step;
                      return (
                        <Fragment key={g.gate}>
                          {later && <li className="signflow-then muted small">then</li>}
                          <li className={`step st-${state}`}>
                            <span className="step-dot">{s ? <Check size={16} aria-hidden /> : chain.indexOf(g) + 1}</span>
                            <div>
                              <div className="step-who">{s?.by ?? who(g)}</div>
                              <div className="small">{g.gate}</div>
                              <div className="muted small">{s ? `Signed ${s.at}` : state === "active" ? "Can sign now" : "Waiting"}</div>
                            </div>
                          </li>
                        </Fragment>
                      );
                    })}
                  </ol>
                </div>
              </Fragment>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">Stock sign-off, by warehouse</h2>
          <span>
            Net variance{" "}
            <Chip tone={!rec.counted ? "neutral" : Math.abs(net) <= TARGET_PCT ? "ok" : "crit"}>
              {rec.counted ? `${signed(net, 2)}% · target ±${TARGET_PCT}% · ${Math.round(rec.cover * 100)}% of XBS counted` : "nothing counted yet"}
            </Chip>
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th>Status</th>
                <th className="num">Physical units</th>
                <th className="num">System units</th>
                <th className="num">Variance units</th>
                <th className="num">Physical 60 kg</th>
                <th className="num">System 60 kg</th>
                <th className="num">Variance 60 kg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const counted = r.status !== "Not counted";
                return (
                  <tr key={r.site.code}>
                    <td>{r.site.name}</td>
                    <td className="muted">{r.status === "Partly counted" ? `Partly counted · ${Math.round(r.cover * 100)}%` : r.status}</td>
                    <td className="num">{counted ? n(r.physUnits) : "—"}</td>
                    <td className="num">{counted ? n(r.xbsUnits) : "—"}</td>
                    <td className="num">{counted ? <Diff value={r.physUnits - r.xbsUnits} /> : "—"}</td>
                    <td className="num">{counted ? n(r.physical, 1) : "—"}</td>
                    <td className="num">{counted ? n(r.xbs, 1) : "—"}</td>
                    <td className="num">{counted ? <Diff value={r.physical - r.xbs} d={1} /> : "—"}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>Total counted</td>
                <td />
                <td className="num">{n(sum(rows, (r) => r.physUnits))}</td>
                <td className="num">{n(sum(rows, (r) => r.xbsUnits))}</td>
                <td className="num">
                  <Diff value={sum(rows, (r) => r.physUnits - r.xbsUnits)} />
                </td>
                <td className="num">{n(sum(rows, (r) => r.physical), 1)}</td>
                <td className="num">{n(sum(rows, (r) => r.xbs), 1)}</td>
                <td className="num">
                  <Diff value={sum(rows, (r) => r.physical - r.xbs)} d={1} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small">By grade, with Operations and Trading comments per line, in the PDF and Excel pack, which ends with the signature block above.</p>
      </section>

      {chain.some((g) => store.signatures[g.gate]?.comment) && (
        <section className="panel">
          <h2 className="h3">Comments</h2>
          <ul className="plain">
            {chain
              .filter((g) => store.signatures[g.gate]?.comment)
              .map((g) => (
                <li key={g.gate}>
                  <strong>{g.gate}:</strong> {store.signatures[g.gate]!.comment}
                </li>
              ))}
          </ul>
        </section>
      )}

      {open.length ? (
        <section className="panel signbox">
          <h2 className="h3">
            {mineNow ? `Your sign-off: ${mineNow.gate}` : `Waiting for ${open.map((g) => `${who(g)} (${g.gate})`).join(" and ")}`}
          </h2>
          {!mineNow && <p className="muted">Switch "Viewing as" to {open.map((g) => who(g)).join(" or ")} to sign.</p>}
          <p className="readonly">
            <ShieldAlert size={16} aria-hidden /> Separation of duties: one person signs one gate. A stand-in can sign for an absent signer.
          </p>
          {mineNow && blocked && (
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
          {mineNow && (
            <>
              <label className="field">
                <span className="field-label">Comment</span>
                <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <label className="check-line">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I've reviewed this position: {mineNow.signs.toLowerCase()}.</span>
              </label>
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  disabled={!ack || blocked}
                  onClick={() => {
                    store.sign(mineNow.gate, comment);
                    setComment("");
                    setAck(false);
                  }}
                >
                  Sign as {mineNow.gate}
                </button>
                {!first && (
                  <button className="btn" disabled={!comment.trim()} onClick={() => (store.sendBack(mineNow.gate, comment), setComment(""))}>
                    Send back to {chain[0].gate}
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
            All {chain.length} gates have signed. The sign-off pack went to the stock take distribution list. <Mail size={16} aria-hidden />
          </p>
        </section>
      )}
    </div>
  );
}
