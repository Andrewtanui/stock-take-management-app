import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileText, Upload } from "lucide-react";
import { can } from "../data/repository";
import { useStore } from "../data/store";
import type { CountPreview, SiteChoice } from "../data/count-import";
import type { SiteCode } from "../data/types";
import { Chip, PageHead, ReadOnly, Stat, n } from "../ui/kit";
import RecountImport from "./RecountImport";

const CHOICES: { value: SiteChoice; label: string }[] = [
  { value: "open", label: "Still to come" },
  { value: "notCounted", label: "Too little to count" },
  { value: "empty", label: "Empty" },
];
const CHOICE_HINT: Record<SiteChoice, string> = {
  open: "Not counted yet: its count or statement is still to come; the count can't close until it's in.",
  notCounted: "Not counted on purpose: its lots are differences at 0, accepted automatically and carried to the reconciliation as a reconciling item.",
  empty: "Checked, nothing there: someone checked and found it empty: every lot XBS has there is judged as counted 0.",
};

/** Lots counted but not in XBS shown in the preview (largest first). */
const SHOW = 25;
const bags = (kg: number) => n(kg / 60, 1);
const signed = (kg: number) => `${kg >= 0 ? "+" : "−"}${bags(Math.abs(kg))}`;

/**
 * Stock take › Physical count import: a count done in the old Physical Count app (its CSV export)
 * loaded into the active stock take as the counter app would have saved it, so Level 1 runs on it.
 * The file is read and shown first; nothing is written until Load.
 */
export default function CountImport() {
  const store = useStore();
  const allowed = can(store.role, "Import XBS stock");
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<CountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [choices, setChoices] = useState<Partial<Record<SiteCode, SiteChoice>>>({});
  const [reason, setReason] = useState("too little to count");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const st = store.stockTake;
  const short = (c: SiteCode) => store.sites.find((x) => x.code === c)?.short ?? c;

  const read = async (f: { name: string; text: string }, ch: typeof choices, why: string) => {
    setReading(true);
    setError(null);
    try {
      const p = await store.planCounts(f.text, { siteChoices: ch, notCountedReason: why });
      setPreview(p ?? null);
      if (!p) setError("The file couldn't be read against this stock take.");
    } finally {
      setReading(false);
    }
  };
  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    const f = { name: list[0].name, text: await list[0].text() };
    if (picker.current) picker.current.value = "";
    setFile(f);
    setChoices({});
    setLoaded(false);
    await read(f, {}, reason);
  };
  const pick = (site: SiteCode, c: SiteChoice) => {
    const next = { ...choices, [site]: c };
    setChoices(next);
    if (file) void read(file, next, reason);
  };

  const plan = preview?.plan;
  const lines = plan?.lines ?? [];
  const countedKg = lines.reduce((a, l) => a + l.kg, 0);
  const notInXbs = lines.filter((l) => !l.lot);
  const moved = lines.filter((l) => l.found && l.lot).length;
  const uncounted = plan?.sites.filter((s) => s.choice) ?? [];
  const anyNotCounted = uncounted.some((s) => s.choice === "notCounted");
  const allLoaded = !!preview && preview.alreadyLoaded >= lines.length && lines.length > 0;
  const counting = !!preview?.counting && st?.status === "Count in progress";
  const blocked = !counting || !!plan?.errors.length || allLoaded || loaded;

  return (
    <div className="page">
      <PageHead
        title="Physical count import"
        sub="Load a count done in the old Physical Count app (its CSV export) into the stock take, as if it had been counted in the counter app. Level 1 runs on it straight after."
      />
      {!allowed && <ReadOnly who="Operations Admin or IT Admin" />}

      <section className="panel">
        <div className="row-between">
          <h2 className="h3">Stock take</h2>
          {st ? <Chip tone={st.status === "Count in progress" ? "ok" : "warn"}>{st.status}</Chip> : <Chip tone="neutral">None open</Chip>}
        </div>
        {st ? (
          <p className="small">
            <strong>{st.title}</strong>. The count is loaded into this stock take and compared with its XBS import.
            {st.status !== "Count in progress" && " It isn't in Count in progress, so a count can't be loaded into it."}
          </p>
        ) : (
          <p className="readonly">Create the stock take (and import its XBS stock) first.</p>
        )}
      </section>

      {allowed && st && (
        <section className="panel">
          <h2 className="h3">1. Choose the file</h2>
          <div className="drop">
            <Upload size={28} aria-hidden />
            <p>
              The <strong>Physical Count Monthly Stock Take</strong> export from the old app (CSV), as the warehouse sends it.
            </p>
            <input ref={picker} type="file" accept=".csv" hidden onChange={(e) => choose(e.target.files)} />
            <button className="btn" disabled={reading || !!progress} onClick={() => picker.current?.click()}>
              {reading ? "Reading…" : "Choose the file"}
            </button>
          </div>
          {file && (
            <ul className="file-list">
              <li>
                <FileText size={18} aria-hidden /> {file.name}
              </li>
            </ul>
          )}
          {error && <p className="readonly">{error}</p>}
        </section>
      )}

      {allowed && plan && preview && (
        <section className="panel">
          <h2 className="h3">2. Check what will be loaded</h2>
          <p className="muted small">
            Read against {preview.stockTake} (count date {preview.countDate}). Nothing is saved yet. Check the totals with the warehouse before loading.
          </p>
          <div className="stats">
            <Stat label="Count lines" value={n(lines.length)} note={`${n(plan.rows)} rows in the file · ${n(plan.withStock - lines.length)} merged`} />
            <Stat label="Stacks" value={n(plan.stacks.filter((s) => !s.empty && s.name !== "Whole site").length)} note={`+ ${n(plan.stacks.filter((s) => s.empty).length)} XBS stacks nobody recorded`} />
            <Stat label="Counted" value={`${bags(countedKg)} bags`} note={`XBS ${bags(preview.xbsKg)} · ${signed(countedKg - preview.xbsKg)}`} tone={Math.abs(countedKg - preview.xbsKg) / 60 < 1 ? "ok" : undefined} />
            <Stat label="Counted by" value={n(plan.clerks)} note={plan.from ? `${plan.from.slice(0, 10)} to ${plan.to?.slice(0, 10)}` : undefined} />
          </div>

          <div className="table-wrap">
            <table className="table table-tight">
              <thead>
                <tr>
                  <th>Warehouse</th>
                  <th className="num">Counted</th>
                  <th className="num">XBS</th>
                  <th className="num">Difference</th>
                  <th className="num">Lines</th>
                  <th className="num">Stacks</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.sites.map((s) => (
                  <tr key={s.site}>
                    <td>{short(s.site)}</td>
                    <td className="num">{s.lines || !s.choice ? bags(s.countedKg) : "—"}</td>
                    <td className="num">{bags(s.xbsKg)}</td>
                    <td className="num">{s.lines || !s.choice ? signed(s.countedKg - s.xbsKg) : "—"}</td>
                    <td className="num">{n(s.lines)}</td>
                    <td className="num">
                      {n(s.stacks)}
                      {s.emptyStacks ? ` + ${n(s.emptyStacks)} empty` : ""}
                    </td>
                    <td>
                      {s.choice ? (
                        <div className="seg" role="radiogroup" aria-label={`${short(s.site)}: not in the file`}>
                          {CHOICES.map((c) => (
                            <button key={c.value} type="button" role="radio" aria-checked={s.choice === c.value} aria-pressed={s.choice === c.value} disabled={reading || !!progress} onClick={() => pick(s.site, c.value)}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      ) : s.thirdParty ? (
                        "Counted (site finished)"
                      ) : (
                        "Counted"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {uncounted.length > 0 && (
            <div className="small">
              {[...new Set(uncounted.map((s) => s.choice!))].map((c) => (
                <p key={c} className="hint">
                  <strong>{CHOICES.find((x) => x.value === c)!.label}</strong> ({uncounted.filter((s) => s.choice === c).map((s) => short(s.site)).join(", ")}): {CHOICE_HINT[c]}
                </p>
              ))}
            </div>
          )}
          {anyNotCounted && (
            <label className="field">
              <span className="field-label">Why weren't they counted?</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => file && void read(file, choices, reason)} maxLength={300} />
            </label>
          )}

          <p className="small">
            {n(moved)} lots found away from their XBS stack (Level 1 checks whether they moved) · {n(lines.filter((l) => l.packKg === 50).length)} in 50 kg bags ·{" "}
            {n(lines.filter((l) => l.lot?.bfp).length)} blocked for processing.
          </p>
          {notInXbs.length > 0 && (
            <>
              <h3 className="h3">Counted, not in XBS at that warehouse ({notInXbs.length})</h3>
              <div className="table-wrap">
                <table className="table table-tight">
                  <thead>
                    <tr>
                      <th>Outturn</th>
                      <th>Grade</th>
                      <th>Where</th>
                      <th className="num">Bags</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...notInXbs].sort((a, b) => b.kg - a.kg).slice(0, SHOW).map((l) => (
                      <tr key={`${l.site}|${l.stack}|${l.outturn}|${l.grade}`}>
                        <td>{l.outturn}</td>
                        <td>{l.grade}</td>
                        <td>
                          {short(l.site)} {l.stack}
                        </td>
                        <td className="num">{bags(l.kg)}</td>
                        <td>{l.inXbs ? "XBS has it at another warehouse" : "Not in XBS: a typo, a duplicate or coffee off system"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {notInXbs.length > SHOW && (
                <p className="muted small">
                  The {SHOW} largest of {n(notInXbs.length)} ({bags(notInXbs.reduce((a, l) => a + l.kg, 0))} bags in all). A long list usually means the XBS import isn't from the same count date.
                </p>
              )}
            </>
          )}
          {plan.notes.length > 0 && (
            <details>
              <summary className="small">
                {plan.notes.length} note{plan.notes.length === 1 ? "" : "s"} on single lines
              </summary>
              <ul className="small">
                {plan.notes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          )}
          {plan.errors.length > 0 && (
            <div className="readonly">
              <CircleAlert size={16} aria-hidden /> {plan.errors.length} line{plan.errors.length === 1 ? "" : "s"} can't be loaded, so nothing will be until the file is fixed:
              <ul className="small">
                {plan.errors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {allowed && plan && preview && (
        <section className="panel">
          <h2 className="h3">3. Load</h2>
          {loaded ? (
            <p className="readonly ok">
              <CircleCheck size={16} aria-hidden /> Loaded. The Hub is reloading and Level 1 runs on the count: see Variances and Count day live.
            </p>
          ) : allLoaded ? (
            <p className="readonly ok">
              <CircleCheck size={16} aria-hidden /> This file is already loaded into {preview.stockTake}.
            </p>
          ) : (
            <>
              {preview.alreadyLoaded > 0 && (
                <p className="hint">
                  {n(preview.alreadyLoaded)} of {n(lines.length)} lines of this file are already in the stock take (a load that stopped part way). Load adds the rest.
                </p>
              )}
              {!counting && <p className="readonly">The stock take isn't in Count in progress; a count can't be loaded into it.</p>}
              <p className="muted small">
                Written as you: one count sheet per warehouse, every stack submitted. Who counted each line in the old app is kept in its note. Blind recounts go to
                counters on the published allocation.
              </p>
              <button
                className="btn btn-primary"
                disabled={blocked || reading || !!progress}
                onClick={async () => {
                  if (file && (await store.importCounts(plan, file.name, (done, total) => setProgress({ done, total })))) setLoaded(true);
                  setProgress(null);
                }}
              >
                {progress ? `Loading… ${n(progress.done)} of ${n(progress.total)}` : `Load the count (${n(lines.length)} lines)`}
              </button>
            </>
          )}
        </section>
      )}

      <RecountImport allowed={allowed} />
    </div>
  );
}
