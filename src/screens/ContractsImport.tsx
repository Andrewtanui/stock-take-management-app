import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Upload } from "lucide-react";
import { DOC_TYPES, contractTotals, lookbackStart, newContractLines, read537, type ContractUpload } from "../data/contracts-parse";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

/**
 * The Comtras 537 contract invoicing journal for the active stock take: Kenya's (company CC)
 * invoice and credit-note lines per purchase and sales contract. One file, or one per month: a line
 * already loaded from another file is kept once. Never changed.
 */
export default function ContractsImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<ContractUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTake;
  const loaded = store.contractJournal;
  // A new file: only its lines not already loaded from another file are added.
  const adding = upload ? newContractLines(upload.lines, loaded?.lines ?? []) : undefined;
  const lines = [...(loaded?.lines ?? []), ...(adding?.fresh ?? [])];
  const cutOff = store.kpiCountDate;
  const t = contractTotals(lines, cutOff);
  const r1 = (x: number) => n(Math.round(x * 10) / 10, 1);

  // How the journal links to the warehouse: XBS lots blocked to a sales contract that has invoice lines.
  const invoiced = new Set(lines.map((l) => l.salesContract).filter(Boolean));
  const blocked = allLines().filter((l) => l.so);
  const blockedContracts = new Set(blocked.map((l) => l.so!));
  const linked = [...blockedContracts].filter((c) => invoiced.has(c));
  const types = new Map<string, number>();
  for (const l of lines) types.set(DOC_TYPES[l.docType] ?? `Other (${l.docType})`, (types.get(DOC_TYPES[l.docType] ?? `Other (${l.docType})`) ?? 0) + 1);

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await read537(list[0]));
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const covers = !cutOff || !t.from || (t.from <= cutOff && (t.to ?? "") >= cutOff);
  // Afloat looks back over the month of the count and the two before it: each month needs its invoices.
  const months = new Set(lines.map((l) => l.bookedOn.slice(0, 7)).filter(Boolean));
  const lookback = cutOff
    ? Array.from({ length: 3 }, (_, i) => {
        const d = new Date(`${lookbackStart(cutOff)}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + i);
        return d.toISOString().slice(0, 7);
      })
    : [];
  const missing = lookback.filter((m) => !months.has(m));
  const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const checks = [
    { ok: !!st, label: "A stock take to reconcile", detail: st ? `Loaded for ${st.title}.` : "Start the stock take first; the journal is loaded for it.", block: !st },
    { ok: true, label: "Kenya only (company CC)", detail: `${n(lines.length)} lines: ${[...types].map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}.` },
    {
      ok: covers,
      label: "Covers the count date",
      detail: covers
        ? `Booked ${t.from ?? "-"} to ${t.to ?? "-"}${cutOff ? `, around the count date ${cutOff}` : ""}.`
        : `Booked ${t.from} to ${t.to}, which doesn't include the count date ${cutOff}. Export the journal for the month of the count and the month after.`,
    },
    {
      ok: !missing.length,
      label: "Covers the afloat look-back",
      detail: !lookback.length
        ? "No count date yet."
        : missing.length
          ? `No invoice lines booked in ${missing.map(month).join(", ")}. Afloat checks whether shipments stuffed from ${month(lookback[0])} were invoiced by the count date: add that month's 537.`
          : `Invoice lines in each of ${lookback.map(month).join(", ")}.`,
    },
    {
      ok: !blockedContracts.size || linked.length > 0,
      label: "Sales contracts link to XBS",
      detail: blockedContracts.size
        ? `${linked.length} of the ${blockedContracts.size} sales contracts XBS lots are blocked to have invoice lines here${linked.length ? ` (${linked.slice(0, 6).join(", ")}${linked.length > 6 ? "…" : ""})` : ""}.`
        : "No XBS lot is blocked to a sales contract in this snapshot.",
    },
  ];

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Comtras contract journal (537)</h2>
        {loaded ? <Chip tone="ok">Loaded</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        Kenya's invoice and credit-note lines per purchase and sales contract, from Comtras. Sales contracts are the numbers XBS lots are blocked to,
        so the reconciliation can see coffee sold and invoiced but still in the warehouse at the count. Load one file covering the look-back, or one per
        month: a line already loaded from another file is kept once. Never changed.
      </p>

      {loaded?.files.map((f) => (
        <p key={f.file} className="readonly ok">
          <CircleCheck size={16} aria-hidden /> {f.file} · {n(f.lines)} lines{f.from ? `, booked ${f.from} to ${f.to}` : ""} · loaded {f.at}
          {f.by ? ` by ${f.by}` : ""}
        </p>
      ))}
      {allowed && (
        <div className="drop">
          <Upload size={28} aria-hidden />
          <p>
            The <strong>537</strong> contract journal exported from Comtras as Excel (e.g. "D537CCPDF.xlsx"), Kenya only{loaded ? ": another month to add" : ""}.
          </p>
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
          <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
            {reading ? "Reading…" : loaded ? "Add another 537" : "Choose the file"}
          </button>
        </div>
      )}
      {error && <p className="readonly">{error}</p>}
      {upload && adding && (
        <ul className="file-list">
          <li>
            <FileSpreadsheet size={18} aria-hidden /> {upload.file} · {n(upload.lines.length)} lines: {n(adding.fresh.length)} new
            {adding.duplicates ? `, ${n(adding.duplicates)} already loaded from another file (skipped)` : ""}
          </li>
        </ul>
      )}

      {lines.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Sold (invoiced)</div>
              <div className="stat-value">{r1(t.sold)}</div>
              <div className="stat-note">{cutOff ? `${r1(t.soldByCutOff)} booked by ${cutOff}` : "60 kg bags, net of credit notes"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Bought (invoiced)</div>
              <div className="stat-value">{r1(t.bought)}</div>
              <div className="stat-note">{cutOff ? `${r1(t.boughtByCutOff)} booked by ${cutOff}` : "60 kg bags, net of credit notes"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Contracts</div>
              <div className="stat-value">{n(t.salesContracts + t.purchaseContracts)}</div>
              <div className="stat-note">
                {n(t.salesContracts)} sales · {n(t.purchaseContracts)} purchase · {n(t.counterparties)} counterparties
              </div>
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

      {upload && adding && allowed && (
        <button
          className="btn btn-primary"
          disabled={!st || store.setup || !!progress || !adding.fresh.length}
          onClick={async () => {
            if (await store.importContracts(upload, (done, total) => setProgress({ done, total }))) setUpload(null);
            setProgress(null);
          }}
        >
          {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)} lines` : adding.fresh.length ? `Load ${n(adding.fresh.length)} new lines` : "Nothing new in this file"}
        </button>
      )}
    </section>
  );
}
