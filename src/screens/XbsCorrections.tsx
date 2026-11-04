import { Download } from "lucide-react";
import { exportReport } from "../data/excel";
import { contractStates } from "../data/part-lots";
import { SITES, allLines, site } from "../data/repository";
import { useStore } from "../data/store";
import { CORRECTION_ACTIONS, xbsCorrections } from "../data/xbs-corrections";
import { Code, n } from "../ui/kit";

/**
 * Reconciliation: the changes XBS needs after this count, as one batch for the XBS owner (L5).
 * Downloaded as Excel and sent; what XBS gets right (timing items, count errors) isn't on it.
 */
export default function XbsCorrections() {
  const store = useStore();
  const tracker = store.shipments?.lines;
  const cutOff = store.kpiCountDate;
  const contracts = tracker?.length && cutOff ? contractStates(tracker, cutOff, store.xbsStuffing?.rows) : undefined;
  const ibero = SITES.find((s) => !s.thirdParty)?.code ?? "IBR";
  const { rows, held, typed } = xbsCorrections({
    variances: store.variances,
    lines: allLines(),
    thirdParty: new Set(SITES.filter((s) => s.thirdParty).map((s) => s.code)),
    ibero,
    contracts,
  });
  const stockTake = store.stockTakes.find((s) => s.status !== "Completed")?.title ?? store.stockTakes[0]?.title ?? "Stock take";
  const counts = CORRECTION_ACTIONS.map((a) => ({ a, k: rows.filter((r) => r.action === a).length })).filter((x) => x.k);

  const download = () =>
    exportReport("XBS correction batch", stockTake, {
      note: "Changes XBS needs after the count, for the XBS owner. 60 kg bags: positive = XBS holds more than is there. Timing items (deliveries after the count) and count errors are not on it.",
      tables: [
        {
          title: "Corrections",
          columns: [
            { key: "no", label: "No.", kind: "int" },
            { key: "action", label: "Action" },
            { key: "site", label: "Warehouse" },
            { key: "where", label: "Location" },
            { key: "outturn", label: "Outturn" },
            { key: "grade", label: "Grade" },
            { key: "batch", label: "Batch" },
            { key: "contract", label: "Sales contract" },
            { key: "bags", label: "Bags (60 kg)", kind: "num1" },
            { key: "why", label: "Why" },
            { key: "done", label: "Done in XBS (date, reference)" },
          ],
          rows: rows.map((r, i) => ({ no: i + 1, ...r, site: site(r.site)?.name ?? r.site })),
        },
      ],
    }).then(
      () => store.flash("XBS correction batch downloaded as Excel."),
      (e) => store.flash(`Couldn't create the Excel file: ${e instanceof Error ? e.message : String(e)}`),
    );

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">XBS correction batch</h2>
        <button className="btn btn-sm" disabled={!rows.length} onClick={download}>
          <Download size={16} aria-hidden /> Download for the XBS owner
        </button>
      </div>
      <p className="muted small">
        What XBS has wrong after this count, so it isn't found again next month: lots to write off, residues to adjust, lots counted that XBS doesn't have, Ibero
        transfers not posted, and lots still blocked to a contract that has been stuffed, shipped or cancelled
        {contracts ? "" : " (load the shipment tracker for the contract rows)"}. Deliveries after the count and count errors are left out: XBS is right about those.
      </p>
      {(held > 0 || typed > 0) && (
        <p className="muted small">
          {held > 0 && `${n(held)} lot${held === 1 ? "" : "s"} held back until the recount is done. `}
          {typed > 0 && `${n(typed)} lot${typed === 1 ? "" : "s"} counted but not in XBS left out: one letter from an outturn XBS has there, so most likely a typing error.`}
        </p>
      )}
      {rows.length ? (
        <>
          <p className="small">{counts.map((c) => `${c.a} ${c.k}`).join(" · ")}</p>
          <div className="table-wrap">
            <table className="table table-tight">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Lot</th>
                  <th>Where</th>
                  <th className="num">Bags</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r, i) => (
                  <tr key={i}>
                    <td>{r.action}</td>
                    <td>
                      <Code>{r.outturn}</Code> <span className="muted small">{r.grade}</span>
                      {r.contract && <div className="muted small">Contract {r.contract}</div>}
                    </td>
                    <td>
                      {site(r.site)?.short ?? r.site}
                      {r.where ? <div className="muted small">{r.where}</div> : null}
                    </td>
                    <td className="num">{n(r.bags, 2)}</td>
                    <td className="muted small">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 40 && <p className="muted small">Showing 40 of {n(rows.length)}; the download has them all.</p>}
        </>
      ) : (
        <p className="readonly">Nothing for XBS to correct from this count yet.</p>
      )}
    </section>
  );
}
