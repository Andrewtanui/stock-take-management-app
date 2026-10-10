import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, CircleX, Download, FileSpreadsheet, Upload } from "lucide-react";
import { IMPORTS, SITES, can, importChecks } from "../data/repository";
import { readXbsFiles, type XbsUpload } from "../data/xbs-parse";
import { useStore } from "../data/store";
import { Chip, Code, PageHead, ReadOnly, type Tone } from "../ui/kit";

const STATUS: Record<string, Tone> = { Imported: "ok", Validated: "info", Failed: "crit", Superseded: "neutral" };

export default function Import() {
  const store = useStore();
  const allowed = can(store.role, "Import XBS stock");
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<XbsUpload | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [step, setStep] = useState<"pick" | "checked" | "done">("pick");
  const [open, setOpen] = useState<string | null>(null);
  const files = upload?.files ?? [];
  const checks = upload ? importChecks(upload.lines, upload.unknownWarehouses) : [];

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    setReadError(null);
    setStep("pick");
    try {
      setUpload(await readXbsFiles([...list], SITES));
    } catch (e) {
      setUpload(null);
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };
  const fails = checks.filter((c) => c.result === "fail").length;
  const warns = checks.filter((c) => c.result === "warn").length;

  return (
    <div className="page">
      <PageHead
        title="XBS import"
        sub="Load the two XBS stock reports. They're checked before they become the expected stock for a count, and every import is kept for audit."
        actions={
          <button className="btn">
            <Download size={18} aria-hidden /> Download templates
          </button>
        }
      />
      {!allowed && <ReadOnly who="Operations Admin or IT Admin" />}

      {allowed && (
        <section className="panel">
          <h2 className="h3">1. Choose the files</h2>
          <div className="drop">
            <Upload size={28} aria-hidden />
            <p>
              <strong>Current Stock – Batch Wise Detail</strong> and <strong>Blocked for Processing</strong>, exported from XBS as
              Excel.
            </p>
            <input ref={picker} type="file" accept=".xlsx" multiple hidden onChange={(e) => choose(e.target.files)} />
            <button className="btn" disabled={reading} onClick={() => picker.current?.click()}>
              {reading ? "Reading…" : "Choose files"}
            </button>
          </div>
          {readError && <p className="readonly">{readError}</p>}
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f) => (
                <li key={f}>
                  <FileSpreadsheet size={18} aria-hidden /> {f}
                </li>
              ))}
              <li className="muted small">
                {upload!.lines.length.toLocaleString("en-GB")} rows
                {upload!.snapshotAt ? ` · XBS snapshot ${upload!.snapshotAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
              </li>
            </ul>
          )}
          <button className="btn btn-primary" disabled={!files.length || step !== "pick"} onClick={() => setStep("checked")}>
            Check the files
          </button>
        </section>
      )}

      {step !== "pick" && (
        <section className="panel">
          <div className="row-between">
            <h2 className="h3">2. Checks</h2>
            <span>
              {fails ? <Chip tone="crit">{fails} must be fixed</Chip> : <Chip tone="ok">Nothing blocks the import</Chip>}{" "}
              {warns > 0 && <Chip tone="warn">{warns} to follow up</Chip>}
            </span>
          </div>
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.id}>
                <button className="check-row" aria-expanded={open === c.id} disabled={!c.rows.length} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {c.result === "pass" ? (
                    <CircleCheck className="ic-ok" size={20} aria-label="Passed" />
                  ) : c.result === "warn" ? (
                    <CircleAlert className="ic-warn" size={20} aria-label="Warning" />
                  ) : (
                    <CircleX className="ic-crit" size={20} aria-label="Failed" />
                  )}
                  <span className="check-text">
                    <strong>{c.label}</strong>
                    <span className="muted small">{c.detail}</span>
                  </span>
                  {c.rows.length > 0 && <span className="link small">{open === c.id ? "Hide" : `Show ${c.rows.length}`}</span>}
                </button>
                {open === c.id && (
                  <div className="table-wrap inset">
                    <table className="table table-tight">
                      <tbody>
                        {c.rows.slice(0, 15).map((r, i) => (
                          <tr key={i}>
                            <td>
                              <Code>{r.ref}</Code>
                            </td>
                            <td className="muted">{r.info}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">Warnings don't block the import. Each one is raised in Exceptions with an owner, so it's fixed in XBS before the count.</p>
          {step === "checked" ? (
            <button
              className="btn btn-primary"
              disabled={fails > 0 || !!progress}
              onClick={async () => {
                const ok = await store.importXbs(
                  {
                    files,
                    snapshotAt: upload?.snapshotAt?.toISOString(),
                    lines: upload!.lines,
                    warnings: warns,
                    fails,
                    checks: JSON.stringify(checks.map((c) => ({ id: c.id, label: c.label, result: c.result, detail: c.detail, count: c.rows.length }))),
                  },
                  (done, total) => setProgress({ done, total }),
                );
                setProgress(null);
                if (ok) setStep("done");
              }}
            >
              {progress ? `Importing… ${progress.done.toLocaleString("en-GB")} of ${progress.total.toLocaleString("en-GB")} rows` : "3. Import as expected stock"}
            </button>
          ) : (
            <p className="readonly ok">
              <CircleCheck size={16} aria-hidden /> Imported. Choose it when you create the next stock take.
            </p>
          )}
        </section>
      )}

      <section className="block">
        <h2 className="h3">Import history</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Import</th>
                <th>When</th>
                <th>By</th>
                <th>Files</th>
                <th className="num">Rows</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {IMPORTS.map((i) => (
                <tr key={i.id}>
                  <td className="code">{i.id}</td>
                  <td>{i.at}</td>
                  <td>{i.by}</td>
                  <td className="muted small">{i.files.length} file{i.files.length === 1 ? "" : "s"}</td>
                  <td className="num">{i.rows.toLocaleString("en-GB")}</td>
                  <td>
                    <Chip tone={STATUS[i.status]}>{i.status === "Failed" ? "Failed: Blocked report missing" : i.status}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
