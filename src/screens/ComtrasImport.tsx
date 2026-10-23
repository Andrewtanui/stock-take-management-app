import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, FileSpreadsheet, Upload } from "lucide-react";
import { bricTotals, readP526, type ComtrasUpload } from "../data/comtras-parse";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

/** The Comtras (BRIC) position for the active stock take: the P526 report, loaded once, never changed. */
export default function ComtrasImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<ComtrasUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const st = store.stockTakes.find((s) => s.status !== "Completed");
  const loaded = store.comtras;
  const lines = loaded?.lines ?? upload?.lines ?? [];
  const t = bricTotals(lines);
  const known = new Set(store.baskets.map((b) => b.code));
  const kenya = lines.filter((l) => /kenya/i.test(l.origin) && l.lineType !== "Short");
  const unmapped = [...new Set(kenya.filter((l) => !known.has(l.quality)).map((l) => l.quality))];
  const unmappedBags = kenya.filter((l) => !known.has(l.quality)).reduce((s, l) => s + l.bags60, 0);
  const types = (k: string) => lines.filter((l) => l.lineType === k).length;

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setError(null);
    try {
      setUpload(await readP526(list[0]));
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const checks = [
    { ok: !!st, label: "A stock take to reconcile", detail: st ? `Loaded for ${st.title}.` : "Start the stock take first; the position is loaded for it.", block: !st },
    { ok: true, label: "Contract lines read", detail: `${n(lines.length)} lines: ${types("Inventory")} inventory, ${types("Longs")} longs, ${types("Short")} short.` },
    {
      ok: unmapped.length === 0,
      label: "Kenya quality codes are in the basket mapping",
      detail: unmapped.length
        ? `${unmapped.join(", ")} (${n(Math.round(unmappedBags))} bags) aren't secondary baskets in the mapping, so they can only be compared in total until Trading maps them to a primary basket.`
        : "Every Kenya quality code is a basket in the mapping.",
    },
  ];

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Comtras position (P526)</h2>
        {loaded ? <Chip tone="ok">Loaded</Chip> : <Chip tone="neutral">Not loaded</Chip>}
      </div>
      <p className="muted small">
        BRIC's position from Comtras for the same month-end. Finance's total is Arabica Kenya inventory plus Kenya longs; other origins and shorts are
        kept for audit but not part of it. Loaded once per stock take and never changed.
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
              The <strong>P526</strong> long/short report exported from Comtras as Excel (e.g. "526 KE Aug 2026.xlsx").
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
              <div className="stat-label">Total BRIC (Comtras)</div>
              <div className="stat-value">{n(Math.round(t.bric * 100) / 100)}</div>
              <div className="stat-note">60 kg bags · Kenya inventory + Kenya longs</div>
            </div>
            <div className="stat">
              <div className="stat-label">Kenya inventory</div>
              <div className="stat-value">{n(Math.round(t.inventory * 100) / 100)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Kenya longs</div>
              <div className="stat-value">{n(Math.round(t.longs * 100) / 100)}</div>
            </div>
          </div>
          <p className="muted small">
            Not in the total: other origins {n(Math.round(t.otherOrigins))} bags, shorts {n(Math.round(t.shorts))} bags.
          </p>
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
            await store.importComtras(upload, (done, total) => setProgress({ done, total }));
            setProgress(null);
          }}
        >
          {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)} lines` : "Load the Comtras position"}
        </button>
      )}
    </section>
  );
}
