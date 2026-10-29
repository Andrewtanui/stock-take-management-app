import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Upload } from "lucide-react";
import { DOC_TYPES, contractTotals, read537, type ContractUpload } from "../data/contracts-parse";
import { allLines } from "../data/repository";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

/**
 * The Comtras 537 contract invoicing journal for the active stock take: Kenya's (company CC)
 * invoice and credit-note lines per purchase and sales contract. Loaded once, never changed.
 */
export default function ContractsImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<ContractUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const loaded = store.contractJournal;
  const lines = loaded?.lines ?? upload?.lines ?? [];
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
        so the reconciliation can see coffee sold and invoiced but still in the warehouse at the count. Loaded once per stock take and never changed.
      </p>

      {loaded ? (
        <p className="readonly ok">
          <CircleCheck size={16} aria-hidden /> {loaded.file} · {n(loaded.lines.length)} lines · loaded {loaded.at}
          {loaded.by ? ` by ${loaded.by}` : ""}
        </p>
      ) : (
        allowed && (
          <div className="drop">
            <Upload size={28} aria-hidden />
            <p>
              The <strong>537</strong> contract journal exported from Comtras as Excel (e.g. "D537CCPDF.xlsx"), Kenya only.
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

      {!loaded && upload && allowed && (
        <button
          className="btn btn-primary"
          disabled={!st || store.setup || !!progress}
          onClick={async () => {
            await store.importContracts(upload, (done, total) => setProgress({ done, total }));
            setProgress(null);
          }}
        >
          {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)} lines` : "Load the contract journal"}
        </button>
      )}
    </section>
  );
}
