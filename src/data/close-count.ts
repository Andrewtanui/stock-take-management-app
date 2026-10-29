// When counting is finished, Level 1 closes on its own: the stock take moves from
// "Count in progress" to "Reconciliation" and a Level 1 summary is written for flow F10
// to send. Pure: dataverse.ts gathers the inputs and writes the result.
//
// Counting is finished when:
//   - every Ibero stack XBS has stock on has been submitted (or approved),
//   - every third-party site XBS has stock at has been closed by its counter
//     ("Nothing to count here" or "Finish counting"),
//   - no blind recount is still open, and
//   - no variance is waiting for a decision (open or sent for recount).

import type { SiteCode } from "./types";

export interface CloseInput {
  /** Ibero stacks (XBS zones) with stock in the import. */
  iberoStacks: string[];
  /** Ibero stacks submitted or approved. */
  submittedStacks: Set<string>;
  /** Third-party sites with stock in the import. */
  thirdPartySites: SiteCode[];
  /** Third-party sites their counter closed (empty or finished). */
  closedSites: Set<SiteCode>;
  openRecounts: number;
  undecidedVariances: number;
  countLines: number;
  siteShort?: (s: SiteCode) => string;
}

export interface CloseCheck {
  ready: boolean;
  /** What still stops the count closing, in plain words. */
  missing: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function closeCheck(i: CloseInput): CloseCheck {
  const short = i.siteShort ?? ((s: SiteCode) => s);
  const missing: string[] = [];
  if (!i.countLines) missing.push("nothing counted yet");
  const notIn = i.iberoStacks.filter((s) => !i.submittedStacks.has(s));
  if (notIn.length) missing.push(`${plural(notIn.length, "Ibero stack")} not submitted${notIn.length <= 5 ? ` (${notIn.join(", ")})` : ""}`);
  const open = i.thirdPartySites.filter((s) => !i.closedSites.has(s));
  if (open.length) missing.push(`${open.map(short).join(", ")} not finished`);
  if (i.openRecounts) missing.push(`${plural(i.openRecounts, "recount")} still open`);
  if (i.undecidedVariances) missing.push(`${plural(i.undecidedVariances, "variance")} waiting for a decision`);
  return { ready: !missing.length, missing };
}

export interface SummaryInput {
  stockTake: string;
  closedAt: Date;
  /** Per warehouse, in 60 kg bags: XBS and physical (current counts, recounts replacing earlier lines). */
  sites: { name: string; xbs: number; physical: number }[];
  variances: { total: number; accepted: number; acceptedAutomatically: number; exception: number };
  recountsDone: number;
  exceptions: { High: number; Medium: number; Low: number };
}

const bags = (x: number) => x.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${bags(Math.abs(x))}`;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (d: number, base: number) => (base ? `${d > 0 ? "+" : d < 0 ? "-" : ""}${Math.abs((d / base) * 100).toFixed(1)}%` : "-");

/**
 * Level 1 summary as an HTML block in the Hub's own look: three stat cards, an app-style table
 * (small grey uppercase headers, hairlines, shaded total) and two small panels. Tables and inline
 * styles only, for Outlook. Stored on the stock take; flow F10 puts it in its email under the
 * Hub's green top bar, with the PDF (l1-pdf.ts) attached.
 */
export function l1Summary(s: SummaryInput): string {
  const xbs = s.sites.reduce((a, x) => a + x.xbs, 0);
  const phys = s.sites.reduce((a, x) => a + x.physical, 0);
  const INK2 = "#5f5f5f", INK3 = "#949494", HAIR = "#e8e8e8", PAGE = "#f5f5f5", CRIT = "#ed1c24";
  const F = "font-family:'Segoe UI',Arial,Helvetica,sans-serif";
  const card = `background:#ffffff;border:1px solid ${HAIR};border-radius:12px`;
  const stat = (label: string, value: string, note: string, color = "#000000") =>
    `<td width="33%" style="padding:0 6px"><table width="100%" cellpadding="0" cellspacing="0" style="${card}"><tr><td style="${F};padding:14px 16px">` +
    `<div style="font-size:13px;font-weight:600;color:${INK2}">${label}</div>` +
    `<div style="font-size:24px;font-weight:800;color:${color};padding-top:2px">${value}</div>` +
    `<div style="font-size:12px;color:${INK3};padding-top:2px">${note}</div></td></tr></table></td>`;
  const th = (t: string, align = "right") => `<th style="${F};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${INK3};text-align:${align};padding:10px 14px;border-bottom:1px solid ${HAIR}">${t}</th>`;
  const td = (t: string, extra = "") => `<td style="${F};font-size:14px;padding:10px 14px;border-bottom:1px solid ${HAIR};text-align:right;${extra}">${t}</td>`;
  const loss = (d: number) => (d < 0 ? `color:${CRIT}` : "");
  const site = (name: string, x: number, p: number) =>
    `<tr>${td(esc(name), "text-align:left")}${td(bags(x))}${td(bags(p))}${td(signed(p - x), loss(p - x))}${td(pct(p - x, x), `color:${INK2}`)}</tr>`;
  const total = `<tr style="background:${PAGE}">${td("Total", "text-align:left;font-weight:800;border-bottom:0")}${td(bags(xbs), "font-weight:800;border-bottom:0")}${td(bags(phys), "font-weight:800;border-bottom:0")}` +
    `${td(signed(phys - xbs), `font-weight:800;border-bottom:0;${loss(phys - xbs)}`)}${td(pct(phys - xbs, xbs), `font-weight:800;border-bottom:0;color:${INK2}`)}</tr>`;
  const panel = (title: string, rows: [string, number][]) =>
    `<td width="50%" style="padding:0 6px;vertical-align:top"><table width="100%" cellpadding="0" cellspacing="0" style="${card}"><tr><td style="${F};padding:14px 16px">` +
    `<div style="font-size:16px;font-weight:700;padding-bottom:6px">${title}</div><table width="100%" cellpadding="0" cellspacing="0">` +
    rows.map(([k, val]) => `<tr><td style="${F};font-size:14px;color:${INK2};padding:4px 0">${k}</td><td style="${F};font-size:14px;font-weight:700;text-align:right;padding:4px 0">${val}</td></tr>`).join("") +
    `</table></td></tr></table></td>`;
  const v = s.variances;
  return [
    `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>`,
    stat("Physical", bags(phys), "60 kg bags"),
    stat("XBS", bags(xbs), "60 kg bags"),
    stat("Net variance vs XBS", pct(phys - xbs, xbs), `${signed(phys - xbs)} bags`, phys - xbs < 0 ? CRIT : "#000000"),
    `</tr></table>`,
    `<div style="${F};font-size:16px;font-weight:700;padding:0 6px 2px">Physical against XBS by warehouse</div>`,
    `<div style="${F};font-size:13px;color:${INK2};padding:0 6px 10px">60 kg bags. Physical counts the latest blind recount in place of earlier lines.</div>`,
    `<div style="padding:0 6px 20px"><table width="100%" cellpadding="0" cellspacing="0" style="${card};border-collapse:separate;overflow:hidden">`,
    `<tr>${th("Warehouse", "left")}${th("XBS")}${th("Physical")}${th("Difference")}${th("%")}</tr>`,
    ...s.sites.map((x) => site(x.name, x.xbs, x.physical)),
    total,
    `</table></div>`,
    `<table width="100%" cellpadding="0" cellspacing="0"><tr>`,
    panel("Variances", [["Decided", v.total], ["Accepted automatically", v.acceptedAutomatically], ["Accepted by a supervisor", v.accepted - v.acceptedAutomatically], ["Raised as exceptions", v.exception], ["Blind recounts done", s.recountsDone]]),
    panel("Exceptions from the count", [["High priority (10 bags or more)", s.exceptions.High], ["Medium priority", s.exceptions.Medium], ["Low-priority lists (per warehouse)", s.exceptions.Low]]),
    `</tr></table>`,
  ].join("");
}
