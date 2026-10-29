import { useRef, useState } from "react";
import { CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { readShipped, type XbsStuffingUpload } from "../data/xbs-shipped-parse";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * XBS's "All Party Shipped Quantity Per Contract" report: when each sales contract was really
 * stuffed. Corrects the shipment tracker's dates for afloat. One report per month; each loads once.
 */
export default function XbsStuffingImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<XbsStuffingUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const loaded = store.xbsStuffing;
  const months = [...new Set((loaded?.rows ?? []).map((x) => x.stuffedOn.slice(0, 7)))].sort();
  const have = new Set((loaded?.rows ?? []).map((x) => `${x.salesContract}|${x.si}|${x.stuffedOn}`));
  const fresh = upload ? upload.rows.filter((x) => !have.has(`${x.salesContract}|${x.si}|${x.stuffedOn}`)) : [];
  const upMonths = upload ? [...new Set(upload.rows.map((x) => x.stuffedOn.slice(0, 7)))].sort() : [];

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readShipped(list[0]));
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">XBS stuffing dates</h2>
        {loaded ? <Chip tone="ok">{months.length === 1 ? "1 month" : `${months.length} months`} loaded</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        XBS's shipped report ("All Party Shipped Quantity Per Contract"): when each sales contract was stuffed, as the warehouse booked it. Afloat uses these
        dates where XBS has the shipment, instead of the tracker's. Load one report per month of the look-back; each is loaded once and never changed.
      </p>

      {loaded && (
        <p className="readonly ok">
          <CircleCheck size={16} aria-hidden /> {n(loaded.rows.length)} shipments · stuffed in {months.map(month).join(", ")} · {loaded.files.join(", ")}
        </p>
      )}
      {allowed && (
        <div className="drop">
          <Upload size={28} aria-hidden />
          <p>
            The <strong>XBS shipped report</strong> as exported (CSV) or saved as Excel, for one month's stuffings.
          </p>
          <input ref={picker} type="file" accept=".csv,.xlsx" hidden onChange={(e) => choose(e.target.files)} />
          <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
            {reading ? "Reading…" : loaded ? "Add another month" : "Choose the file"}
          </button>
        </div>
      )}
      {error && <p className="readonly">{error}</p>}
      {upload && (
        <>
          <ul className="file-list">
            <li>
              <FileSpreadsheet size={18} aria-hidden /> {upload.file} · {n(upload.rows.length)} shipments ({n(new Set(upload.rows.map((x) => x.salesContract)).size)} sales
              contracts), {n(Math.round(upload.rows.reduce((s, x) => s + x.bags, 0)))} bags, stuffed in {upMonths.map(month).join(", ")}
            </li>
          </ul>
          {!fresh.length ? (
            <p className="readonly">Everything in {upload.file} is already loaded.</p>
          ) : (
            allowed && (
              <button
                className="btn btn-primary"
                disabled={!st || store.setup || !!progress}
                onClick={async () => {
                  if (await store.importXbsStuffing(upload, (done, total) => setProgress({ done, total }))) setUpload(null);
                  setProgress(null);
                }}
              >
                {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)}` : `Load ${n(fresh.length)} stuffing dates`}
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
