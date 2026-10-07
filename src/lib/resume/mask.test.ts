import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskPii } from "./mask";

const fixture = readFileSync("fixtures/resumes/priya-sharma.txt", "utf8");

describe("maskPii", () => {
  it("masks contact details in the synthetic resume", () => {
    const { text, counts } = maskPii(fixture);
    expect(text).not.toContain("98765");
    expect(text).not.toContain("priya.sharma.example@gmail.com");
    expect(text).not.toContain("411045");
    expect(text).not.toContain("Lotus Residency");
    expect(text).not.toContain("linkedin.com/in/");
    expect(counts).toMatchObject({ email: 1, phone: 1, address: 1, profileUrl: 1 });
  });

  it("keeps everything the analysis needs", () => {
    const { text } = maskPii(fixture);
    for (const kept of [
      "Priya Sharma",
      "Pune, Maharashtra",
      "Wrote SQL queries for weekly sales reports across 40 stores",
      "cutting report errors by 15%",
      "Jun 2022 - Present",
      "B.Com, Savitribai Phule Pune University, 2021",
      "Current CTC 6.5 LPA",
    ]) {
      expect(text).toContain(kept);
    }
  });

  it.each([
    ["+91-98765-43210", "[PHONE]"],
    ["09876543210", "[PHONE]"],
    ["9876543210", "[PHONE]"],
    ["(022) 2345 6789", "[PHONE]"],
    ["+1 415 555 0134", "[PHONE]"],
    ["+91 987-654-3210", "[PHONE]"],
    ["987 654 3210", "[PHONE]"],
    ["+91 98 76 54 32 10", "[PHONE]"],
    ["+91 (987) 654-3210", "[PHONE]"],
    ["9876-543-210", "[PHONE]"],
    ["Mobile: +919876543210", "Mobile: [PHONE]"],
    ["Aadhaar: 2345 6789 0123", "Aadhaar: [ID]"],
    ["PAN ABCDE1234F", "PAN [ID]"],
    ["DOB: 14/03/1998", "[DATE OF BIRTH]"],
    ["Date of Birth - 14 March 1998", "[DATE OF BIRTH]"],
    ["github: github.com/example-dev", "github: github.com/example-dev"],
  ])("masks %s", (input, expected) => {
    expect(maskPii(input).text).toBe(expected);
  });

  it("leaves years, percentages and amounts alone", () => {
    const line = "Grew revenue 2019-2023 by 35% to Rs 12,00,000 across 1200 stores";
    expect(maskPii(line).text).toBe(line);
  });

  it("keeps sentences that happen to contain a six-digit number", () => {
    const line = "- Reduced main database load by 120000 rows per day in phase 2";
    expect(maskPii(["Priya", "", "EXPERIENCE", "Analyst", "Example Ltd", "2022", "Notes", "More", "x", line].join("\n")).text).toContain(line);
  });

  it("only treats header lines as addresses unless they carry a PIN code", () => {
    const body = ["Priya", "Data Analyst", "", "EXPERIENCE", "- Opened 3 stores on MG Road in Bengaluru"].join("\n");
    expect(maskPii(body).text).toContain("MG Road");
  });
});
