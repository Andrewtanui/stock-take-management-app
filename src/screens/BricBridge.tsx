import { useState } from "react";
import { Plus, X } from "lucide-react";
import { bricBridge, type ReconInput } from "../data/recon";
import { SITES, can } from "../data/repository";
import { useStore } from "../data/store";
import type { ReconItem } from "../data/types";
import { n } from "../ui/kit";

const bags = (x: number) => n(Math.round(x * 100) / 100, 0);
const neg = (x: number) => (x < 0 ? `(${bags(-x)})` : bags(x));

/**
 * Finance's month-end page: Total BRIC (Comtras) against the Ibero position, physical and XBS,
 * with coffee afloat and the reconciling items, down to what is still unexplained.
 */
export default function BricBridge({ input }: { input: ReconInput }) {
  const store = useStore();
  const allowed = can(store.role, "Reconciling items");
  const b = bricBridge(input, store.reconItems);
  const [kind, setKind] = useState<ReconItem["kind"]>("Reconciling item");
  const [label, setLabel] = useState("");
  const [qty, setQty] = useState("");
  const [inXbs, setInXbs] = useState(false);
  const [note, setNote] = useState("");

  if (!b)
    return (
      <section className="panel">
        <h2 className="h3">Comtras (BRIC) vs Ibero stock position</h2>
        <p className="muted">Load the Comtras P526 for this stock take on the XBS import page; the bridge then works out here.</p>
      </section>
    );

  // Suggested items: the net of the decided variances at each third-party site (stock BRIC still has,
  // the warehouse didn't: delivered after the count, at another warehouse, short weights…).
  const added = new Set(store.reconItems.map((i) => i.label));
  const suggestions = SITES.filter((s) => s.thirdParty)
    .map((s) => {
      const vs = store.variances.filter((v) => v.site === s.code && v.state !== "open");
      const kg = vs.reduce((a, v) => a + ((v.countedKg ?? v.counted * 60) - (v.expectedKg ?? v.expected * 60)), 0);
      return { label: `${s.short}: differences decided on the Variances page`, bags: -kg / 60, n: vs.length };
    })
    .filter((x) => x.n > 0 && Math.abs(x.bags) >= 0.01 && !added.has(x.label));

  const add = (i: ReconItem) => {
    store.addReconItem(i);
    setLabel("");
    setQty("");
    setNote("");
    setInXbs(false);
  };
  const row = (text: React.ReactNode, p: number | string, x: number | string, cls = "") => (
    <tr className={cls}>
      <td>{text}</td>
      <td className="num">{typeof p === "number" ? neg(p) : p}</td>
      <td className="num">{typeof x === "number" ? neg(x) : x}</td>
    </tr>
  );
  const remove = (i: ReconItem) =>
    allowed && i.id && !i.id.startsWith("tmp-") ? (
      <button className="icon-btn icon-btn-sm" aria-label={`Remove ${i.label}`} onClick={() => store.removeReconItem(i.id!)}>
        <X size={14} aria-hidden />
      </button>
    ) : null;
  const unexplained = Math.abs(b.position.physical) >= 0.5;

  return (
    <section className="panel bridge">
      <div className="row-between">
        <h2 className="h3">Comtras (BRIC) vs Ibero stock position</h2>
        <span className="muted small">60 kg bags · as on Finance's month-end page</span>
      </div>
      <div className="table-wrap">
        <table className="table bridge-table">
          <thead>
            <tr>
              <th />
              <th className="num">Physical</th>
              <th className="num">XBS</th>
            </tr>
          </thead>
          <tbody>
            {row(<strong>Total BRIC (Comtras)</strong>, b.bric, b.bric, "total")}
            <tr className="bridge-head">
              <td colSpan={3}>Ibero count results</td>
            </tr>
            {b.sites.map((s) => row(s.site.name, s.physical, s.xbsWhole))}
            {row("Counted stock", b.counted.physical, b.counted.xbs, "subtotal")}
            {b.afloatItems.length ? (
              b.afloatItems.map((i) =>
                row(
                  <span className="bridge-item">
                    {i.label} {remove(i)}
                  </span>,
                  i.bags,
                  i.bags,
                ),
              )
            ) : (
              row(<span className="muted">Stuffed coffee, afloat: not entered yet</span>, "—", "—")
            )}
            {row(<strong>Total Ibero</strong>, b.totalIbero.physical, b.totalIbero.xbs, "total")}
            {row("Difference (BRIC expected vs Ibero)", b.difference.physical, b.difference.xbs)}
            <tr className="bridge-head">
              <td colSpan={3}>Reconciling items</td>
            </tr>
            {b.recon.map((i) =>
              row(
                <span className="bridge-item">
                  {i.label}
                  {i.note ? <span className="muted small"> · {i.note}</span> : null} {remove(i)}
                </span>,
                i.bags,
                i.inXbs ? i.bags : "",
              ),
            )}
            {!b.recon.length && row(<span className="muted">None yet</span>, "", "")}
            {row("Total reconciling items", -b.itemsTotal.physical, -b.itemsTotal.xbs, "subtotal")}
            {row(
              <strong>BRIC vs Ibero stock position, unexplained</strong>,
              b.position.physical,
              b.position.xbs,
              "total " + (unexplained ? "bridge-open" : "bridge-closed"),
            )}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Brackets are negative. Afloat counts in both columns; a reconciling item counts in the XBS column only when ticked (e.g. Kenyan longs). What's left
        unexplained is what Finance's page shows as franchise.
      </p>

      {allowed && (
        <div className="bridge-add">
          <div className="seg" role="group" aria-label="Kind">
            {(["Reconciling item", "Coffee afloat"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "Coffee afloat" ? "Stuffed coffee, afloat" : "e.g. Sale 37 delivered after the count"} />
          <input className="input bridge-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Bags" />
          {kind === "Reconciling item" && (
            <label className="check-line">
              <input type="checkbox" checked={inXbs} onChange={(e) => setInXbs(e.target.checked)} /> Also in XBS column
            </label>
          )}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          <button
            className="btn btn-primary"
            disabled={!(label.trim() || kind === "Coffee afloat") || !Number.isFinite(Number(qty)) || !qty.trim()}
            onClick={() => add({ label: label.trim() || "Stuffed coffee, afloat", kind, bags: Number(qty), inXbs: kind === "Coffee afloat" || inXbs, note: note.trim() || undefined })}
          >
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      )}

      {allowed && suggestions.length > 0 && (
        <div className="bridge-suggest">
          <h3 className="field-label">Suggested from the variance decisions</h3>
          {suggestions.map((x) => (
            <div key={x.label} className="row-between">
              <span>
                {x.label} <span className="muted small">({x.n} variances)</span>
              </span>
              <span>
                <strong>{bags(x.bags)}</strong>{" "}
                <button className="link" onClick={() => store.addReconItem({ label: x.label, kind: "Reconciling item", bags: Math.round(x.bags * 100) / 100, inXbs: false })}>
                  Add
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
