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
    ["Aadhaar: 2345 6789 0124", "Aadhaar: [ID]"],
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

  // Testing's run 1 (T4): Indian address lines the earlier rules let through.
  it.each([
    "B-204, Green Park, Andheri (E), Mumbai - 400 069",
    "C/o Ramesh Rao, Kothrud, Pune 411038",
    "Village Rampur, Post Office Rampur, Dist. Sitapur, UP 261001",
    "Address: 22 Ganesh Peth, Nagpur",
    "Permanent address - 14 Station Road, Kota",
    "S/o Suresh Kumar, Ward 7, Hisar",
  ])("masks the address line %s anywhere in the resume", (line) => {
    const text = ["Asha Rao", "Data Analyst", "", "EXPERIENCE", "Analyst, Example Ltd", "2022", "Notes", "More", "x", line].join("\n");
    expect(maskPii(text).text.split("\n").at(-1)).toBe("[ADDRESS]");
  });

  // T5: landlines and other mobile spellings.
  it.each(["+91 22 2345 6789", "022-23456789", "011-2345-6789", "(022) 2345 6789", "98765 - 43210", "0091 98765 43210", "+91-80-4123-4567"])(
    "masks the phone number %s",
    (phone) => {
      expect(maskPii(`Phone: ${phone} | Pune`).text).toBe("Phone: [PHONE] | Pune");
    },
  );

  it("still leaves ranges, amounts and sentences with numbers alone", () => {
    for (const line of [
      "- Grew revenue 2019-2023 by 35% to Rs 12,00,000",
      "- Cut month-end close from 10 to 6 days across 2021-2022",
      "- Handled 400 000 tickets a year, 98% within SLA",
      "B.Com, Savitribai Phule Pune University, 2021",
    ]) {
      expect(maskPii(line).text).toBe(line);
    }
  });

  // Review of the first fix: more address and phone forms, and lines that must survive.
  const late = (line: string) =>
    ["Asha Rao", "Data Analyst", "", "EXPERIENCE", "Analyst, Example Ltd", "2022", "Notes", "More", "x", line].join("\n");
  const lastLine = (text: string) => maskPii(text).text.split("\n").at(-1);

  it.each([
    "Res. Address: 14 Station Rd, Kota",
    "Correspondence Address: 14 Station Rd, Kota",
    "Communication Address : 14 Station Rd, Kota",
    "Addr: 14 Station Road, Kota",
    "Permanent Address 14 Station Road, Kota",
    "• Address: 14 Station Road, Kota",
    `Address: ${"14 Station Road, ".repeat(10)}Kota`,
  ])("masks the labelled line %s", (line) => {
    expect(lastLine(late(line))).toBe("[ADDRESS]");
  });

  it("masks an address written under its label over several lines", () => {
    const text = ["Asha Rao", "Address:", "14, Shanti Kunj, Gali No. 4", "Laxmi Nagar", "Delhi", "", "EXPERIENCE", "Analyst, Example Ltd"].join("\n");
    expect(maskPii(text).text).toBe(
      ["Asha Rao", "[ADDRESS]", "[ADDRESS]", "[ADDRESS]", "[ADDRESS]", "", "EXPERIENCE", "Analyst, Example Ltd"].join("\n"),
    );
  });

  it("drops only the PIN from a locality line, so a job or skill on it survives", () => {
    expect(lastLine(late("Software Engineer, Infosys, Pune, 411057"))).toBe("Software Engineer, Infosys, Pune, [PIN]");
    expect(lastLine(late("Jan 2019 - Dec 2023, Bengaluru, 560001"))).toBe("Jan 2019 - Dec 2023, Bengaluru, [PIN]");
    expect(lastLine(late("Kothrud Pune 411038"))).toBe("Kothrud Pune [PIN]");
  });

  it.each([
    "Skills: SQL, Excel, Power BI, Tableau, 100000 rows, 250000 rows",
    "AWS Certified Solutions Architect, Credential ID 123456",
    "Built ETL for 12 states, processed 500000 records",
    "Assistant, India Post, Post Office Savings Bank, 2019",
    "C/O Analytics project: built a churn model",
    "Scores: 7 - 8 - 9 - 6 - 7 - 8 - 9 - 6 - 7 - 8",
    "Dates: 2019 2020 2021 2022",
    "Email Address: [EMAIL]",
    "IP address: 10.0.0.1",
  ])("leaves %s alone", (line) => {
    expect(lastLine(late(line))).toBe(line);
  });

  it.each([
    "+91 (22) 2345 6789",
    "0091-22-2345-6789",
    "0091 (22) 2345 6789",
    "02223456789",
    "+91\u201398765\u201343210",
    "91 98765 43210",
    "+91-022-23456789",
  ])("masks the phone number %s with nothing left over", (phone) => {
    expect(maskPii(`Phone: ${phone} | Pune`).text).toBe("Phone: [PHONE] | Pune");
  });

  it("stays fast on a long run with no spaces", () => {
    const started = performance.now();
    maskPii("a".repeat(80_000));
    expect(performance.now() - started).toBeLessThan(500);
  });
});
