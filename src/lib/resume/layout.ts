import type { LayoutFlags } from "@/lib/schemas";

/**
 * FR-34: layout that screening software reads badly, found while the uploaded file is in memory. Only counts and
 * yes/no flags come out of here; no text of the resume is returned or kept.
 */

/* Word (.docx) ------------------------------------------------------------ */

/** The parts of a .docx archive the layout check reads. */
export const isLayoutPart = (name: string) => name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name);

/**
 * Word writes a drawing twice, a modern version and a fallback for old readers (mc:AlternateContent). Only the modern
 * one counts, or every text box and picture would count twice.
 */
const withoutFallbacks = (xml: string) => xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");

const countOf = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

/** The visible text of a Word part, joined: the w:t runs only, so field codes (PAGE, NUMPAGES) are left out. */
function runText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) out += m[1];
  return out;
}

/** "Page 1 of 2", "1", "- 2 -": a page number, which software skipping the footer loses nothing by. */
const pageNumberOnly = (text: string) => /^[\s\d\-–/|.]*(?:page|pg\.?|of|[\s\d\-–/|.])*$/i.test(text);

/** Layout flags of a .docx from its main document and its header and footer parts (by part name). */
export function docxLayout(parts: ReadonlyMap<string, string>): LayoutFlags {
  let tables = 0;
  let images = 0;
  let textBoxes = 0;
  let columns = false;
  let headerFooterText = false;
  for (const [name, raw] of parts) {
    const xml = withoutFallbacks(raw);
    // Pictures: DrawingML pictures (a:blip) and old VML ones (v:imagedata).
    images += countOf(xml, /<a:blip\b/g) + countOf(xml, /<v:imagedata\b/g);
    if (name === "word/document.xml") {
      tables += countOf(xml, /<w:tbl>|<w:tbl\s/g);
      textBoxes += countOf(xml, /<w:txbxContent\b/g);
      // Newspaper columns: a section with w:num of 2 or more.
      columns = [...xml.matchAll(/<w:cols\b[^>]*\bw:num="(\d+)"/g)].some((m) => Number(m[1]) >= 2);
    } else {
      if (!pageNumberOnly(runText(xml))) headerFooterText = true;
    }
  }
  return { fileType: "docx", tables, columns, images, textBoxes, headerFooterText };
}

/* PDF ------------------------------------------------------------------------ */

/** A piece of text on a PDF page: where it starts (x, y in points from the bottom left) and how wide it is. */
export type PlacedText = { x: number; y: number; width: number };

/** Pieces closer than this (points) belong to one run of text; a word space is about 3. */
const RUN_GAP = 12;
/** Lines this close (points) in height are the same line. */
const LINE_TOLERANCE = 2;
/** Starts within this many points count as one column edge. */
const EDGE_TOLERANCE = 6;
/** How many lines must start a second run at the same edge before we say the page is set in columns. */
const MIN_COLUMN_LINES = 5;

/**
 * True when a page sets text side by side: many lines start a run of text at the same place in the middle of the page,
 * after a wide gap or with nothing to its left. That is a two-column layout, a sidebar or a table; screening software
 * reads such lines straight across and mixes the two. Right-aligned dates start past 70% of the width, and indented
 * bullets before 20%, so neither counts. A centred heading or two can't reach the line count.
 */
export function pageSetInColumns(items: readonly PlacedText[], pageWidth: number): boolean {
  if (pageWidth <= 0 || items.length === 0) return false;
  // Lines, top to bottom, each a list of runs left to right.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PlacedText[][] = [];
  for (const it of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - it.y) <= LINE_TOLERANCE) line.push(it);
    else lines.push([it]);
  }
  const left = Math.min(...items.map((i) => i.x));
  const lo = pageWidth * 0.2;
  const hi = pageWidth * 0.7;
  const starts: number[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let end = -Infinity;
    for (const it of line) {
      const gap = it.x - end;
      // A run starting in the middle band, after a wide gap or as the line's first run well right of the left margin.
      if (it.x >= lo && it.x <= hi && (gap >= RUN_GAP * 1.5 || (end === -Infinity && it.x - left >= RUN_GAP * 3))) starts.push(it.x);
      if (gap > RUN_GAP || end === -Infinity) end = it.x + it.width;
      else end = Math.max(end, it.x + it.width);
    }
  }
  // The most common edge, within the tolerance.
  starts.sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < starts.length; i++) {
    while (starts[i] - starts[j] > EDGE_TOLERANCE) j++;
    best = Math.max(best, i - j + 1);
  }
  return best >= MIN_COLUMN_LINES && best >= lines.length * 0.25;
}

/** Layout flags of a PDF from each page's placed text and how many images each page paints. */
export function pdfLayout(pages: readonly { items: readonly PlacedText[]; width: number; images: number }[]): LayoutFlags {
  return {
    fileType: "pdf",
    tables: null,
    columns: pages.some((p) => pageSetInColumns(p.items, p.width)),
    images: pages.reduce((sum, p) => sum + p.images, 0),
    textBoxes: null,
    headerFooterText: null,
  };
}
