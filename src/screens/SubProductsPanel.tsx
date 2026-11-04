import { useState } from "react";
import { UserRound } from "lucide-react";
import { useStore } from "../data/store";
import { compareSubProducts } from "../data/subproducts";
import { Code, Diff, n } from "../ui/kit";

const r2 = (x: number) => Math.round(x * 100) / 100;
const note = (l: { bookKg: number; countedKg: number }) =>
  !l.countedKg ? "In the register, not counted" : !l.bookKg ? "Counted, not in the register" : Math.abs(l.bookKg - l.countedKg) >= 1 ? "Weight differs" : "";

/**
 * Reconciliation: Ibero's off-system stock (ex-office and clean sweepings, franchise) - the warehouse's
 * registers against what was counted, per kind and per lot. Finance's "Subproducts" line.
 */
export default function SubProductsPanel() {
  const store = useStore();
  const cutOff = store.kpiCountDate;
  const sp = compareSubProducts(store.subProducts?.rows ?? [], store.counts, cutOff);
  const [open, setOpen] = useState(false);
  const [raised, setRaised] = useState<Record<string, boolean>>({});
  const off = sp.lots.filter((l) => Math.abs(l.bookKg - l.countedKg) >= 1);
  const shown = open ? sp.lots : off;
  if (!sp.hasBook && !sp.countLines)
    return (
      <section className="panel">
        <h2 className="h3">Sub-products (off system)</h2>
        <p className="muted small">
          Ex-office sweepings, clean sweepings and franchise: Ibero stock that isn't in XBS. Load the warehouse's sub-products report and franchise inventory on the
          XBS import page; counters record them under "Sweepings & other".
        </p>
      </section>
    );

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Sub-products (off system)</h2>
        <span className="muted small">60 kg bags · registers to {cutOff ?? "the count"}</span>
      </div>
      <p className="muted small">
        Stock at Ibero that is in neither XBS nor the counted lots, so it is a line on the BRIC bridge (Finance's "Subproducts"). The registers give the figure; the
        count checks it.
        {!sp.hasBook && " No registers loaded yet: load the sub-products report and the franchise inventory on the XBS import page."}
        {sp.hasBook && !sp.countLines && " Nothing counted as sub-products yet."}
      </p>
      <div className="table-wrap">
        <table className="table table-tight">
          <thead>
            <tr>
              <th>Kind</th>
              <th className="num">Lots</th>
              <th className="num">Register</th>
              <th className="num">Counted</th>
              <th className="num">Counted − register</th>
            </tr>
          </thead>
          <tbody>
            {sp.kinds.map((k) => (
              <tr key={k.kind}>
                <td>{k.kind}</td>
                <td className="num">{k.lots || "—"}</td>
                <td className="num">{sp.hasBook ? n(r2(k.book), 2) : "—"}</td>
                <td className="num">{n(r2(k.counted), 2)}</td>
                <td className="num">{sp.hasBook && (k.book || k.counted) ? <Diff value={r2(k.counted - k.book)} d={2} /> : "—"}</td>
              </tr>
            ))}
            <tr className="total">
              <td>
                <strong>Total</strong>
              </td>
              <td />
              <td className="num">
                <strong>{sp.hasBook ? n(r2(sp.book), 2) : "—"}</strong>
              </td>
              <td className="num">
                <strong>{n(r2(sp.counted), 2)}</strong>
              </td>
              <td className="num">{sp.hasBook ? <Diff value={r2(sp.counted - sp.book)} d={2} /> : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {sp.hasBook && sp.countLines > 0 && (
        <>
          <div className="row-between">
            <h3 className="field-label">{open ? "Every lot" : `Lots that differ (${off.length})`}</h3>
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {open ? "Only lots that differ" : `Show all ${sp.lots.length}`}
            </button>
          </div>
          {shown.length ? (
            <div className="table-wrap">
              <table className="table table-tight">
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Kind</th>
                    <th>Where</th>
                    <th className="num">Register kg</th>
                    <th className="num">Counted kg</th>
                    <th>Note</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 60).map((l) => (
                    <tr key={`${l.kind}|${l.ref}`}>
                      <td>
                        <Code>{l.ref}</Code>
                      </td>
                      <td className="muted small">{l.kind}</td>
                      <td className="muted small">{l.location ?? ""}</td>
                      <td className="num">{l.bookKg ? n(l.bookKg) : "—"}</td>
                      <td className="num">{l.countedKg ? n(l.countedKg) : "—"}</td>
                      <td className="muted small">{note(l)}</td>
                      <td>
                        {note(l) && (
                          <button
                            className="btn btn-sm"
                            disabled={raised[`${l.kind}|${l.ref}`]}
                            title="Raise an exception for the warehouse to explain this lot"
                            onClick={() => {
                              setRaised((m) => ({ ...m, [`${l.kind}|${l.ref}`]: true }));
                              store.raiseException({
                                title: `${l.kind} ${l.ref}: ${note(l).toLowerCase()} (register ${n(l.bookKg)} kg, counted ${n(l.countedKg)} kg)`,
                                kind: "Sub-products",
                                ref: l.ref,
                                dept: "Warehouse",
                                bags: Math.round(Math.abs(l.bookKg - l.countedKg) / 60),
                                source: "Reconciliation",
                              });
                            }}
                          >
                            <UserRound size={14} aria-hidden /> {raised[`${l.kind}|${l.ref}`] ? "Raised" : "Raise"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="readonly ok">Every lot counted matches the registers.</p>
          )}
        </>
      )}
      <p className="muted small">
        On the bridge as "Sub-products (off system)" in both columns, from the registers (Proposed by the Hub). Bulked franchise (KIB lots) is included, as on the
        September sheet; Finance listed it apart in August, to confirm.
      </p>
    </section>
  );
}
