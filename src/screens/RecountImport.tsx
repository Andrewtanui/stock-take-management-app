import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { parseRecountSheet, type RecountPlan } from "../data/recount-import";
import { useStore } from "../data/store";
import { Chip, n } from "../ui/kit";

type Cell = string | number | boolean | Date | null;

/**
 * Physical count import › Recount results: the blind recount sheet the warehouse filled in, loaded as
 * blind recounts (one line per R-number on its stack). Level 1 then settles each recount on its own.
 * The sheet is read and shown first; nothing is written until Load.
 */
export default function RecountImport({ allowed }: { allowed: boolean }) {
  const store = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [plan, setPlan] = useState<RecountPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    const f = list[0];
    if (picker.current) picker.current.value = "";
    setReading(true);
    setError(null);
    setPlan(null);
    setLoaded(false);
    try {
      // The worker-free build: the Power Apps player won't run Web Workers (see src/vendor/fflate-sync.ts).
      const { default: readXlsxFile } = await import("read-excel-file/universal");
      const sheets = (await readXlsxFile(f)) as unknown as { sheet: string; data: Cell[][] }[];
      const rows = sheets.map((s) => parseRecountSheet(s.data)).find((r) => r);
      if (!rows) throw new Error(`${f.name} doesn't look like the blind recount sheet (no "Recount" and "Full bags" columns).`);
      const p = await store.planRecounts(rows);
      setFile(f.name);
      setPlan(p ?? null);
      if (!p) setError("The sheet couldn't be read against this stock take.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <section className="panel">
      <div className="row-between">
        <h2 className="h3">Recount results</h2>
        <Chip tone="neutral">Blind recount sheet</Chip>
      </div>
      <p className="muted small">
        The blind recount sheet the warehouse filled in. Each answered row becomes a blind recount of its lot, on its stack; Level 1 then settles it: a recount
        that matches XBS is accepted, one that repeats the first count becomes an exception, and one that matches neither goes back to the supervisor. Rows
        left empty stay open. Nothing is written until Load.
      </p>
      {allowed && (
        <div className="drop">
          <Upload size={28} aria-hidden />
          <p>
            The <strong>recount sheet</strong> as returned (Excel).
          </p>
          <input ref={picker} type="file" accept=".xlsx" hidden onChange={(e) => choose(e.target.files)} />
          <button className="btn" disabled={reading || !!progress} onClick={() => picker.current?.click()}>
            {reading ? "Reading…" : "Choose the sheet"}
          </button>
        </div>
      )}
      {error && <p className="readonly">{error}</p>}
      {plan && file && (
        <>
          <ul className="file-list">
            <li>
              <FileSpreadsheet size={18} aria-hidden /> {file} · {n(plan.rows)} rows: {n(plan.answers.length)} answered, {n(plan.notFilled.length)} not filled in
              {plan.missing.length ? `; ${n(plan.missing.length)} open recounts not on the sheet (${plan.missing.join(", ")})` : ""}
            </li>
          </ul>
          {plan.errors.length > 0 && (
            <div className="readonly">
              <CircleAlert size={16} aria-hidden /> {n(plan.errors.length)} row{plan.errors.length === 1 ? "" : "s"} can't be loaded. Fix the sheet and choose it again.
              <ul>
                {plan.errors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.notes.length > 0 && (
            <ul className="hint">
              {plan.notes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {plan.answers.length > 0 && (
            <div className="table-wrap">
              <table className="table table-tight">
                <thead>
                  <tr>
                    <th>Recount</th>
                    <th>Location</th>
                    <th>Outturn</th>
                    <th className="num">Full bags</th>
                    <th className="num">Pocket kg</th>
                    <th className="num">Kg</th>
                    <th>Recounted by</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.answers.map((a) => (
                    <tr key={a.recount}>
                      <td>{a.recount}</td>
                      <td>{a.stack}</td>
                      <td>{a.outturn}</td>
                      <td className="num">{a.notFound ? "Not found" : n(a.fullBags)}</td>
                      <td className="num">{a.notFound ? "" : n(a.pocketKg, 1)}</td>
                      <td className="num">{n(a.kg, 1)}</td>
                      <td>{a.by || "—"}</td>
                      <td>{a.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loaded ? (
            <p className="readonly ok">
              <CircleCheck size={16} aria-hidden /> Loaded. The Hub is reloading and Level 1 settles the recounts: see Variances and Exceptions.
            </p>
          ) : (
            allowed &&
            plan.answers.length > 0 && (
              <button
                className="btn btn-primary"
                disabled={plan.errors.length > 0 || !!progress}
                onClick={async () => {
                  if (await store.importRecounts(plan, file, (done, total) => setProgress({ done, total }))) setLoaded(true);
                  setProgress(null);
                }}
              >
                {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)}` : `Load ${n(plan.answers.length)} recount answer${plan.answers.length === 1 ? "" : "s"}`}
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
