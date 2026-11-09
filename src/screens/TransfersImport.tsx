import { useRef, useState } from "react";
import { CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { readTransferFile, type TransferUpload } from "../data/transfers-parse";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }) : "time unknown";
const WHAT = { transfers: "Stock Transfer Instruction Summary", tickets: "Ticket Summary" } as const;

/**
 * XBS's stock transfer and weighbridge (ticket) reports: the evidence Level 1 quotes on a weight-loss
 * exception - what was sent, what was posted as received, what the truck weighed. Each report is
 * kept; Level 1 reads the latest of each.
 */
export default function TransfersImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<TransferUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTake;
  const loaded = store.transferReports ?? [];
  const latest = (kind: "transfers" | "tickets") => loaded.filter((r) => r.kind === kind).sort((a, b) => (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""))[0];
  const already = upload && loaded.some((r) => r.kind === upload.kind && r.reportedAt === upload.reportedAt && r.file === upload.file);
  const rows = upload ? (upload.kind === "transfers" ? upload.transfers.length : upload.tickets.length) : 0;

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readTransferFile(list[0]));
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
        <h2 className="h3">XBS stock transfers and weighbridge</h2>
        {loaded.length ? <Chip tone="ok">{latest("transfers") && latest("tickets") ? "Both loaded" : "1 of 2 loaded"}</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        XBS's <strong>Stock Transfer Instruction Summary</strong> and <strong>Ticket Summary</strong> for the month. Level 1 uses them as evidence on weight-loss
        exceptions: what was sent, what was posted as received, and what the truck weighed. A comment is added only when the numbers prove the cause. Each
        report is kept as loaded; the latest of each is used.
      </p>

      {(["transfers", "tickets"] as const).map((k) => {
        const r = latest(k);
        return r ? (
          <p key={k} className="readonly ok">
            <CircleCheck size={16} aria-hidden /> {WHAT[k]}: {n(r.rows)} {k === "transfers" ? "transfer lines" : "tickets"} · report of {when(r.reportedAt)} · {r.file}
          </p>
        ) : null;
      })}
      {allowed && (
        <div className="drop">
          <Upload size={28} aria-hidden />
          <p>
            One of the two <strong>XBS reports</strong> as exported (Excel). Load each one.
          </p>
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
          <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
            {reading ? "Reading…" : "Choose a report"}
          </button>
        </div>
      )}
      {error && <p className="readonly">{error}</p>}
      {upload && (
        <>
          <ul className="file-list">
            <li>
              <FileSpreadsheet size={18} aria-hidden /> {upload.file} · {WHAT[upload.kind]} of {when(upload.reportedAt)} · {n(rows)} {upload.kind === "transfers" ? "transfer lines" : "tickets"}
              {upload.kind === "transfers" &&
                ` (${n(upload.transfers.filter((t) => t.receivedKg > 0).length)} received, ${n(upload.transfers.filter((t) => t.ticket).length)} with a weighbridge ticket)`}
            </li>
          </ul>
          {already ? (
            <p className="readonly">This report is already loaded for this stock take.</p>
          ) : (
            allowed && (
              <button
                className="btn btn-primary"
                disabled={!st || store.setup || !!progress}
                onClick={async () => {
                  if (await store.importTransfers(upload, (done, total) => setProgress({ done, total }))) setUpload(null);
                  setProgress(null);
                }}
              >
                {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)}` : `Load ${n(rows)} ${upload.kind === "transfers" ? "transfer lines" : "tickets"}`}
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
