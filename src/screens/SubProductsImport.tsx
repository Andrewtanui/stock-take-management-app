import { useRef, useState } from "react";
import { CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { SUBPRODUCT_KINDS, readSubProducts, subProductBook, type SubProductRegister, type SubProductUpload } from "../data/subproducts-parse";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

const REGISTERS: SubProductRegister[] = ["Sub-products report", "Franchise inventory"];

/**
 * The warehouse's sub-product registers: the sub-products report (ex-office and clean sweepings) and the
 * franchise inventory (gains per KDI, bulked KIB lots). The book side of Ibero's off-system stock, one
 * copy of each per stock take, never changed.
 */
export default function SubProductsImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<SubProductUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTake;
  const loaded = store.subProducts;
  const cutOff = store.kpiCountDate;
  const book = loaded && cutOff ? subProductBook(loaded.rows, cutOff) : undefined;
  const taken = upload && loaded?.files[upload.register];

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readSubProducts(list[0]));
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
        <h2 className="h3">Sub-product registers</h2>
        {loaded ? (
          <Chip tone={REGISTERS.every((r) => loaded.files[r]) ? "ok" : "warn"}>
            {REGISTERS.filter((r) => loaded.files[r]).length} of 2 loaded
          </Chip>
        ) : (
          <Chip tone="neutral">Not loaded</Chip>
        )}
      </div>
      <p className="muted small">
        The warehouse's own records of stock that isn't in XBS: the <strong>sub-products report</strong> (ex-office sweepings Type 1-3 and clean sweepings) and
        the <strong>franchise inventory</strong> (franchise gains per KDI, bulked KIB lots). Load both as they stand at the count; each is kept as loaded, so
        next month's edits don't change this one.
      </p>

      {loaded && (
        <>
          {REGISTERS.filter((r) => loaded.files[r]).map((r) => (
            <p key={r} className="readonly ok">
              <CircleCheck size={16} aria-hidden /> {r} · {n(loaded.rows.filter((x) => (r === "Franchise inventory") === x.kind.startsWith("Franchise")).length)} rows · {loaded.files[r]}
            </p>
          ))}
          {book && (
            <p className="small">
              Book at the count ({cutOff}):{" "}
              {SUBPRODUCT_KINDS.filter((k) => book[k].rows)
                .map((k) => `${k} ${n(book[k].bags, 2)}`)
                .join(" · ")}{" "}
              · <strong>total {n(SUBPRODUCT_KINDS.reduce((a, k) => a + book[k].bags, 0), 2)} bags</strong>
            </p>
          )}
        </>
      )}
      {allowed && (
        <div className="drop">
          <Upload size={28} aria-hidden />
          <p>
            The <strong>sub-products report</strong> or the <strong>franchise inventory</strong>, as the warehouse keeps it (Excel).
          </p>
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
          <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
            {reading ? "Reading…" : "Choose the file"}
          </button>
        </div>
      )}
      {error && <p className="readonly">{error}</p>}
      {upload && (
        <>
          <ul className="file-list">
            <li>
              <FileSpreadsheet size={18} aria-hidden /> {upload.file} · {upload.register} (sheet {upload.sheets.join(", ")}) ·{" "}
              {SUBPRODUCT_KINDS.map((k) => ({ k, rs: upload.rows.filter((r) => r.kind === k) }))
                .filter((x) => x.rs.length)
                .map((x) => `${x.k} ${x.rs.length} rows, ${n(x.rs.reduce((a, r) => a + r.kg, 0) / 60, 2)} bags`)
                .join(" · ")}
            </li>
          </ul>
          {taken && taken !== upload.file ? (
            <p className="readonly">The {upload.register.toLowerCase()} is already loaded for this stock take ({taken}); it is kept as it was.</p>
          ) : (
            allowed && (
              <button
                className="btn btn-primary"
                disabled={!st || store.setup || !!progress}
                onClick={async () => {
                  if (await store.importSubProducts(upload, (done, total) => setProgress({ done, total }))) setUpload(null);
                  setProgress(null);
                }}
              >
                {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)}` : `Load the ${upload.register.toLowerCase()} (${n(upload.rows.length)} rows)`}
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
