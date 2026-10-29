import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Upload } from "lucide-react";
import { readTracker, shipmentTotals, type ShipmentUpload } from "../data/shipments-parse";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

/**
 * Trade / Logistics' shipment tracker for the active stock take: one row per sales contract and
 * shipping instruction, with stuffing and sailing dates. Loaded once, never changed.
 */
export default function ShipmentsImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<ShipmentUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const loaded = store.shipments;
  // A load that stopped part way: the same file chosen again has more rows than were saved.
  const partial = !!loaded && !!upload && upload.file === loaded.file && upload.lines.length > loaded.lines.length;
  const lines = partial ? upload!.lines : (loaded?.lines ?? upload?.lines ?? []);
  const cutOff = store.kpiCountDate;
  const t = shipmentTotals(lines, cutOff);

  // How the tracker links to the 537 and to XBS: the same sales contract numbers.
  const shipped = new Set(lines.map((l) => l.salesContract));
  const invoiced = new Set((store.contractJournal?.lines ?? []).map((l) => l.salesContract).filter(Boolean));
  const recent = lines.filter((l) => l.stuffedOn && l.stuffedOn >= t.since && (!cutOff || l.stuffedOn <= cutOff));
  const recentInvoiced = recent.filter((l) => invoiced.has(l.salesContract)).length;
  const blockedContracts = new Set(allLines().filter((l) => l.so).map((l) => l.so!));
  const blockedShipped = [...blockedContracts].filter((c) => shipped.has(c));

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readTracker(list[0]));
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const covers = !cutOff || (t.to ?? "") >= cutOff;
  const checks = [
    { ok: !!st, label: "A stock take to reconcile", detail: st ? `Loaded for ${st.title}.` : "Start the stock take first; the tracker is loaded for it.", block: !st },
    {
      ok: covers,
      label: "Covers the count date",
      detail: covers
        ? `Stuffing dates ${t.from ?? "-"} to ${t.to ?? "-"}${cutOff ? `, past the count date ${cutOff}` : ""}.`
        : `The last stuffing date is ${t.to}, before the count date ${cutOff}. Ask Trade for the tracker updated after the count.`,
    },
    {
      ok: t.noStuffingDate === 0,
      label: "Stuffing dates filled",
      detail: t.noStuffingDate ? `${n(t.noStuffingDate)} of ${n(t.shipments)} shipments have no actual stuffing date (not stuffed yet, or not keyed).` : "Every shipment has an actual stuffing date.",
    },
    {
      ok: !store.contractJournal || !recent.length || recentInvoiced > 0,
      label: "Sales contracts link to the 537",
      detail: !store.contractJournal
        ? "Load the 537 contract journal to link shipments to invoices."
        : `${n(recentInvoiced)} of the ${n(recent.length)} shipments stuffed since ${t.since || "-"} have invoice lines in the 537.`,
    },
    {
      ok: true,
      label: "Sales contracts link to XBS",
      detail: blockedContracts.size
        ? `${n(blockedShipped.length)} of the ${n(blockedContracts.size)} sales contracts XBS lots are blocked to are in the tracker.`
        : "No XBS lot is blocked to a sales contract in this snapshot.",
    },
  ];

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Shipment tracker</h2>
        {loaded ? <Chip tone="ok">Loaded</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        Trade and Logistics' tracker: one row per sales contract and shipping instruction, with the actual stuffing and sailing dates. It shows coffee
        that left the warehouse before the count but was not yet invoiced or sailed (afloat). Loaded once per stock take and never changed.
      </p>

      {loaded ? (
        <p className="readonly ok">
          <CircleCheck size={16} aria-hidden /> {loaded.file} · {n(loaded.lines.length)} shipments · loaded {loaded.at}
          {loaded.by ? ` by ${loaded.by}` : ""}
          {allowed && !partial && (
            <>
              {" · "}
              <button className="link" disabled={reading} onClick={() => picker.current?.click()}>
                {reading ? "Reading…" : "Finish a load that stopped"}
              </button>
            </>
          )}
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
        </p>
      ) : (
        allowed && (
          <div className="drop">
            <Upload size={28} aria-hidden />
            <p>
              The <strong>shipment tracker</strong> from Trade as Excel (e.g. "Kenya_Operational_PL.xlsx", sheet KENYA), updated after the count date.
            </p>
            <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
            <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
              {reading ? "Reading…" : "Choose the file"}
            </button>
          </div>
        )
      )}
      {error && <p className="readonly">{error}</p>}
      {!loaded && upload && (
        <ul className="file-list">
          <li>
            <FileSpreadsheet size={18} aria-hidden /> {upload.file}
          </li>
        </ul>
      )}

      {lines.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Shipments</div>
              <div className="stat-value">{n(t.shipments)}</div>
              <div className="stat-note">
                {n(t.salesContracts)} sales contracts · {n(t.open)} open
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Stuffed recently</div>
              <div className="stat-value">{n(Math.round(t.stuffedRecently))}</div>
              <div className="stat-note">{cutOff ? `bags, ${t.since} to ${cutOff}` : "bags"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Stuffed, not sailed</div>
              <div className="stat-value">{n(Math.round(t.stuffedNotSailed))}</div>
              <div className="stat-note">{cutOff ? `bags on ${cutOff}: out of the warehouse, still in Kenya` : "bags"}</div>
            </div>
          </div>
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.label}>
                <div className="check-row">
                  {c.ok ? <CircleCheck className="ic-ok" size={20} aria-label="Passed" /> : c.block ? <CircleX className="ic-crit" size={20} aria-label="Failed" /> : <CircleAlert className="ic-warn" size={20} aria-label="Warning" />}
                  <span className="check-text">
                    <strong>{c.label}</strong>
                    <span className="muted small">{c.detail}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {loaded && upload && !partial && (
        <p className="readonly">
          {upload.file === loaded.file
            ? `Everything in ${upload.file} is already loaded.`
            : `${upload.file} is a different file from the one loaded (${loaded.file}). To finish that load, choose ${loaded.file} again.`}
        </p>
      )}
      {(!loaded || partial) && upload && allowed && (
        <button
          className="btn btn-primary"
          disabled={!st || store.setup || !!progress}
          onClick={async () => {
            await store.importShipments(upload, (done, total) => setProgress({ done, total }));
            setProgress(null);
          }}
        >
          {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)} shipments` : partial ? `Load the rest (${n(upload.lines.length - loaded!.lines.length)} shipments not saved)` : "Load the shipment tracker"}
        </button>
      )}
    </section>
  );
}
