import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ResumeDocument, ResumeEntry } from "@/lib/schemas";

// A4 in points. One column with real text (no images, tables or text boxes), so screening software reads it in order.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const WIDTH = PAGE.width - 2 * MARGIN;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.35, 0.36, 0.4);

/** Geist, embedded so names, ₹ and accented letters print as written. Read once per server. */
let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
function fontBytes() {
  const dir = path.join(process.cwd(), "assets", "fonts");
  // A failed read isn't kept, so the next download tries again rather than failing until a cold start.
  fonts ??= Promise.all([readFile(path.join(dir, "Geist-Regular.ttf")), readFile(path.join(dir, "Geist-SemiBold.ttf"))]).catch((err) => {
    fonts = null;
    throw err;
  });
  return fonts;
}

/** Splits text into lines that fit `width`, breaking a word only when it is longer than a whole line. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Thrown when the resume has letters the embedded font can't draw, such as Hindi or Tamil script: pdf-lib would print
 * them as blanks without a word. The Word file has no such limit, so the person is pointed there.
 */
export class UnprintableTextError extends Error {
  constructor() {
    super("unprintable_text");
    this.name = "UnprintableTextError";
  }
}

const allText = (doc: ResumeDocument): string[] => [
  doc.name ?? "",
  doc.headline ?? "",
  ...doc.sections.flatMap((s) =>
    s.kind === "list" ? [s.heading, ...s.items] : [s.heading, ...s.entries.flatMap((e) => [e.title, e.subtitle, e.dates, ...e.bullets])],
  ),
];

/** FR-20: the resume as a PDF. Throws UnprintableTextError rather than print blanks. */
export async function renderResumePdf(doc: ResumeDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await fontBytes();
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const printable = new Set(regular.getCharacterSet());
  const missing = allText(doc).some((line) => [...line].some((ch) => !/\s/.test(ch) && !printable.has(ch.codePointAt(0)!)));
  if (missing) throw new UnprintableTextError();
  pdf.setTitle(doc.name ? `${doc.name} – Resume` : "Resume");
  pdf.setProducer("CareerMetro");
  pdf.setCreator("CareerMetro");

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const ensure = (height: number) => {
    if (y - height >= MARGIN) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };
  const text = (value: string, opts: { font: PDFFont; size: number; x?: number; color?: typeof INK; gap?: number }) => {
    const x = opts.x ?? MARGIN;
    const lineHeight = opts.size * 1.35;
    for (const line of wrap(value, opts.font, opts.size, PAGE.width - MARGIN - x)) {
      ensure(lineHeight);
      y -= lineHeight;
      page.drawText(line, { x, y: y + opts.size * 0.25, size: opts.size, font: opts.font, color: opts.color ?? INK });
    }
    y -= opts.gap ?? 0;
  };

  text(doc.name ?? "Your name", { font: bold, size: 20, gap: 2 });
  if (doc.headline) text(doc.headline, { font: regular, size: 10.5, color: MUTED });

  const entry = (item: ResumeEntry) => {
    // Title and dates share a line when they fit; otherwise the dates go under the title.
    const dateWidth = item.dates ? regular.widthOfTextAtSize(item.dates, 9.5) : 0;
    const titleFits = bold.widthOfTextAtSize(item.title, 10.5) + dateWidth + 12 <= WIDTH;
    ensure(10.5 * 1.35 * 2);
    if (titleFits) {
      text(item.title, { font: bold, size: 10.5 });
      if (item.dates) page.drawText(item.dates, { x: MARGIN + WIDTH - dateWidth, y: y + 10.5 * 0.25, size: 9.5, font: regular, color: MUTED });
    } else {
      text(item.title, { font: bold, size: 10.5 });
      if (item.dates) text(item.dates, { font: regular, size: 9.5, color: MUTED });
    }
    if (item.subtitle) text(item.subtitle, { font: regular, size: 10, color: MUTED });
    for (const bullet of item.bullets) {
      ensure(10 * 1.35);
      page.drawText("•", { x: MARGIN + 4, y: y - 10 * 1.35 + 10 * 0.25, size: 10, font: regular, color: INK });
      text(bullet, { font: regular, size: 10, x: MARGIN + 14 });
    }
    y -= 6;
  };

  for (const section of doc.sections) {
    y -= 12;
    ensure(11 * 1.35 + 8 + 10.5 * 1.35 * 2);
    text(section.heading.toUpperCase(), { font: bold, size: 10, gap: 3 });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.6, color: MUTED });
    y -= 5;
    if (section.kind === "entries") section.entries.forEach(entry);
    else if (section.heading === "Skills") text(section.items.join(", "), { font: regular, size: 10 });
    else for (const item of section.items) text(item, { font: regular, size: 10, gap: 1 });
  }

  return pdf.save();
}
