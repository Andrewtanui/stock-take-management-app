// Noto Sans for the Hub's PDFs (Level 1 summary, Level 2 reconciliation), the same face as the
// apps. Latin Regular and Bold, built into the bundle (as the logo is) so the player and the
// server engine never fetch a file. SIL Open Font License: src/assets/fonts/OFL-LICENSE.txt.
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import regularUrl from "../assets/fonts/noto-sans-400.woff?inline";
import boldUrl from "../assets/fonts/noto-sans-700.woff?inline";

const bytes = (dataUrl: string) => {
  const bin = atob(dataUrl.split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Embeds Noto Sans Regular and Bold (only the characters used). */
export async function notoSans(doc: PDFDocument): Promise<{ font: PDFFont; bold: PDFFont }> {
  doc.registerFontkit(fontkit);
  const [font, bold] = await Promise.all([doc.embedFont(bytes(regularUrl), { subset: true }), doc.embedFont(bytes(boldUrl), { subset: true })]);
  return { font, bold };
}

const charsets = new WeakMap<PDFFont, Set<number>>();
/** Text the font can draw: a character it has no glyph for becomes "?", never an empty box. */
export function safeText(t: string, f: PDFFont) {
  let cs = charsets.get(f);
  if (!cs) charsets.set(f, (cs = new Set(f.getCharacterSet())));
  return [...t].map((ch) => (cs.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}
