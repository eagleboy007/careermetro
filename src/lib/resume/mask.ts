/** SEC-6: contact details and IDs are replaced before resume text is sent to the model. The name and city stay. */

export type MaskCounts = { email: number; phone: number; address: number; profileUrl: number; id: number; dateOfBirth: number };

// Bounded runs keep a long string with no spaces from making this slow.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s|,;)]+/gi;
const DATE_OF_BIRTH = /\b(?:DOB|D\.O\.B\.?|Date of Birth)\b\s*[:\-–]?\s*[^\n|]{4,30}?(?=\s*(?:\||\n|$))/gi;
const AADHAAR = /(?<![+\d])\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;
const AADHAAR_LABELLED = /(\b(?:aadhaa?r|uid)\b(?:\s?(?:no\.?|number))?\s?[:\-]?\s?)\d{4}[ -]?\d{4}[ -]?\d{4}\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/** Separators people and PDF exports put between digit groups, en and em dashes included. */
const SEP = "[\\s().\\u2013\\u2014-]";
/**
 * Indian mobiles in any common grouping ("+91 98765 43210", "987-654-3210", "+91 (987) 654-3210", "98765 - 43210",
 * "0091 98765 43210"), landlines with an STD code in brackets, and international numbers starting with +. A mobile is
 * exactly 10 digits starting with 6-9, so years, amounts and percentages don't match.
 */
const PHONE = new RegExp(
  [
    // "98765 - 43210" only with a +91 or 0 in front, or a phone label before it, so "60000 - 80000" stays a salary range.
    `(?<![\\d+])(?:(?:\\+\\s?|00)91${SEP}{0,2}|0)\\(?[6-9]\\d{4}\\s?[-\\u2013\\u2014]\\s?\\d{5}(?!\\d)`,
    `(?<=\\b(?:ph|phone|mob|mobile|tel|contact|whatsapp|cell)\\b[^\\d\\n]{0,12})[6-9]\\d{4}\\s?[-\\u2013\\u2014]\\s?\\d{5}(?!\\d)`,
    // Not after a money word, so "Salary range 70000–90000" stays.
    `(?<![\\d+])(?<!\\b(?:salary|range|ctc|budget|stipend|rs\\.?|inr|usd|\\u20b9|\\$)[^\\d\\n]{0,12})(?:(?:\\+\\s?|00)91${SEP}{0,2}|91${SEP}{1,2}|0)?\\(?[6-9](?:${SEP}{0,2}\\d){9}(?!\\d)`,
    `\\(0\\d{2,4}\\)\\s?\\d{3,4}[\\s-]?\\d{4}\\b`,
    `\\+(?!\\s?91)\\d{1,3}[\\s-]?\\d{2,4}[\\s-]?\\d{3,4}[\\s-]?\\d{3,4}\\b`,
  ].join("|"),
  "gi",
);
/**
 * Landlines with an STD code: "022-23456789", "011-2345-6789", "+91 (22) 2345 6789", "0091-22-2345-6789". The code
 * starts 1-8 and the number has 10 digits after the 0 or +91, so a year range like "2019-2023" never matches.
 */
const LANDLINE = new RegExp(
  `(?<![\\d+])(?:(?:\\+\\s?|00)91${SEP}{0,2}0?|\\(?0)\\(?[1-8]\\d{1,3}\\)?(?:\\s?[-\\u2013\\u2014.)]\\s?|\\s)?\\d{2,4}${SEP}?\\d{3,4}(?!\\d)`,
  "g",
);
const landlineDigits = (match: string) =>
  match
    .replace(/^(?:\+\s?|00)91/, "")
    .replace(/\D/g, "")
    .replace(/^0/, "").length === 10;
const PIN_CODE = /\b[1-9]\d{2}\s?\d{3}\b/;
/**
 * A PIN code that follows a place name and ends the line, or is followed only by a state or "India": "Kothrud Pune
 * 411038", "Infosys, Pune, 411057", "Mumbai - 400 069, Maharashtra". The place is a capitalised word after a comma or
 * another capitalised word (or a state code after a comma), so "CTC 650000", "Handled 120000" keep their numbers.
 */
const PLACE_PIN =
  /(?<=(?:,\s*(?:\p{Lu}\p{Ll}{2,}|[A-Z]{2})|\b\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}{2,})\s*[,\-–]?\s*)\b[1-9]\d{2}\s?\d{3}(?=\s*(?:,\s*(?:India|\p{Lu}\p{Ll}+(?:\s\p{Lu}\p{Ll}+)?)\s*)?\.?\s*$)/u;
/** Words that make a line an address line when it also ends in a place and a PIN. */
const ADDRESS_WORDS =
  /\b(?:flat|house no|h\.?\s?no|plot|apartment|apts?|residency|society|chs|tower|wing|floor|street|st\.|road|rd\.|lane|marg|nagar|colony|sector|phase|layout|cross|near|opp\.?|behind|peth|ward|village|vill\.?|dist\.?|district|tehsil|taluka|tal\b\.?|mandal|at post|p\.\s?o\.?)\b/i;
/** A flat or house number opening the line ("B-204,", "14,", "12/3A,"), never a year or a code like "S3,". */
const HOUSE_START = /^\s*(?:[A-Za-z]{1,2}[-/])?(?!(?:19|20)\d{2}\b)\d{1,4}(?:[-/]\d{1,4})*[A-Za-z]?\s*,/;
/**
 * Lines that say they are an address: "Address:", "Res. Address -", "Permanent Address 14 ...". Only these qualifiers,
 * and a colon or a spaced dash, so "Address-lookup API" or "Memory Address:" stay.
 */
const ADDRESS_LABEL =
  /^\s{0,8}(?:[-•*]\s{0,3})?(?:(?:res\.?|residential|permanent|current|present|correspondence|communication|postal|home|mailing|contact|local)\s+)?(?:address|addr\.?)\s?(?::|\s[-–]\s|[-–]\s*$)|^\s{0,8}(?:permanent|current|present|residential|postal|home|mailing)\s+address\s+(?=\d)/i;
/** A guardian the way Indian addresses name one: "C/o Ramesh Rao, ..." or "S/O Ramesh Rao 14 ...". */
const GUARDIAN = /^\s*[CSDW]\/[Oo]\.?\s*[:\-]?\s*(?:(?:Mr|Mrs|Ms|Shri|Smt|Late)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z.]*){0,3}\s*(?:,|\d)/;
/** A label line with nothing after it starts a block: the next few lines are the address. */
const LABEL_ONLY = /[:\-–]\s*$/;
const ADDRESS_BLOCK_LINES = 4;
const SECTION_NAME =
  /^\s*(?:experience|work experience|employment|summary|profile|objective|education|skills|technical skills|projects|certifications?|achievements|languages|personal details|contact|about me)\s*:?\s*$/i;
/** Address lines are only looked for in the contact block at the top, unless the line carries a PIN code. */
const HEADER_LINES = 8;

function replaceCounting(text: string, pattern: RegExp, replacement: string, onHit: () => void): string {
  return text.replace(pattern, () => {
    onHit();
    return replacement;
  });
}

/** Aadhaar numbers carry a Verhoeff check digit, so a row of years or a phone-like run rarely passes. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  [...digits].reverse().forEach((d, i) => (c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(d)]]));
  return c === 0;
}

function isAddressLine(line: string, index: number): boolean {
  // Capped, so a line of thousands of spaces from a PDF can't make the label check slow.
  const head = line.slice(0, 300);
  if (ADDRESS_LABEL.test(head) || GUARDIAN.test(head)) return true;
  if (line.length === 0 || line.length > 140 || /^[-•*]/.test(line)) return false;
  // A PIN code marks a whole address line only with an address word or a house number; elsewhere just the PIN goes.
  const hasPin = (ADDRESS_WORDS.test(line) || HOUSE_START.test(line)) && PLACE_PIN.test(line);
  const headerAddress = index < HEADER_LINES && ADDRESS_WORDS.test(line) && /\d/.test(line);
  return hasPin || headerAddress;
}

/**
 * Whether a line under an "Address:" label is still the address: short, not a heading or a dated line, and carrying a
 * comma, a number or an address word. A short line with none of those (a city) is the last line of the block.
 */
function blockLine(line: string): "more" | "last" | "end" {
  const t = line.trim();
  if (!t || t.length > 80 || SECTION_NAME.test(t) || /^[A-Z][A-Z &/]{2,}:?$/.test(t) || /:\s*$/.test(t)) return "end";
  if (/\b(?:19|20)\d{2}\b|@|\b(?:present|till date)\b/i.test(t)) return "end";
  if (/[,\d]/.test(t) || ADDRESS_WORDS.test(t)) return "more";
  return t.split(/\s+/).length <= 2 ? "last" : "end";
}

export function maskPii(input: string): { text: string; counts: MaskCounts } {
  const counts: MaskCounts = { email: 0, phone: 0, address: 0, profileUrl: 0, id: 0, dateOfBirth: 0 };

  const source = input.split("\n");
  const lines: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    if (isAddressLine(line, i)) {
      counts.address++;
      lines.push("[ADDRESS]");
      // "Address:" alone on its line: the address follows on the next few lines, up to a blank line or heading.
      if (LABEL_ONLY.test(line.slice(0, 300)) && ADDRESS_LABEL.test(line.slice(0, 300))) {
        for (let k = 0; k < ADDRESS_BLOCK_LINES && i + 1 < source.length; k++) {
          const kind = blockLine(source[i + 1]);
          if (kind === "end") break;
          i++;
          counts.address++;
          lines.push("[ADDRESS]");
          if (kind === "last" || PIN_CODE.test(source[i])) break;
        }
      }
    } else if (line.length <= 300 && PLACE_PIN.test(line)) {
      // Keep the line (it may name a job or a skill) and drop only the PIN code.
      counts.address++;
      lines.push(line.replace(PLACE_PIN, "[PIN]"));
    } else {
      lines.push(line);
    }
  }

  let text = lines.join("\n");
  text = replaceCounting(text, EMAIL, "[EMAIL]", () => counts.email++);
  text = replaceCounting(text, PROFILE_URL, "[PROFILE URL]", () => counts.profileUrl++);
  text = replaceCounting(text, DATE_OF_BIRTH, "[DATE OF BIRTH]", () => counts.dateOfBirth++);
  text = replaceCounting(text, PAN, "[ID]", () => counts.id++);
  // After an Aadhaar label the number goes whatever its check digit, so a typo can't leak a real number.
  text = text.replace(AADHAAR_LABELLED, (_, label: string) => {
    counts.id++;
    return `${label}[ID]`;
  });
  text = text.replace(AADHAAR, (match) => {
    if (!verhoeffValid(match.replace(/\D/g, ""))) return match;
    counts.id++;
    return "[ID]";
  });
  text = text.replace(LANDLINE, (match) => {
    if (!landlineDigits(match)) return match;
    counts.phone++;
    return "[PHONE]";
  });
  text = replaceCounting(text, PHONE, "[PHONE]", () => counts.phone++);
  return { text, counts };
}
