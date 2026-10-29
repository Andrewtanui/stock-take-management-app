import { useState } from "react";
import { Plus, X } from "lucide-react";
import { bricBridge, type ReconInput } from "../data/recon";
import { bridgeProposals, type Proposal } from "../data/bridge-proposals";
import { SITES, allLines, can } from "../data/repository";
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
        <p className="muted">
          Load the Comtras P526 for this stock take on the XBS import page; the
          bridge then works out here.
        </p>
      </section>
    );

  // The items the Hub works out from its sources, for Finance to accept instead of typing them.
  const proposals = bridgeProposals({
    cutOff: store.kpiCountDate,
    comtras: store.comtras?.lines,
    journal: store.contractJournal?.lines,
    shipments: store.shipments?.lines,
    xbsStuffing: store.xbsStuffing?.rows,
    variances: store.variances,
    lines: allLines(),
    sites: SITES,
    items: store.reconItems,
  });
  const open = proposals.filter((p) => !p.onBridge && !p.similar?.length);
  // Typed items that only share a warehouse name in their label are shown, never removed.
  const accept = (p: Proposal) =>
    store.addReconItem({
      label: p.label,
      kind: p.kind,
      bags: p.bags,
      inXbs: p.inXbs,
      note: `Proposed by the Hub. ${p.source}`.slice(0, 2000),
    });
  const replace = (p: Proposal) => {
    for (const i of p.similar ?? [])
      if (i.id && !i.id.startsWith("tmp-")) store.removeReconItem(i.id);
    accept(p);
  };

  const add = (i: ReconItem) => {
    store.addReconItem(i);
    setLabel("");
    setQty("");
    setNote("");
    setInXbs(false);
  };
  const row = (
    text: React.ReactNode,
    p: number | string,
    x: number | string,
    cls = "",
  ) => (
    <tr className={cls}>
      <td>{text}</td>
      <td className="num">{typeof p === "number" ? neg(p) : p}</td>
      <td className="num">{typeof x === "number" ? neg(x) : x}</td>
    </tr>
  );
  const remove = (i: ReconItem) =>
    allowed && i.id && !i.id.startsWith("tmp-") ? (
      <button
        className="icon-btn icon-btn-sm"
        aria-label={`Remove ${i.label}`}
        onClick={() => store.removeReconItem(i.id!)}
      >
        <X size={14} aria-hidden />
      </button>
    ) : null;
  const unexplained = Math.abs(b.position.physical) >= 0.5;

  return (
    <section className="panel bridge">
      <div className="row-between">
        <h2 className="h3">Comtras (BRIC) vs Ibero stock position</h2>
        <span className="muted small">
          60 kg bags · as on Finance's month-end page
        </span>
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
            {row(
              <strong>Total BRIC (Comtras)</strong>,
              b.bric,
              b.bric,
              "total",
            )}
            <tr className="bridge-head">
              <td colSpan={3}>Ibero count results</td>
            </tr>
            {b.sites.map((s) => row(s.site.name, s.physical, s.xbsWhole))}
            {row(
              "Counted stock",
              b.counted.physical,
              b.counted.xbs,
              "subtotal",
            )}
            {b.afloatItems.length
              ? b.afloatItems.map((i) =>
                  row(
                    <span className="bridge-item">
                      {i.label} {remove(i)}
                    </span>,
                    i.bags,
                    i.bags,
                  ),
                )
              : row(
                  <span className="muted">
                    Stuffed coffee, afloat: not entered yet
                  </span>,
                  "—",
                  "—",
                )}
            {row(
              <strong>Total Ibero</strong>,
              b.totalIbero.physical,
              b.totalIbero.xbs,
              "total",
            )}
            {row(
              "Difference (BRIC expected vs Ibero)",
              b.difference.physical,
              b.difference.xbs,
            )}
            <tr className="bridge-head">
              <td colSpan={3}>Reconciling items</td>
            </tr>
            {b.recon.map((i) =>
              row(
                <span className="bridge-item">
                  {i.label}
                  {i.note ? (
                    <span className="muted small"> · {i.note}</span>
                  ) : null}{" "}
                  {remove(i)}
                </span>,
                i.bags,
                i.inXbs ? i.bags : "",
              ),
            )}
            {!b.recon.length &&
              row(<span className="muted">None yet</span>, "", "")}
            {row(
              "Total reconciling items",
              -b.itemsTotal.physical,
              -b.itemsTotal.xbs,
              "subtotal",
            )}
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
        Brackets are negative. Afloat counts in both columns; a reconciling item
        counts in the XBS column only when ticked (e.g. Kenyan longs). What's
        left unexplained is what Finance's page shows as franchise.
      </p>

      {allowed && (
        <div className="bridge-add">
          <div className="seg" role="group" aria-label="Kind">
            {(["Reconciling item", "Coffee afloat"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              kind === "Coffee afloat"
                ? "Stuffed coffee, afloat"
                : "e.g. Sale 37 delivered after the count"
            }
          />
          <input
            className="input bridge-qty"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Bags"
          />
          {kind === "Reconciling item" && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={inXbs}
                onChange={(e) => setInXbs(e.target.checked)}
              />{" "}
              Also in XBS column
            </label>
          )}
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
          />
          <button
            className="btn btn-primary"
            disabled={
              !(label.trim() || kind === "Coffee afloat") ||
              !Number.isFinite(Number(qty)) ||
              !qty.trim()
            }
            onClick={() =>
              add({
                label: label.trim() || "Stuffed coffee, afloat",
                kind,
                bags: Number(qty),
                inXbs: kind === "Coffee afloat" || inXbs,
                note: note.trim() || undefined,
              })
            }
          >
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="bridge-suggest">
          <div className="row-between">
            <h3 className="field-label">Proposed by the Hub</h3>
            {allowed && open.length > 1 && (
              <button
                className="btn btn-sm"
                onClick={() => open.forEach(accept)}
              >
                Accept all {open.length}
              </button>
            )}
          </div>
          <p className="muted small">
            Worked out from the P526, the 537, the shipment tracker and the
            Level 1 decisions. Accept one to put it on the bridge with its
            source in the note; you can still remove it. Sale 37 and coffee
            under a broker's account need Trading's auction results and
            Logistics' confirmations, so they stay typed.
          </p>
          <ul className="check-list">
            {proposals.map((p) => {
              const typed = p.similar ?? [];
              const typedBags = typed.reduce((a, i) => a + i.bags, 0);
              return (
                <li key={p.label}>
                  <div className="check-row">
                    <span className="check-text">
                      <strong>
                        {p.label} · {bags(p.bags)}{" "}
                        {p.kind === "Coffee afloat"
                          ? "(afloat)"
                          : p.inXbs
                            ? "(both columns)"
                            : "(physical column)"}
                      </strong>
                      <span className="muted small">{p.source}</span>
                      {p.detail && (
                        <span className="muted small">{p.detail}</span>
                      )}
                      {!p.onBridge && typed.length > 0 && (
                        <span className="small">
                          Typed on the bridge:{" "}
                          {typed
                            .map((i) => `${i.label} (${bags(i.bags)})`)
                            .join(", ")}{" "}
                          = {bags(typedBags)} · {bags(p.bags - typedBags)}{" "}
                          apart.
                        </span>
                      )}
                    </span>
                    {p.onBridge ? (
                      <span className="muted small">On the bridge</span>
                    ) : (
                      allowed &&
                      (typed.length ? (
                        !p.replaces ? (
                          <span className="muted small">
                            Typed items cover it
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={() => replace(p)}
                            title={`Removes ${typed.map((i) => i.label).join(", ")} and adds the Hub's figure`}
                          >
                            Replace typed
                          </button>
                        )
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => accept(p)}
                        >
                          Accept
                        </button>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
