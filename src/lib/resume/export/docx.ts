import "server-only";
import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TabStopType, TextRun } from "docx";
import type { ResumeDocument, ResumeEntry } from "@/lib/schemas";

const FONT = "Arial";
const MUTED = "595A66";
// A4 with 2 cm margins, in twentieths of a point; the right tab stop sits on the right margin.
const PAGE = { width: 11906, height: 16838, margin: 1134 };
const RIGHT_TAB = PAGE.width - 2 * PAGE.margin;

const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, bold: opts.bold, size: opts.size ?? 20, color: opts.color });

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: MUTED, space: 2 } },
    children: [run(text.toUpperCase(), { bold: true })],
  });
}

function entry(item: ResumeEntry): Paragraph[] {
  const title = new Paragraph({
    spacing: { before: 120 },
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
    children: [run(item.title, { bold: true, size: 21 }), ...(item.dates ? [run(`\t${item.dates}`, { size: 19, color: MUTED })] : [])],
  });
  const subtitle = item.subtitle ? [new Paragraph({ children: [run(item.subtitle, { color: MUTED })] })] : [];
  const bullets = item.bullets.map((text) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [run(text)] }));
  return [title, ...subtitle, ...bullets];
}

/** FR-20: the resume as a Word file. Real headings and bullets, one column, no tables, so it edits and screens cleanly. */
export async function renderResumeDocx(doc: ResumeDocument): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ children: [run(doc.name ?? "Your name", { bold: true, size: 40 })] }),
    ...(doc.headline ? [new Paragraph({ children: [run(doc.headline, { color: MUTED, size: 21 })] })] : []),
  ];
  for (const section of doc.sections) {
    children.push(heading(section.heading));
    if (section.kind === "entries") children.push(...section.entries.flatMap(entry));
    else if (section.heading === "Skills") children.push(new Paragraph({ children: [run(section.items.join(", "))] }));
    else children.push(...section.items.map((text) => new Paragraph({ spacing: { after: 40 }, children: [run(text)] })));
  }

  const file = new Document({
    title: doc.name ? `${doc.name} – Resume` : "Resume",
    creator: "CareerMetro",
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}
