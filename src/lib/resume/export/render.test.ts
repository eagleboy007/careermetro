import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { extractResumeText } from "@/lib/resume/extract";
import { buildResumeDocument } from "./document";
import { renderResumeDocx } from "./docx";
import { renderResumePdf, UnprintableTextError } from "./pdf";

const NOW = new Date("2026-10-12T12:00:00Z");
const profile: Profile = {
  headline: "Data analyst · ₹ forecasting for retail",
  totalYearsExperience: 3,
  roles: [{ title: "Data Analyst", employer: "Société Example", start: "2023-04", end: null, highlights: ["Built the weekly sales dashboard"] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: [] }, { name: "Power BI", lastUsed: null, evidence: [] }],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2022" }],
  certifications: [{ name: "Google Data Analytics", earned: "2023-02", expires: "none" }],
};
const doc = buildResumeDocument(profile, "Priya Sharma", NOW);

// The test that matters for screening software: our own resume reader gets every line back as text, in order.
const expectedInOrder = [
  "Priya Sharma",
  "₹ forecasting",
  "EXPERIENCE",
  "Data Analyst",
  "Apr 2023 – Present",
  "Société Example",
  "Built the weekly sales dashboard",
  "SKILLS",
  "SQL, Power BI",
  "EDUCATION",
  "B.Com",
  "CERTIFICATIONS",
  "Google Data Analytics (Feb 2023)",
];

function expectInOrder(text: string) {
  let at = 0;
  for (const part of expectedInOrder) {
    const found = text.indexOf(part, at);
    expect(found, `"${part}" after position ${at}`).toBeGreaterThanOrEqual(0);
    at = found + part.length;
  }
}

describe("resume PDF", () => {
  it("reads back as text in order, with the name, ₹ and accents intact", async () => {
    const bytes = await renderResumePdf(doc);
    const { type, text } = await extractResumeText(bytes);
    expect(type).toBe("pdf");
    expectInOrder(text);
  });

  it("runs onto a second page instead of off the bottom", async () => {
    const long = buildResumeDocument(
      { ...profile, roles: Array.from({ length: 12 }, (_, i) => ({ ...profile.roles[0], title: `Role ${i + 1}`, highlights: Array(4).fill("Did a long piece of work that takes up most of a line on the page") })) },
      "Priya Sharma",
      NOW,
    );
    const bytes = await renderResumePdf(long);
    // The reader hands the bytes to pdf.js, which takes them over; read a copy.
    const { text } = await extractResumeText(bytes.slice());
    expect(text).toContain("Role 12");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("asks for a name when the person isn't signed in", async () => {
    const { text } = await extractResumeText(await renderResumePdf({ ...doc, name: null }));
    expect(text).toContain("Your name");
  });
});

describe("letters the PDF font can't draw", () => {
  it("refuses rather than print blanks, and the Word file still has them", async () => {
    const hindi = { ...doc, name: "प्रिया शर्मा" };
    await expect(renderResumePdf(hindi)).rejects.toBeInstanceOf(UnprintableTextError);
    const { text } = await extractResumeText(await renderResumeDocx(hindi));
    expect(text).toContain("प्रिया शर्मा");
  });
});

describe("resume Word file", () => {
  it("reads back as text in order", async () => {
    const bytes = await renderResumeDocx(doc);
    const { type, text } = await extractResumeText(bytes);
    expect(type).toBe("docx");
    expectInOrder(text.replace(/\t/g, " "));
  });
});
