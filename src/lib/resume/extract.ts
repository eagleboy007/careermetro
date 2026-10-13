import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { inflateRawSync } from "node:zlib";
import type { LayoutFlags } from "@/lib/schemas";
import { docxLayout, isLayoutPart, pdfLayout, type PlacedText } from "./layout";

/** FR-4: uploads above this size are refused before any parsing. 4 MB, because Vercel functions accept request bodies up to 4.5 MB. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
/** A PDF that takes longer than this to read is refused, so one crafted file can't hold a function for its whole run. */
export const PDF_TIME_LIMIT_MS = 15_000;
const MIN_TEXT_CHARS = 200;
const MAX_TEXT_CHARS = 40_000;

export type ResumeType = "pdf" | "docx" | "text";

export type ResumeErrorCode = "too_large" | "unsupported_type" | "too_many_pages" | "too_little_text" | "too_much_text" | "too_slow" | "unreadable";

/** A problem the user can fix, such as a scanned PDF. The message is safe to show and never contains resume text. */
export class ResumeError extends Error {
  constructor(
    readonly code: ResumeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResumeError";
  }
}

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

/** Identifies a PDF or DOCX from its first bytes. The browser's MIME type and the file name are not trusted. */
export function detectResumeType(bytes: Uint8Array): "pdf" | "docx" | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A ZIP; DOCX files carry word/document.xml in the central directory near the end.
    const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 64 * 1024)));
    if (tail.includes("word/document.xml")) return "docx";
  }
  return null;
}

/** Collapses the layout noise PDF and DOCX extraction leaves behind, keeping one blank line between sections. */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reads a PDF's text, giving up after `limitMs`, and the upload gets a message it can act on. The limit is best
 * effort: pdf.js works in small async steps, so the timer gets its turn, but one long synchronous step can delay it.
 * On timeout the document is destroyed, which stops page-by-page text extraction. A document still loading carries
 * on until it has loaded and is destroyed then; unpdf hides the loading task until that point, and calling pdf.js
 * directly would mean copying unpdf's Node font and cmap settings.
 */
export async function pdfText(bytes: Uint8Array, limitMs = PDF_TIME_LIMIT_MS): Promise<string> {
  return (await readPdf(bytes, limitMs)).text;
}

/**
 * The layout of each page (FR-34): where text sits and how many images are painted. A failure here never fails the
 * upload; the layout is then unknown (null) and the page asks for the file again to check it.
 */
async function pdfPageLayout(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, isCancelled: () => boolean): Promise<LayoutFlags | null> {
  try {
    const { OPS } = await getResolvedPDFJS();
    const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
    const pages: { items: PlacedText[]; width: number; images: number }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (isCancelled()) return null;
      const page = await pdf.getPage(n);
      const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const items: PlacedText[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        items.push({ x: item.transform[4], y: item.transform[5], width: item.width });
      }
      const [x0, , x1] = page.view;
      pages.push({ items, width: x1 - x0, images: ops.fnArray.filter((op) => imageOps.has(op)).length });
    }
    return pdfLayout(pages);
  } catch {
    return null;
  }
}

async function readPdf(bytes: Uint8Array, limitMs = PDF_TIME_LIMIT_MS): Promise<{ text: string; layout: LayoutFlags | null }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    pdf = await getDocumentProxy(bytes);
    if (timedOut) throw unreadable();
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ResumeError("too_many_pages", `Resumes can be up to ${MAX_PDF_PAGES} pages. Please upload a shorter file.`);
    }
    const { text } = await extractText(pdf, { mergePages: false });
    const layout = await pdfPageLayout(pdf, () => timedOut);
    return { text: text.join("\n\n"), layout };
  })();
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ResumeError("too_slow", "This PDF took too long to read. Try saving it again as PDF, or paste the text instead."));
    }, limitMs);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
    // Free the document now. One that finishes loading after a timeout stops at the timedOut check and is freed then.
    void pdf?.loadingTask.destroy();
    void work.catch(() => {}).finally(() => (timedOut ? pdf?.loadingTask.destroy() : undefined));
  }
}

/** Zip-bomb limits for DOCX files. Real resumes unpack to well under 1 MB of XML. */
const MAX_ZIP_ENTRIES = 1000;
const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 40 * 1024 * 1024;

const unreadable = () => new ResumeError("unreadable", "We couldn't open this file. Try saving it again as PDF, or paste the text instead.");

/**
 * Inflates every entry of a DOCX archive with a hard output cap before mammoth sees it, so a small upload
 * cannot expand into gigabytes. Sizes declared in the archive are checked against the real output, because
 * an attacker can write any number there. ZIP64 archives are refused; Word never needs them for a resume.
 */
export function checkDocxArchive(bytes: Uint8Array): void {
  walkDocxArchive(bytes);
}

/**
 * Checks the archive as `checkDocxArchive` does and returns the inflated entries `want` names (FR-34 reads the
 * document, header and footer parts for layout). Every entry is inflated under the same caps either way.
 */
export function walkDocxArchive(bytes: Uint8Array, want: (name: string) => boolean = () => false): Map<string, Buffer> {
  const wanted = new Map<string, Buffer>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable();

  const entries = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || dirOffset === 0xffffffff || entries > MAX_ZIP_ENTRIES) throw unreadable();

  let total = 0;
  let at = dirOffset;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw unreadable();
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const declared = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) throw unreadable();
    if (declared > MAX_ZIP_ENTRY_BYTES || total + declared > MAX_ZIP_TOTAL_BYTES) throw unreadable();
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw unreadable();

    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    if (data.length !== compressed) throw unreadable();
    let inflated: Buffer;
    if (method === 0) inflated = Buffer.from(data);
    else if (method === 8) {
      try {
        inflated = inflateRawSync(data, { maxOutputLength: Math.min(declared, MAX_ZIP_ENTRY_BYTES) + 1 });
      } catch {
        throw unreadable();
      }
    } else throw unreadable();
    const size = inflated.length;
    if (size !== declared) throw unreadable();
    const name = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (want(name)) wanted.set(name, inflated);

    total += size;
    at = next;
  }
  return wanted;
}

async function readDocx(bytes: Uint8Array): Promise<{ text: string; layout: LayoutFlags | null }> {
  const parts = walkDocxArchive(bytes, isLayoutPart);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  let layout: LayoutFlags | null = null;
  try {
    // Only a file with its main document part is one we can judge.
    if (parts.has("word/document.xml")) layout = docxLayout(new Map([...parts].map(([name, data]) => [name, data.toString("utf8")])));
  } catch {}
  return { text: value, layout };
}

/**
 * Reads the text of an uploaded resume in memory (FR-4). The file itself is never stored.
 * Pass `as: "text"` for pasted text; otherwise the type is detected from the bytes.
 */
export type ExtractedResume = {
  type: ResumeType;
  text: string;
  /** FR-34: the file's layout flags. Null for pasted text, or when the file's layout couldn't be read. */
  layout: LayoutFlags | null;
};

export async function extractResumeText(bytes: Uint8Array, as?: "text"): Promise<ExtractedResume> {
  if (bytes.length > MAX_RESUME_BYTES) {
    throw new ResumeError("too_large", "This file is larger than 4 MB. Please upload a smaller file.");
  }

  let type: ResumeType;
  let raw: string;
  let layout: LayoutFlags | null = null;
  if (as === "text") {
    type = "text";
    raw = new TextDecoder("utf-8").decode(bytes);
  } else {
    const detected = detectResumeType(bytes);
    if (!detected) {
      throw new ResumeError("unsupported_type", "Please upload a PDF or Word (.docx) file, or paste your resume as text.");
    }
    type = detected;
    try {
      ({ text: raw, layout } = detected === "pdf" ? await readPdf(bytes) : await readDocx(bytes));
    } catch (error) {
      if (error instanceof ResumeError) throw error;
      throw new ResumeError("unreadable", "We couldn't open this file. Try saving it again as PDF, or paste the text instead.");
    }
  }

  const text = normalizeResumeText(raw);
  if (text.length < MIN_TEXT_CHARS) {
    throw new ResumeError(
      "too_little_text",
      as === "text"
        ? "That is very short for a resume. Please paste the whole resume, with your experience and skills."
        : "We found almost no text in this file. If it is a scanned image, please paste the text instead.",
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new ResumeError("too_much_text", "This resume is much longer than usual. Please upload a shorter version.");
  }
  return { type, text, layout };
}
