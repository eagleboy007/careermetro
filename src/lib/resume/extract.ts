import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { inflateRawSync } from "node:zlib";

/** FR-4: uploads above this size are refused before any parsing. 4 MB, because Vercel functions accept request bodies up to 4.5 MB. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const MIN_TEXT_CHARS = 200;
const MAX_TEXT_CHARS = 40_000;

export type ResumeType = "pdf" | "docx" | "text";

export type ResumeErrorCode = "too_large" | "unsupported_type" | "too_many_pages" | "too_little_text" | "too_much_text" | "unreadable";

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

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ResumeError("too_many_pages", `Resumes can be up to ${MAX_PDF_PAGES} pages. Please upload a shorter file.`);
  }
  const { text } = await extractText(pdf, { mergePages: false });
  return text.join("\n\n");
}

/** Zip-bomb limits for DOCX files. Real resumes unpack to well under 1 MB of XML. */
const MAX_ZIP_ENTRIES = 1000;
const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 40 * 1024 * 1024;

const unreadable = () =>
  new ResumeError("unreadable", "We couldn't open this file. Try saving it again as PDF, or paste the text instead.");

/**
 * Inflates every entry of a DOCX archive with a hard output cap before mammoth sees it, so a small upload
 * cannot expand into gigabytes. Sizes declared in the archive are checked against the real output, because
 * an attacker can write any number there. ZIP64 archives are refused; Word never needs them for a resume.
 */
export function checkDocxArchive(bytes: Uint8Array): void {
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
    let size: number;
    if (method === 0) size = compressed;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.min(declared, MAX_ZIP_ENTRY_BYTES) + 1 }).length;
      } catch {
        throw unreadable();
      }
    } else throw unreadable();
    if (size !== declared) throw unreadable();

    total += size;
    at = next;
  }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  checkDocxArchive(bytes);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

/**
 * Reads the text of an uploaded resume in memory (FR-4). The file itself is never stored.
 * Pass `as: "text"` for pasted text; otherwise the type is detected from the bytes.
 */
export async function extractResumeText(bytes: Uint8Array, as?: "text"): Promise<{ type: ResumeType; text: string }> {
  if (bytes.length > MAX_RESUME_BYTES) {
    throw new ResumeError("too_large", "This file is larger than 4 MB. Please upload a smaller file.");
  }

  let type: ResumeType;
  let raw: string;
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
      raw = detected === "pdf" ? await pdfText(bytes) : await docxText(bytes);
    } catch (error) {
      if (error instanceof ResumeError) throw error;
      throw new ResumeError("unreadable", "We couldn't open this file. Try saving it again as PDF, or paste the text instead.");
    }
  }

  const text = normalizeResumeText(raw);
  if (text.length < MIN_TEXT_CHARS) {
    throw new ResumeError(
      "too_little_text",
      "We found almost no text in this file. If it is a scanned image, please paste the text instead.",
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new ResumeError("too_much_text", "This resume is much longer than usual. Please upload a shorter version.");
  }
  return { type, text };
}
