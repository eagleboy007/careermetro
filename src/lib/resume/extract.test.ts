import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskPii } from "./mask";
import { detectResumeType, extractResumeText, MAX_RESUME_BYTES, ResumeError } from "./extract";

const file = (name: string) => new Uint8Array(readFileSync(`fixtures/resumes/${name}`));

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

  it("rejects files over 4 MB", async () => {
    await expect(extractResumeText(new Uint8Array(MAX_RESUME_BYTES + 1))).rejects.toMatchObject({ code: "too_large" });
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
