import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { layoutFlags } from "@/lib/schemas";
import { extractResumeText } from "./extract";
import { docxLayout, pageSetInColumns, type PlacedText } from "./layout";

// Synthetic resumes only (CLAUDE.md): made up here, in memory, never from a real person.
const LINES = [
  "Asha Example",
  "Data Analyst",
  "SUMMARY",
  "Data analyst with three years of experience in retail sales reporting and dashboards.",
  "EXPERIENCE",
  "Data Analyst, Example Retail Pvt Ltd, Pune (Jun 2022 - Present)",
  "- Wrote SQL queries for weekly sales reports across 40 stores",
  "- Built Excel dashboards with pivot tables for regional managers",
  "- Cleaned duplicate customer records, cutting report errors by 15%",
  "EDUCATION",
  "B.Com, Example University, 2021",
  "SKILLS",
  "SQL, Excel, Python, Power BI",
];

/** A 2x2 PNG, so the picture tests need no file. */
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 0, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function pdf({ twoColumns = false, image = false } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 800;
  for (const line of LINES) {
    page.drawText(line, { x: 50, y, size: 10, font });
    y -= 18;
  }
  if (twoColumns) {
    // A sidebar of skills and contact lines beside the main text, as two-column templates do.
    for (let i = 0; i < 10; i++) page.drawText(`Sidebar item ${i + 1}`, { x: 330, y: 800 - i * 18, size: 10, font });
  }
  if (image) {
    const img = await doc.embedPng(png());
    page.drawImage(img, { x: 480, y: 760, width: 60, height: 60 });
  }
  return doc.save();
}

async function docx({ table = false, header = false, pageNumberFooter = false, image = false, columns = false } = {}): Promise<Uint8Array> {
  const body: (Paragraph | Table)[] = LINES.map((t) => new Paragraph({ children: [new TextRun(t)] }));
  if (table) {
    const cell = (t: string) => new TableCell({ children: [new Paragraph(t)] });
    body.push(new Table({ rows: [new TableRow({ children: [cell("SQL"), cell("Excel")] }), new TableRow({ children: [cell("Python"), cell("Power BI")] })] }));
  }
  if (image) body.push(new Paragraph({ children: [new ImageRun({ type: "png", data: png(), transformation: { width: 40, height: 40 } })] }));
  const doc = new Document({
    sections: [
      {
        properties: columns ? { column: { count: 2, space: 708 } } : {},
        headers: header ? { default: new Header({ children: [new Paragraph("asha@example.com | +91 90000 00000")] }) } : undefined,
        footers: pageNumberFooter
          ? { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ["Page ", PageNumber.CURRENT] })] })] }) }
          : undefined,
        children: body,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe("layout found at upload (FR-34)", () => {
  it("finds nothing in a plain one-column PDF", async () => {
    const { layout } = await extractResumeText(await pdf());
    expect(layout).toEqual({ fileType: "pdf", tables: null, columns: false, images: 0, textBoxes: null, headerFooterText: null });
    expect(layoutFlags.parse(layout)).toEqual(layout);
  });

  it("finds a two-column PDF and its picture", async () => {
    const { layout } = await extractResumeText(await pdf({ twoColumns: true, image: true }));
    expect(layout).toMatchObject({ columns: true, images: 1 });
  });

  it("finds nothing in a plain Word file", async () => {
    const { layout } = await extractResumeText(await docx());
    expect(layout).toEqual({ fileType: "docx", tables: 0, columns: false, images: 0, textBoxes: 0, headerFooterText: false });
  });

  it("finds a Word table, header text, a picture and newspaper columns", async () => {
    const { layout } = await extractResumeText(await docx({ table: true, header: true, image: true, columns: true }));
    expect(layout).toEqual({ fileType: "docx", tables: 1, columns: true, images: 1, textBoxes: 0, headerFooterText: true });
  });

  it("doesn't count a footer that only numbers the pages", async () => {
    const { layout } = await extractResumeText(await docx({ pageNumberFooter: true }));
    expect(layout?.headerFooterText).toBe(false);
  });

  it("keeps no resume text in the flags", async () => {
    const { layout } = await extractResumeText(await docx({ table: true, header: true }));
    const stored = JSON.stringify(layout);
    for (const word of ["Asha", "SQL", "example.com", "90000"]) expect(stored).not.toContain(word);
  });

  it("reads the sample resumes as one column with no pictures", async () => {
    for (const name of ["priya-sharma.pdf", "priya-sharma.docx"]) {
      const { layout } = await extractResumeText(new Uint8Array(readFileSync(`fixtures/resumes/${name}`)));
      expect(layout, name).toMatchObject({ columns: false, images: 0 });
    }
  });

  it("has no layout for pasted text", async () => {
    const { layout } = await extractResumeText(new TextEncoder().encode(LINES.join("\n").repeat(3)), "text");
    expect(layout).toBeNull();
  });
});

describe("docxLayout", () => {
  it("counts a text box once, not again in Word's fallback copy", () => {
    const xml =
      '<w:document><w:body><mc:AlternateContent><mc:Choice><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Skills</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>' +
      "<mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>Skills</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:body></w:document>";
    expect(docxLayout(new Map([["word/document.xml", xml]])).textBoxes).toBe(1);
  });

  it("reads one column as one column", () => {
    const xml = '<w:document><w:body><w:sectPr><w:cols w:num="1" w:space="708"/></w:sectPr></w:body></w:document>';
    expect(docxLayout(new Map([["word/document.xml", xml]])).columns).toBe(false);
  });
});

describe("pageSetInColumns", () => {
  const line = (x: number, y: number, width = 200): PlacedText => ({ x, y, width });
  const body = Array.from({ length: 30 }, (_, i) => line(50, 800 - i * 14, 480));

  it("ignores right-aligned dates", () => {
    const dated = [...body, ...Array.from({ length: 8 }, (_, i) => line(470, 800 - i * 56, 70))];
    expect(pageSetInColumns(dated, 595)).toBe(false);
  });

  it("ignores indented bullets and a centred name", () => {
    const page = [...body, ...Array.from({ length: 10 }, (_, i) => line(70, 380 - i * 14, 400)), line(250, 830, 95)];
    expect(pageSetInColumns(page, 595)).toBe(false);
  });

  it("finds a column of text beside the main one", () => {
    const page = [...body.map((b) => ({ ...b, width: 230 })), ...Array.from({ length: 12 }, (_, i) => line(320, 800 - i * 14, 200))];
    expect(pageSetInColumns(page, 595)).toBe(true);
  });

  it("finds a sidebar whose lines don't line up with the main text", () => {
    const page = [...Array.from({ length: 12 }, (_, i) => line(40, 805 - i * 17, 140)), ...Array.from({ length: 30 }, (_, i) => line(210, 800 - i * 14, 330))];
    expect(pageSetInColumns(page, 595)).toBe(true);
  });
});
