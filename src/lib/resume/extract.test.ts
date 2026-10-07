import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { maskPii } from "./mask";
import { checkDocxArchive, detectResumeType, extractResumeText, MAX_RESUME_BYTES, ResumeError } from "./extract";

const file = (name: string) => new Uint8Array(readFileSync(`fixtures/resumes/${name}`));

/** Builds a minimal deflated ZIP. `declare` overrides the uncompressed size written in the archive. */
function zip(entries: { name: string; data: Buffer; declare?: number }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, declare } of entries) {
    const body = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const size = declare ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

describe("detectResumeType", () => {
  it("reads the type from the bytes, not the file name", () => {
    expect(detectResumeType(file("priya-sharma.pdf"))).toBe("pdf");
    expect(detectResumeType(file("priya-sharma.docx"))).toBe("docx");
    expect(detectResumeType(new TextEncoder().encode("MZ\x90\x00 not a resume"))).toBeNull();
  });
});

describe("extractResumeText", () => {
  it.each(["priya-sharma.pdf", "priya-sharma.docx"])("extracts text from %s", async (name) => {
    const { text, type } = await extractResumeText(file(name));
    expect(type).toBe(name.split(".").pop());
    expect(text).toContain("Wrote SQL queries for weekly sales reports across 40 stores");
    expect(text).toContain("Google Data Analytics Professional Certificate");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it.each(["priya-sharma.pdf", "priya-sharma.docx"])("leaves no contact details in %s after masking", async (name) => {
    const { text } = maskPii((await extractResumeText(file(name))).text);
    for (const secret of ["98765", "@gmail.com", "411045", "Lotus Residency", "linkedin.com"]) expect(text).not.toContain(secret);
    expect(text).toContain("Priya Sharma");
  });

  it("rejects files over 5 MB", async () => {
    await expect(extractResumeText(new Uint8Array(MAX_RESUME_BYTES + 1))).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses a DOCX that unpacks to far more than any resume (zip bomb)", async () => {
    const bomb = zip([{ name: "word/document.xml", data: Buffer.alloc(20 * 1024 * 1024, 0x20) }]);
    expect(bomb.length).toBeLessThan(100_000);
    expect(detectResumeType(bomb)).toBe("docx");
    await expect(extractResumeText(bomb)).rejects.toMatchObject({ code: "unreadable" });
  });

  it("refuses a DOCX whose declared sizes understate what it unpacks to", () => {
    const liar = zip([{ name: "word/document.xml", data: Buffer.alloc(2 * 1024 * 1024, 0x20), declare: 1000 }]);
    expect(() => checkDocxArchive(liar)).toThrow(ResumeError);
  });

  it("accepts a real DOCX archive", () => {
    expect(() => checkDocxArchive(file("priya-sharma.docx"))).not.toThrow();
    const small = zip([{ name: "word/document.xml", data: Buffer.from("<w:document/>") }]);
    expect(() => checkDocxArchive(small)).not.toThrow();
  });

  it("rejects other file types", async () => {
    await expect(extractResumeText(new TextEncoder().encode("GIF89a"))).rejects.toBeInstanceOf(ResumeError);
    await expect(extractResumeText(new TextEncoder().encode("GIF89a"))).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects a file with almost no text, such as a scanned image", async () => {
    await expect(extractResumeText(new TextEncoder().encode("Short"), "text")).rejects.toMatchObject({ code: "too_little_text" });
  });

  it("accepts pasted text", async () => {
    const pasted = readFileSync("fixtures/resumes/priya-sharma.txt", "utf8");
    const { text, type } = await extractResumeText(new TextEncoder().encode(pasted), "text");
    expect(type).toBe("text");
    expect(text).toContain("Priya Sharma");
  });
});
