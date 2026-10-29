import { useState } from "react";
import { bricByContract } from "../data/bric-contracts";
import { can } from "../data/repository";
import { useStore } from "../data/store";
import { n } from "../ui/kit";

const bags = (x: number) => n(Math.round(x * 10) / 10, 1);
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "-");
const SHOW = 15;

/**
 * Level 2 by contract: BRIC's Kenya stock (P526, per purchase contract) with what the Comtras 537
 * journal says about each contract, and the journal lines that belong to the counted month but were
 * booked after it. Under Finance's BRIC bridge on the Reconciliation page.
 */
export default function BricContracts() {
  const store = useStore();
  const [all, setAll] = useState(false);
  const allowed = can(store.role, "Reconciling items");
  const cutOff = store.kpiCountDate;
  const journal = store.contractJournal;
  const comtras = store.comtras;

  if (!comtras || !journal || !cutOff)
    return (
      <section className="panel">
        <h2 className="h3">BRIC by contract</h2>
        <p className="muted">
          Load the Comtras P526 and the 537 contract journal for this stock take on the XBS import page; BRIC's stock is then explained here contract by contract.
        </p>
      </section>
    );

  const r = bricByContract(comtras.lines, journal.lines, cutOff);
  const afloat = store.reconItems.filter((i) => i.kind === "Coffee afloat").reduce((s, i) => s + i.bags, 0);
  const rows = all ? r.contracts : r.contracts.slice(0, SHOW);
  const added = new Set(store.reconItems.map((i) => i.label));
  const timingLabel = (t: (typeof r.timing)[number]) => `537 timing: ${t.kind.toLowerCase()} ${t.line.counterparty} ${t.contract}`.slice(0, 200);

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">BRIC by contract</h2>
        <span className="muted small">
          60 kg bags · P526 with the 537 ({journal.file}) · count date {day(cutOff)}
        </span>
      </div>
      <p className="muted small">
        BRIC holds Kenya's stock per purchase contract. The 537 says who it was bought from and how much of it was invoiced to a buyer before and after the count.
        Stock invoiced onward after the count was either afloat at the count or shipped from a warehouse since: a check on the afloat figure, not a calculation of it.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">BRIC Kenya stock</div>
          <div className="stat-value">{bags(r.totals.bric)}</div>
          <div className="stat-note">
            {r.contracts.length} contracts · {n(Math.round((r.totals.linked / (r.totals.bric || 1)) * 100))}% of the bags in the 537
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Invoiced onward after the count</div>
          <div className="stat-value">{bags(r.totals.invoicedAfter)}</div>
          <div className="stat-note">
            {afloat ? `Afloat on the bridge ${bags(afloat)} · ${bags(r.totals.invoicedAfter - afloat)} apart` : "No afloat on the bridge yet"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Not invoiced onward</div>
          <div className="stat-value">{bags(r.totals.rest)}</div>
          <div className="stat-note">Expected in the warehouses or in the other bridge items</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Quality</th>
              <th>Bought from</th>
              <th className="num">BRIC</th>
              <th className="num">Bought (537)</th>
              <th className="num">Sold by the count</th>
              <th className="num">Sold after</th>
              <th className="num">Of BRIC, invoiced after</th>
              <th>Buyers after</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.contract}|${c.lineType}`}>
                <td>
                  {c.contract}
                  {c.lineType === "Longs" && <span className="muted small"> · longs</span>}
                </td>
                <td>{c.quality}</td>
                <td>{c.counterparty}</td>
                <td className="num">{bags(c.bric)}</td>
                <td className="num">
                  {c.inJournal ? bags(c.bought) : <span className="muted">not in the 537</span>}
                  {c.boughtFirst && <div className="muted small">from {day(c.boughtFirst)}</div>}
                </td>
                <td className="num">{bags(c.soldBy)}</td>
                <td className="num">
                  {bags(c.soldAfter)}
                  {c.firstSaleAfter && <div className="muted small">from {day(c.firstSaleAfter)}</div>}
                </td>
                <td className="num">
                  <strong>{bags(c.invoicedAfter)}</strong>
                </td>
                <td className="muted small">{c.buyers.slice(0, 3).join(", ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.contracts.length > SHOW && (
        <button className="link" onClick={() => setAll((x) => !x)}>
          {all ? `Show the ${SHOW} largest` : `Show all ${r.contracts.length} contracts`}
        </button>
      )}

      <h3 className="h3">Dated in the counted month, booked after it</h3>
      {!r.timing.length ? (
        <p className="muted small">No 537 line is dated on or before the count date and booked after it.</p>
      ) : (
        <>
          <p className="muted small">
            Invoices and credit notes that belong to the counted month but reached Comtras later: possible posting-timing items for the bridge. Bags are signed as in
            the 537 (credit notes negative); check the direction before adding one.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Counterparty</th>
                  <th>Contract</th>
                  <th>Dated</th>
                  <th>Booked</th>
                  <th className="num">Bags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.timing.map((t) => (
                  <tr key={t.line.row}>
                    <td>
                      {t.kind}
                      <div className="muted small">voucher {t.line.voucher || "-"}</div>
                    </td>
                    <td>{t.line.counterparty}</td>
                    <td>{t.contract}</td>
                    <td>{day(t.line.voucherDate)}</td>
                    <td>{day(t.line.bookedOn)}</td>
                    <td className="num">{bags(t.bags)}</td>
                    <td>
                      {allowed &&
                        (added.has(timingLabel(t)) ? (
                          <span className="muted small">On the bridge</span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              store.addReconItem({
                                label: timingLabel(t),
                                kind: "Reconciling item",
                                bags: t.bags,
                                inXbs: false,
                                note: `From the 537: ${t.kind.toLowerCase()} dated ${t.line.voucherDate}, booked ${t.line.bookedOn}, voucher ${t.line.voucher}.`,
                              })
                            }
                          >
                            Add to the bridge
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
