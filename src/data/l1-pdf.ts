// The Level 1 summary as an A4 PDF in the Hub's own look: the green top bar with the NKG logo,
// a headline, stat cards, an app-style table (small grey headers, hairlines, shaded total) and
// two small panels. Built in the Hub with pdf-lib (no web workers, so it runs inside the Power
// Apps player), saved as a note on the stock take, attached to flow F10's email and downloadable
// from the Overview.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import logoUrl from "../assets/nkg-mark.png?inline";
import type { SummaryInput } from "./close-count";
import { SLOGAN } from "../shared/brand";

// The Hub's tokens (theme.css / styles.css).
const GREEN = rgb(0, 0x63 / 255, 0x30 / 255); // Neumann green: top bar
const DONE = rgb(0x69 / 255, 0xac / 255, 0x45 / 255); // fresh green: done
const CRIT = rgb(0xed / 255, 0x1c / 255, 0x24 / 255); // Neumann red: losses
const INK = rgb(0, 0, 0);
const INK2 = rgb(0.38, 0.38, 0.38); // --ink-2
const INK3 = rgb(0.58, 0.58, 0.58); // --ink-3
const HAIR = rgb(0.91, 0.91, 0.91); // --hair
const PAGE = rgb(0.96, 0.96, 0.96); // --page
const WHITE = rgb(1, 1, 1);

const bags = (x: number) => x.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${bags(Math.abs(x))}`;
const pct = (d: number, base: number) => (base ? `${d > 0 ? "+" : d < 0 ? "-" : ""}${Math.abs((d / base) * 100).toFixed(1)}%` : "-");

/** The logo the app ships with (built into the bundle, so the player can't fail to load it). */
function logoBytes() {
  const bin = atob(logoUrl.split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function l1Pdf(s: SummaryInput, logoPng: Uint8Array | undefined = logoBytes()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Level 1 summary - ${s.stockTake}`);
  doc.setAuthor("Ibero Kenya Limited - Stock Management Hub");
  doc.setSubject("Stock take: physical against XBS (Level 1)");
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = page.getWidth(), TOP = page.getHeight();
  const M = 40;

  // Helvetica only has the WinAnsi characters: anything else becomes "?" instead of failing.
  const safe = (t: string, f: PDFFont) => [...t].map((ch) => { try { f.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  const text = (p: PDFPage, t: string, x: number, y: number, size: number, f = font, color = INK) => p.drawText(safe(t, f), { x, y, size, font: f, color });
  const right = (p: PDFPage, t: string, xr: number, y: number, size: number, f = font, color = INK) => {
    const v = safe(t, f);
    p.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y, size, font: f, color });
  };
  // Rounded card with a hairline border, like .panel / .stat.
  const card = (x: number, yTop: number, w: number, h: number, r = 8, fill = WHITE) => {
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    page.drawSvgPath(path, { x, y: yTop, color: fill, borderColor: HAIR, borderWidth: 0.8 });
  };

  // Top bar, as in the app.
  const BAR = 46;
  page.drawRectangle({ x: 0, y: TOP - BAR, width: W, height: BAR, color: GREEN });
  if (logoPng?.length) {
    const img = await doc.embedPng(logoPng);
    const h = 20, w = (img.width / img.height) * h;
    page.drawImage(img, { x: M, y: TOP - BAR / 2 - h / 2, width: w, height: h });
  }
  right(page, "Stock Management Hub", W - M, TOP - BAR / 2 - 4, 10, bold, WHITE);

  // Headline: black statement and a light line (the app's Headline).
  let y = TOP - BAR - 42;
  text(page, "Level 1 reconciliation complete", M, y, 20, bold);
  text(page, s.stockTake, M, y - 20, 12, font, INK2);
  const when = s.closedAt.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
  text(page, `Counting closed ${when} (EAT). Every stack is in, no recount is open and every variance is decided.`, M, y - 36, 9, font, INK2);

  // Stat cards.
  const xbs = s.sites.reduce((a, x) => a + x.xbs, 0);
  const phys = s.sites.reduce((a, x) => a + x.physical, 0);
  const stats: [string, string, string, typeof INK][] = [
    ["Physical", bags(phys), "60 kg bags", INK],
    ["XBS", bags(xbs), "60 kg bags", INK],
    ["Net variance vs XBS", pct(phys - xbs, xbs), `${signed(phys - xbs)} bags`, phys - xbs < 0 ? CRIT : INK],
  ];
  y -= 62;
  const gap = 12, sw = (W - 2 * M - gap * 2) / 3, sh = 62;
  stats.forEach(([label, value, note, color], i) => {
    const x = M + i * (sw + gap);
    card(x, y, sw, sh);
    text(page, label, x + 14, y - 18, 9, bold, INK2);
    text(page, value, x + 14, y - 40, 18, bold, color);
    text(page, note, x + 14, y - 54, 8, font, INK3);
  });
  y -= sh + 30;

  // Table, app style.
  text(page, "Physical against XBS by warehouse", M, y, 12, bold);
  text(page, "60 kg bags. Physical counts the latest blind recount in place of earlier lines.", M, y - 14, 8.5, font, INK2);
  y -= 26;
  const rowH = 24;
  const rows = s.sites.length + 2;
  card(M, y, W - 2 * M, rows * rowH + 2);
  const L = M + 14, C = [M + 250, M + 330, M + 410, W - M - 14];
  y -= 1;
  text(page, "WAREHOUSE", L, y - 16, 7.5, bold, INK3);
  ["XBS", "PHYSICAL", "DIFFERENCE", "%"].forEach((h, i) => right(page, h, C[i], y - 16, 7.5, bold, INK3));
  y -= rowH;
  for (const x of s.sites) {
    page.drawLine({ start: { x: M + 1, y }, end: { x: W - M - 1, y }, thickness: 0.6, color: HAIR });
    const d = x.physical - x.xbs;
    text(page, x.name, L, y - 16, 10);
    right(page, bags(x.xbs), C[0], y - 16, 10);
    right(page, bags(x.physical), C[1], y - 16, 10);
    right(page, signed(d), C[2], y - 16, 10, font, d < 0 ? CRIT : INK);
    right(page, pct(d, x.xbs), C[3], y - 16, 10, font, INK2);
    y -= rowH;
  }
  page.drawRectangle({ x: M + 1, y: y - rowH + 1, width: W - 2 * M - 2, height: rowH - 1, color: PAGE });
  text(page, "Total", L, y - 16, 10, bold);
  right(page, bags(xbs), C[0], y - 16, 10, bold);
  right(page, bags(phys), C[1], y - 16, 10, bold);
  right(page, signed(phys - xbs), C[2], y - 16, 10, bold, phys - xbs < 0 ? CRIT : INK);
  right(page, pct(phys - xbs, xbs), C[3], y - 16, 10, bold, INK2);
  y -= rowH + 30;

  // Two panels.
  const v = s.variances;
  const panels: [string, [string, string][]][] = [
    ["Variances", [
      ["Decided", String(v.total)],
      ["Accepted automatically", String(v.acceptedAutomatically)],
      ["Accepted by a supervisor", String(v.accepted - v.acceptedAutomatically)],
      ["Raised as exceptions", String(v.exception)],
      ["Blind recounts done", String(s.recountsDone)],
    ]],
    ["Exceptions from the count", [
      ["High priority (10 bags or more)", String(s.exceptions.High)],
      ["Medium priority", String(s.exceptions.Medium)],
      ["Low-priority lists (per warehouse)", String(s.exceptions.Low)],
    ]],
  ];
  const pw = (W - 2 * M - 12) / 2, ph = 30 + 5 * 18 + 6;
  panels.forEach(([title, items], i) => {
    const x = M + i * (pw + 12);
    card(x, y, pw, ph);
    text(page, title, x + 14, y - 20, 11, bold);
    items.forEach(([k, val], j) => {
      const ry = y - 40 - j * 18;
      text(page, k, x + 14, ry, 9, font, INK2);
      right(page, val, x + pw - 14, ry, 9.5, bold);
    });
  });
  y -= ph + 28;

  // What comes next, as the Overview's chain.
  text(page, "Next", M, y, 11, bold);
  const steps: [string, boolean][] = [["Count", true], ["Level 1: physical against XBS", true], ["Level 2: XBS against Comtras", false], ["Sign-off", false]];
  steps.forEach(([label, done], i) => {
    const cx = M + 6, cy = y - 22 - i * 20;
    if (i) page.drawLine({ start: { x: cx, y: cy + 14 }, end: { x: cx, y: cy + 6 }, thickness: 1.2, color: HAIR });
    page.drawCircle({ x: cx, y: cy, size: 5, color: done ? DONE : WHITE, borderColor: done ? DONE : INK3, borderWidth: 1 });
    text(page, label, M + 20, cy - 3.5, 9.5, done ? font : bold, done ? INK2 : INK);
  });

  // Footer.
  page.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: HAIR });
  text(page, "Stock Management Hub  ·  Ibero Kenya Limited  ·  NKG East Africa", M, 32, 7.5, font, INK3);
  right(page, SLOGAN, W - M, 32, 8, bold, GREEN);
  text(page, "Internal: contains XBS figures. Do not share with counters.", M, 21, 7.5, font, INK3);

  return doc.save();
}

/** Base64 of bytes, chunked so large files don't overflow the call stack. */
export function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
