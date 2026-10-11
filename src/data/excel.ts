// Writes a report to a real .xlsx file: one sheet per table, a title and note
// above the header, numbers kept as numbers with Excel formats.

import writeXlsxFile, { type Cell, type Row as XRow } from "write-excel-file/browser";
import type { ColKind, ReportOut } from "./reports";

const FORMAT: Record<ColKind, string | undefined> = { text: undefined, int: "#,##0", num1: "#,##0.0", pct: "0.0%" };

const sheetName = (s: string, used: Set<string>) => {
  let n = s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Report";
  for (let i = 2; used.has(n); i++) n = `${n.slice(0, 28)} ${i}`;
  used.add(n);
  return n;
};

export async function exportReport(name: string, stockTake: string, out: ReportOut) {
  const used = new Set<string>();
  const sheets = out.tables.map((t) => {
    const cell = (v: unknown, kind: ColKind = "text", bold = false): Cell => {
      if (v === undefined || v === null || v === "") return null;
      if (typeof v === "number" && kind !== "text") return { value: v, type: Number, format: FORMAT[kind], fontWeight: bold ? "bold" : undefined };
      return { value: String(v), type: String, fontWeight: bold ? "bold" : undefined };
    };
    const data: XRow[] = [
      [{ value: t.title ? `${name} — ${t.title}` : name, type: String, fontWeight: "bold", fontSize: 14 }],
      [{ value: `${stockTake} · generated ${new Date().toLocaleString("en-GB")}`, type: String }],
      ...(out.note ? [[{ value: out.note, type: String }] as XRow] : []),
      [],
      t.columns.map((c) => ({ value: c.label, type: String, fontWeight: "bold" as const, backgroundColor: "#E6EFE2" })),
      ...t.rows.map((r) => t.columns.map((c) => cell(r[c.key], c.kind))),
      ...(t.total ? [t.columns.map((c) => cell(t.total![c.key], c.kind, true))] : []),
    ];
    const columns = t.columns.map((c) => {
      const longest = Math.max(c.label.length, ...t.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length));
      return { width: Math.min(60, Math.max(10, c.kind && c.kind !== "text" ? 14 : longest + 2)) };
    });
    return { data, columns, sheet: sheetName(t.title ?? name, used), stickyRowsCount: data.length - t.rows.length - (t.total ? 1 : 0) };
  });
  const file = `${name} - ${stockTake}`.replace(/[\\/:*?"<>|]/g, " ").slice(0, 120);
  await writeXlsxFile(sheets).toFile(`${file}.xlsx`);
}
