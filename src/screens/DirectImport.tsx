import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Upload } from "lucide-react";
import { directTotals, readDirect, type DirectLot, type DirectUpload } from "../data/direct-parse";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

/**
 * Trading's direct purchase list for the active stock take: one row per outturn and grade bought
 * on a direct contract, with baskets, warrant and weight received. Loaded once, never changed.
 */
export default function DirectImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<DirectUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const loaded = store.directLots;
  // A load that stopped part way: the same file chosen again has more rows than were saved.
  const partial = !!loaded && !!upload && upload.file === loaded.file && upload.lots.length > loaded.lots.length;
  const lots = partial ? upload!.lots : (loaded?.lots ?? upload?.lots ?? []);
  const cutOff = store.kpiCountDate;
  const t = directTotals(lots, cutOff);

  // Bought by the count date but with no XBS line: received and not yet uploaded (provisional stock).
  const inXbs = new Set(allLines().map((l) => l.o.toUpperCase()));
  const when = (l: DirectLot) => l.receivedOn ?? l.contractDate ?? "";
  const byCount = lots.filter((l) => !cutOff || when(l) <= cutOff);
  const notInXbs = byCount.filter((l) => !inXbs.has(l.outturn));
  const outturnsNotInXbs = [...new Set(notInXbs.map((l) => l.outturn))];

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readDirect(list[0]));
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const checks = [
    { ok: !!st, label: "A stock take to reconcile", detail: st ? `Loaded for ${st.title}.` : "Start the stock take first; the lots are loaded for it.", block: !st },
    {
      ok: !cutOff || byCount.length > 0,
      label: "Covers the count date",
      detail:
        !cutOff || byCount.length
          ? `${n(byCount.length)} of ${n(t.lots)} lots were received or contracted by ${cutOff ?? "the count"}.`
          : `None of these lots was received or contracted by ${cutOff}: this looks like a later season's list. Load the file that covers the count month.`,
    },
    {
      ok: t.noContract === 0,
      label: "Every lot has a contract",
      detail: t.noContract ? `${n(t.noContract)} lots name no direct contract (905xx).` : `${n(t.contracts)} contracts, ${n(t.outturns)} outturns.`,
    },
    {
      ok: t.withWarehouse === t.lots,
      label: "Warehouse given",
      detail:
        t.withWarehouse === t.lots
          ? "Every lot says where it is stored."
          : `${n(t.lots - t.withWarehouse)} of ${n(t.lots)} lots don't say where they are stored. Ask Trading to add a Warehouse column.`,
    },
    {
      ok: t.withReceivedDate === t.lots,
      label: "Date received given",
      detail:
        t.withReceivedDate === t.lots
          ? "Every lot has the date it arrived."
          : `${n(t.lots - t.withReceivedDate)} of ${n(t.lots)} lots have no date received; the contract date is used instead.`,
    },
    {
      ok: true,
      label: cutOff ? `Bought by ${cutOff}, not in XBS` : "Not in XBS",
      detail: outturnsNotInXbs.length
        ? `${n(outturnsNotInXbs.length)} outturns (${n(notInXbs.length)} lots) have no XBS line: received but not yet uploaded, or not yet delivered. ${outturnsNotInXbs.slice(0, 8).join(", ")}${outturnsNotInXbs.length > 8 ? "…" : ""}`
        : `Every outturn bought by the count date is in XBS.`,
    },
  ];

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Direct purchases (Trading)</h2>
        {loaded ? <Chip tone="ok">Loaded</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        Trading's list of direct purchases: each outturn and grade bought on a 905xx contract, with its baskets, warrant and the weight received. It
        explains coffee counted in the warehouse but not yet in XBS. Loaded once per stock take and never changed.
      </p>

      {loaded ? (
        <p className="readonly ok">
          <CircleCheck size={16} aria-hidden /> {loaded.file} · {n(loaded.lots.length)} lots · loaded {loaded.at}
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
              Trading's <strong>direct purchase</strong> workbook (e.g. "Direct Overview Season 2026-2027.xlsx"): the running list, or the older file with
              one sheet per contract.
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

      {lots.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Lots</div>
              <div className="stat-value">{n(t.lots)}</div>
              <div className="stat-note">
                {n(t.outturns)} outturns · {n(t.contracts)} contracts
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Bought by the count</div>
              <div className="stat-value">{n(byCount.length)}</div>
              <div className="stat-note">{cutOff ? `lots received or contracted by ${cutOff}` : "lots"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Not in XBS</div>
              <div className="stat-value">{n(outturnsNotInXbs.length)}</div>
              <div className="stat-note">outturns bought by the count with no XBS line</div>
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
            await store.importDirectLots(upload, (done, total) => setProgress({ done, total }));
            setProgress(null);
          }}
        >
          {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)} lots` : partial ? `Load the rest (${n(upload.lots.length - loaded!.lots.length)} lots not saved)` : "Load the direct purchase lots"}
        </button>
      )}
    </section>
  );
}
