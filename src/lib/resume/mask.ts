/** SEC-6: contact details and IDs are replaced before resume text is sent to the model. The name and city stay. */

export type MaskCounts = { email: number; phone: number; address: number; profileUrl: number; id: number; dateOfBirth: number };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s|,;)]+/gi;
const DATE_OF_BIRTH = /\b(?:DOB|D\.O\.B\.?|Date of Birth)\b\s*[:\-–]?\s*[^\n|]{4,30}?(?=\s*(?:\||\n|$))/gi;
const AADHAAR = /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/**
 * Indian mobiles (optionally +91 or 0), landlines with an STD code in brackets, and international numbers starting with +.
 * Plain digit runs such as amounts or years do not match: a mobile must start with 6-9 and have exactly 10 digits.
 */
const PHONE =
  /(?:\+91[\s-]?|\b0|\b)[6-9]\d{4}[\s-]?\d{5}\b|\(0\d{2,4}\)\s?\d{3,4}[\s-]?\d{4}\b|\+(?!91)\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
const PIN_CODE = /\b[1-9]\d{2}\s?\d{3}\b/;
const ADDRESS_WORDS =
  /\b(?:flat|house no|h\.?\s?no|plot|apartment|apts?|residency|society|chs|tower|wing|floor|street|st\.|road|rd\.|lane|marg|nagar|colony|sector|phase|layout|cross|main|near|opp\.?|behind)\b/i;
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
  const hasPin = PIN_CODE.test(line) && ADDRESS_WORDS.test(line);
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
  text = replaceCounting(text, PHONE, "[PHONE]", () => counts.phone++);
  return { text, counts };
}
