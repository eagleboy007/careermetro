/** SEC-6: contact details and IDs are replaced before resume text is sent to the model. The name and city stay. */

export type MaskCounts = { email: number; phone: number; address: number; profileUrl: number; id: number; dateOfBirth: number };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s|,;)]+/gi;
const DATE_OF_BIRTH = /\b(?:DOB|D\.O\.B\.?|Date of Birth)\b\s*[:\-–]?\s*[^\n|]{4,30}?(?=\s*(?:\||\n|$))/gi;
const AADHAAR = /(?<![+\d])\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/**
 * Indian mobiles in any common grouping ("+91 98765 43210", "987-654-3210", "+91 (987) 654-3210", "98765 - 43210",
 * "0091 98765 43210"), landlines with an STD code in brackets, and international numbers starting with +. A mobile is
 * exactly 10 digits starting with 6-9, so years, amounts and percentages don't match.
 */
const PHONE =
  /(?<![\d+])(?:(?:\+\s?|00)91[\s().-]{0,2}|0)?\(?[6-9](?:[\s().-]{0,3}\d){9}(?!\d)|\(0\d{2,4}\)\s?\d{3,4}[\s-]?\d{4}\b|\+(?!\s?91)\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
/**
 * Landlines with an STD code: "022-23456789", "011-2345-6789", "+91 22 2345 6789". The code starts 1-8 and the
 * number has 10 digits after the 0 or +91, so a year range like "2019-2023" never matches.
 */
const LANDLINE = /(?<![\d+])(?:\+\s?91[\s-]?|0)[1-8]\d{1,3}[\s-]\d{2,4}[\s-]?\d{3,4}(?!\d)/g;
const landlineDigits = (match: string) => match.replace(/^\+\s?91/, "").replace(/^0/, "").replace(/\D/g, "").length === 10;
const PIN_CODE = /\b[1-9]\d{2}\s?\d{3}\b/;
const PIN_AT_END = /\b[1-9]\d{2}\s?\d{3}\s*\.?$/;
const ADDRESS_WORDS =
  /\b(?:flat|house no|h\.?\s?no|plot|apartment|apts?|residency|society|chs|tower|wing|floor|street|st\.|road|rd\.|lane|marg|nagar|colony|sector|phase|layout|cross|main|near|opp\.?|behind|peth|ward|village|vill\.?|dist\.?|district|tehsil|taluka|mandal|post office|p\.\s?o\.?)\b/i;
/** Lines that say they are an address, or name a guardian the way Indian addresses do ("C/o", "S/o"). */
const ADDRESS_LABEL = /^\s*(?:(?:permanent|current|present|residential|postal|home)\s+)?address\b\s*[:\-–]|^\s*[CSDW]\/[Oo]\b/i;
/** Address lines are only looked for in the contact block at the top, unless the line carries a PIN code. */
const HEADER_LINES = 8;

function replaceCounting(text: string, pattern: RegExp, replacement: string, onHit: () => void): string {
  return text.replace(pattern, () => {
    onHit();
    return replacement;
  });
}

function isAddressLine(line: string, index: number): boolean {
  if (line.length === 0 || line.length > 140 || /^[-•*]/.test(line)) return false;
  if (ADDRESS_LABEL.test(line)) return true;
  // A PIN code only marks an address when it ends a comma-separated locality line, or sits in one with an address
  // word; not in a sentence.
  const hasPin =
    (PIN_AT_END.test(line) && line.includes(",")) || (ADDRESS_WORDS.test(line) && (PIN_AT_END.test(line) || (PIN_CODE.test(line) && line.includes(","))));
  const headerAddress = index < HEADER_LINES && ADDRESS_WORDS.test(line) && /\d/.test(line);
  return hasPin || headerAddress;
}

export function maskPii(input: string): { text: string; counts: MaskCounts } {
  const counts: MaskCounts = { email: 0, phone: 0, address: 0, profileUrl: 0, id: 0, dateOfBirth: 0 };

  const lines = input.split("\n").map((line, i) => {
    if (!isAddressLine(line, i)) return line;
    counts.address++;
    return "[ADDRESS]";
  });

  let text = lines.join("\n");
  text = replaceCounting(text, EMAIL, "[EMAIL]", () => counts.email++);
  text = replaceCounting(text, PROFILE_URL, "[PROFILE URL]", () => counts.profileUrl++);
  text = replaceCounting(text, DATE_OF_BIRTH, "[DATE OF BIRTH]", () => counts.dateOfBirth++);
  text = replaceCounting(text, PAN, "[ID]", () => counts.id++);
  text = replaceCounting(text, AADHAAR, "[ID]", () => counts.id++);
  text = text.replace(LANDLINE, (match) => {
    if (!landlineDigits(match)) return match;
    counts.phone++;
    return "[PHONE]";
  });
  text = replaceCounting(text, PHONE, "[PHONE]", () => counts.phone++);
  return { text, counts };
}
