// The Level 2 report as an A4 PDF, laid out like Finance's signed page ("Inventory Position"):
// Total BRIC against the Ibero count and afloat, the difference, the reconciling items and what is
// left unexplained, then the signature block of the sign-off chain (who signs each gate, who signed
// it and when). Built in the Hub with pdf-lib on demand, from the Overview's Level 2 PDF button.

import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { notoSans, safeText } from "./pdf-fonts";
import { logoBytes } from "./l1-pdf";
import type { bricBridge } from "./recon";
import { SLOGAN } from "../shared/brand";

const GREEN = rgb(0, 0x63 / 255, 0x30 / 255);
const CRIT = rgb(0xed / 255, 0x1c / 255, 0x24 / 255);
const INK = rgb(0, 0, 0);
const INK2 = rgb(0.38, 0.38, 0.38);
const INK3 = rgb(0.58, 0.58, 0.58);
const HAIR = rgb(0.91, 0.91, 0.91);
const PAGE = rgb(0.96, 0.96, 0.96);
const WHITE = rgb(1, 1, 1);

type Bridge = NonNullable<ReturnType<typeof bricBridge>>;

export interface L2Signer {
  tier: string;
  gate: string;
  /** Who signs the gate. */
  name: string;
  /** Who signed it, when signed. */
  by?: string;
  at?: string;
}

export interface L2PdfInput {
  stockTake: string;
  /** "Aug 2026". */
  month: string;
  bridge: Bridge;
  signers: L2Signer[];
}

// Whole bags, negatives in brackets, as on Finance's page ("-0" never shows).
const br = (x: number) => {
  const r = Math.round(x) || 0;
  const s = Math.abs(r).toLocaleString("en-GB");
  return r < 0 ? `(${s})` : s;
};

export async function l2Pdf(s: L2PdfInput, logoPng: Uint8Array | undefined = logoBytes()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Level 2 reconciliation - ${s.stockTake}`);
  doc.setAuthor("Ibero Kenya Limited - Stock Management Hub");
  doc.setSubject("Stock take: XBS against Comtras (Level 2)");
  const { font, bold } = await notoSans(doc);
  const logo = logoPng?.length ? await doc.embedPng(logoPng) : undefined;
  const W = 595.28, TOP = 841.89, M = 40, BAR = 46, FOOT = 70;

  const safe = safeText;
  let page!: PDFPage;
  const text = (t: string, x: number, y: number, size: number, f = font, color = INK) => page.drawText(safe(t, f), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size: number, f = font, color = INK) => {
    const v = safe(t, f);
    page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y, size, font: f, color });
  };
  const hair = (y: number) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: HAIR });

  const newPage = () => {
    page = doc.addPage([W, TOP]);
    page.drawRectangle({ x: 0, y: TOP - BAR, width: W, height: BAR, color: GREEN });
    if (logo) {
      const h = 20, w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: M, y: TOP - BAR / 2 - h / 2, width: w, height: h });
    }
    right("Stock Management Hub", W - M, TOP - BAR / 2 - 4, 10, bold, WHITE);
    hair(46);
    text("Stock Management Hub  ·  Ibero Kenya Limited  ·  NKG East Africa", M, 32, 7.5, font, INK3);
    right(SLOGAN, W - M, 32, 8, bold, GREEN);
    text("Internal: contains XBS and Comtras figures. Do not share with counters.", M, 21, 7.5, font, INK3);
    return TOP - BAR - 30;
  };
  let y = newPage();
  const room = (h: number) => {
    if (y - h < FOOT) y = newPage();
  };

  // Headline.
  y -= 12;
  text(s.month ? `${s.month} inventory position` : "Inventory position", M, y, 20, bold);
  text(`${s.stockTake}  ·  Level 2: XBS against Comtras`, M, y - 20, 12, font, INK2);
  y -= 50;

  // The position, as Finance's table: label, Physical, XBS.
  const b = s.bridge;
  const C = [W - M - 110, W - M - 14];
  const rowH = 19;
  const row = (label: string, p: number | string, x: number | string, kind: "" | "total" | "sub" | "open" | "closed" = "") => {
    room(rowH);
    const f = kind ? bold : font;
    const color = kind === "open" ? CRIT : kind === "closed" ? GREEN : INK;
    if (kind === "total" || kind === "open" || kind === "closed") page.drawRectangle({ x: M, y: y - rowH + 1, width: W - 2 * M, height: rowH - 1, color: PAGE });
    text(label, M + 10, y - 13, 9.5, f, color);
    right(typeof p === "number" ? br(p) : p, C[0], y - 13, 9.5, f, color);
    right(typeof x === "number" ? br(x) : x, C[1], y - 13, 9.5, f, color);
    y -= rowH;
    hair(y);
  };
  const head = (label: string) => {
    room(rowH + 4);
    y -= 4;
    text(label.toUpperCase(), M + 10, y - 13, 7.5, bold, INK3);
    y -= rowH;
    hair(y);
  };
  text("60 KG BAGS", M + 10, y - 13, 7.5, bold, INK3);
  right("PHYSICAL", C[0], y - 13, 7.5, bold, INK3);
  right("XBS", C[1], y - 13, 7.5, bold, INK3);
  y -= rowH;
  hair(y);
  row("Total BRIC (Comtras)", b.bric, b.bric, "total");
  head("Ibero count results");
  for (const x of b.sites) row(x.site.name, x.physical, x.xbsWhole);
  row("Counted stock", b.counted.physical, b.counted.xbs, "sub");
  if (b.afloatItems.length) for (const i of b.afloatItems) row(i.label, i.bags, i.bags);
  else row("Stuffed coffee, afloat", 0, 0);
  row("Total Ibero", b.totalIbero.physical, b.totalIbero.xbs, "total");
  row("Difference (BRIC expected vs Ibero count)", b.difference.physical, b.difference.xbs, "sub");
  head("Reconciling items");
  for (const i of b.recon) row(i.label, i.bags, i.inXbs ? i.bags : "");
  if (!b.recon.length) row("None", "", "");
  row("Total reconciling items", -b.itemsTotal.physical, -b.itemsTotal.xbs, "sub");
  row("BRIC vs Ibero stock position, unexplained", b.position.physical, b.position.xbs, Math.abs(b.position.physical) >= 0.5 ? "open" : "closed");
  room(16);
  text("Brackets are negative. Afloat counts in both columns; a reconciling item counts in the XBS column only when it is also in XBS.", M, y - 12, 7.5, font, INK2);
  y -= 34;

  // Signature block, as on the paper: Prepared / Reviewed / Approved by, name and title, signature.
  room(30);
  text("Signatures", M, y, 12, bold);
  y -= 10;
  hair(y);
  const sigH = 42;
  for (const g of s.signers) {
    room(sigH);
    text(`${g.tier} by:`, M, y - 16, 9, font, INK2);
    text(g.name, M + 110, y - 16, 10, bold);
    text(g.gate, M + 110, y - 29, 8.5, font, INK2);
    const sx = M + 300;
    if (g.by) {
      text(`Signed by ${g.by}`, sx, y - 16, 9.5, bold, GREEN);
      const sub = [g.by !== g.name ? `on behalf of ${g.name}` : "", g.at ?? ""].filter(Boolean).join("  ·  ");
      text(sub, sx, y - 29, 8.5, font, INK2);
    } else {
      page.drawLine({ start: { x: sx, y: y - 18 }, end: { x: W - M, y: y - 18 }, thickness: 0.6, color: INK3, dashArray: [1.5, 2] });
      text("Not signed yet", sx, y - 29, 8.5, font, INK3);
    }
    y -= sigH;
    hair(y);
  }

  return doc.save();
}

/** Saves PDF bytes as a download. */
export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
