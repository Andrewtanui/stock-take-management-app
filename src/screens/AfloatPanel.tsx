import { useState } from "react";
import { AFLOAT_DEFAULT, AFLOAT_EXCLUDED, AFLOAT_GROUPS, AGEING_DEFAULT, NOT_IN_537_DAYS, afloatAgeing, afloatBags, afloatShipments, type AfloatGroup } from "../data/afloat";
import { can } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, n, type Tone } from "../ui/kit";

const bags = (x: number) => n(Math.round(x));
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "-");
const month = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const SHOW = 15;
const TONE: Record<AfloatGroup, Tone> = { "Not sailed": "warn", "Sailed, not invoiced": "info", "Not in the 537": "neutral", "Invoiced by the count": "ok" };
const ABOUT: Record<AfloatGroup, string> = {
  "Not in the 537": `No sales invoice on the contract anywhere in the 537 and stuffed over ${NOT_IN_537_DAYS} days before the count: invoiced before the export reaches (it holds open contracts). Tick only if one is really afloat.`,
  "Not sailed": "Stuffed by the count, sailed after it (or no sailing date), bags not invoiced by the count: still in Kenya.",
  "Sailed, not invoiced": "Sailed by the count, bags not invoiced by the count: on the water.",
  "Invoiced by the count": "Sales-invoiced in the 537 by the count date: sold, out of BRIC as well. Never afloat.",
};
const LABEL = "Afloat from the shipment tracker";

/**
 * Coffee afloat worked out from the shipment tracker and the 537: shipments stuffed before the count
 * and not invoiced by then. Finance chooses which groups count; the result can go on the bridge.
 */
export default function AfloatPanel() {
  const store = useStore();
  const allowed = can(store.role, "Reconciling items");
  const [months, setMonths] = useState(2);
  const [groups, setGroups] = useState<AfloatGroup[]>(AFLOAT_DEFAULT);
  const [all, setAll] = useState(false);
  const cutOff = store.kpiCountDate;
  const shipments = store.shipments;
  const journal = store.contractJournal;

  if (!shipments || !journal || !cutOff)
    return (
      <section className="panel">
        <h2 className="h3">Afloat from shipments</h2>
        <p className="muted">
          Load the shipment tracker and the 537 contract journal for this stock take on the XBS import page; coffee afloat is then worked out here shipment by
          shipment.
        </p>
      </section>
    );

  const xbs = store.xbsStuffing?.rows ?? [];
  const r = afloatShipments(shipments.lines, journal.lines, cutOff, months, xbs);
  const ageing = afloatAgeing(r.rows, cutOff, groups, store.afloatAgeingDays ?? AGEING_DEFAULT);
  const fromXbs = r.rows.filter((x) => x.dateFrom === "XBS").length;
  const total = afloatBags(r.totals, groups);
  const onBridge = store.reconItems.filter((i) => i.kind === "Coffee afloat");
  const finance = onBridge.filter((i) => i.label !== LABEL).reduce((s, i) => s + i.bags, 0);
  const ours = onBridge.find((i) => i.label === LABEL);
  const journalFrom = journal.lines.map((l) => l.voucherDate).filter(Boolean).sort()[0];
  const before537 = !!journalFrom && r.since < journalFrom;
  const counted = r.rows.filter((x) => groups.includes(x.group));
  const rows = all ? r.rows : r.rows.slice(0, SHOW);
  const toggle = (g: AfloatGroup) => setGroups((xs) => (xs.includes(g) ? xs.filter((x) => x !== g) : [...xs, g]));
  const rule = `Stuffed ${day(r.since)} to ${day(cutOff)}, less bags sales-invoiced in the 537 by ${day(cutOff)}; counted: ${groups.join(", ").toLowerCase() || "nothing"}.`;

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Afloat from shipments</h2>
        <span className="muted small">
          {shipments.file} with the 537 ({journal.file}) · count date {day(cutOff)}
        </span>
      </div>
      <p className="muted small">
        Coffee stuffed by the count date but not invoiced to the buyer by then: out of the warehouse and XBS, still in BRIC. Finance's rule: bags stuffed in
        the look-back less the bags sales-invoiced on the contract by the count date (a contract invoiced in part counts the rest); cancelled shipments are
        left out.{" "}
        {xbs.length
          ? `Stuffing dates from XBS's shipped report for ${n(fromXbs)} of ${n(r.rows.length)} shipments (${r.xbsMonths.map(month).join(", ")} loaded), the tracker's for the rest.`
          : "Stuffing dates are the tracker's: load XBS's shipped report on the XBS import page to use the warehouse's own dates."}
      </p>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Afloat, worked out</div>
          <div className="stat-value">{bags(total)}</div>
          <div className="stat-note">
            {n(counted.length)} shipments · bags not invoiced by the count
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Finance's afloat</div>
          <div className="stat-value">{finance ? bags(finance) : "-"}</div>
          <div className="stat-note">{finance ? `on the bridge · ${bags(total - finance)} apart (${n(Math.round(((total - finance) / finance) * 1000) / 10, 1)}%)` : "Not on the bridge yet"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Looking back</div>
          <div className="stat-value">
            <span className="seg" role="group" aria-label="Months stuffed before the count">
              {[0, 1, 2].map((m) => (
                <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>
                  {m + 1} mo
                </button>
              ))}
            </span>
          </div>
          <div className="stat-note">
            Stuffed from {day(r.since)} ({month(r.since)}
            {months ? ` to ${month(cutOff)}` : ""})
          </div>
        </div>
      </div>
      {before537 && (
        <p className="readonly">
          The 537 starts on {day(journalFrom)}, after {day(r.since)}: shipments invoiced before it show as not invoiced.
          Look back less, or load a 537 that starts earlier.
        </p>
      )}

      <ul className="check-list">
        {AFLOAT_GROUPS.map((g) => (
          <li key={g}>
            <label className="check-row">
              <input type="checkbox" checked={groups.includes(g)} disabled={g === "Invoiced by the count"} onChange={() => toggle(g)} />
              <span className="check-text">
                <strong>
                  {g} · {bags(r.totals[g].bags)} bags
                </strong>
                <span className="muted small">
                  {n(r.totals[g].shipments)} shipments. {ABOUT[g]}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {r.checks.length > 0 && (
        <div className="readonly">
          <strong>Stuffing dates to fix in the tracker</strong>
          <ul className="plain">
            {r.checks.map((c) => (
              <li key={`${c.line.row}-${c.issue}`}>
                {c.line.salesContract} (SI {c.line.si || "-"}, {bags(c.line.bags)} bags):{" "}
                {c.issue === "Different date"
                  ? `tracker ${day(c.tracker)}, XBS ${day(c.xbs)} - XBS's date is used.`
                  : `tracker ${day(c.tracker)}, but XBS's report for ${month(c.tracker!)} doesn't list it - left out until the tracker is corrected.`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {total > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Days since stuffing, at the count</th>
                <th className="num">Shipments</th>
                <th className="num">Bags afloat</th>
              </tr>
            </thead>
            <tbody>
              {ageing.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="num">{n(b.shipments)}</td>
                  <td className="num">{bags(b.bags)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Ageing limits are the setting AfloatAgeingDays ({(store.afloatAgeingDays ?? AGEING_DEFAULT).join(", ")} days) until Trade and Logistics agree them (D6).</p>
        </div>
      )}
      {r.excluded.length > 0 && (
        <p className="readonly">
          Left out until Finance confirms:{" "}
          {r.excluded.map((l, i) => (
            <span key={l.row}>
              {i ? "; " : ""}
              {l.salesContract} ({bags(l.bags)} bags): {AFLOAT_EXCLUDED[l.salesContract]}
            </span>
          ))}
        </p>
      )}

      {allowed && (
        <div className="btn-row">
          {ours ? (
            <span className="muted small">
              On the bridge: {bags(ours.bags)} bags ({ours.note ?? LABEL}). Remove it on the bridge above to replace it.
            </span>
          ) : (
            <button
              className="btn"
              disabled={!total}
              onClick={() => store.addReconItem({ label: LABEL, kind: "Coffee afloat", bags: Math.round(total * 100) / 100, inXbs: true, note: rule })}
            >
              Put {bags(total)} on the bridge as afloat
            </button>
          )}
          {!!finance && !ours && <span className="muted small">Finance's own afloat stays on the bridge too; remove one of them so it isn't counted twice.</span>}
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Sales contract</th>
              <th>SI</th>
              <th>Buyer</th>
              <th>Quality</th>
              <th className="num">Bags</th>
              <th className="num">Not invoiced</th>
              <th>Stuffed</th>
              <th>Sailed</th>
              <th>First invoice</th>
              <th>Group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.line.row} className={groups.includes(x.group) ? undefined : "muted"}>
                <td>{x.line.salesContract}</td>
                <td>{x.line.si || "-"}</td>
                <td>{x.line.buyer}</td>
                <td>
                  {x.line.quality}
                  <div className="muted small">{x.line.packaging}</div>
                </td>
                <td className="num">{bags(x.line.bags)}</td>
                <td className="num">{bags(x.afloat)}</td>
                <td>
                  {day(x.line.stuffedOn)}
                  {x.dateFrom === "XBS" && x.trackerStuffedOn !== x.line.stuffedOn && <div className="muted small">tracker {day(x.trackerStuffedOn)}</div>}
                </td>
                <td>{day(x.line.sailedOn)}</td>
                <td>{day(x.firstInvoice)}</td>
                <td>
                  <Chip tone={TONE[x.group]}>{x.group}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.rows.length > SHOW && (
        <button className="link" onClick={() => setAll((x) => !x)}>
          {all ? `Show the ${SHOW} largest` : `Show all ${r.rows.length} shipments`}
        </button>
      )}
    </section>
  );
}
