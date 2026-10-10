/** SEC-6: contact details and IDs are replaced before resume text is sent to the model. The name and city stay. */

export type MaskCounts = { email: number; phone: number; address: number; profileUrl: number; id: number; dateOfBirth: number };

// Bounded runs keep a long string with no spaces from making this slow.
const LOCAL = "[A-Za-z0-9._%+-]{1,64}";
/** A line break, or a blank line between table-cell paragraphs (docx), with stray spaces around it. */
const BREAK = "[ \\t]{0,3}\\r?\\n(?:[ \\t]{0,3}\\r?\\n)?[ \\t]{0,3}";
/** A split address must end in a domain people use for email, so "Boot\n@Autowired.inject" stays text. */
const MAIL_DOMAIN = "[A-Za-z0-9.-]{0,252}[A-Za-z0-9]\\.(?:com|in|org|net|edu|co|io|ai|gov|ac|me|dev|info|biz|us|uk|au|sg|ae|tech|app|xyz)(?![A-Za-z0-9-])";
/**
 * An address, also when table cells and PDF wrapping split it at the "@" (T30): "name@\nexample.com",
 * "name\n\n@example.com", or "name@ example.com". Spaces on both sides of "@" on one line ("Engineer @ Flipkart.com")
 * mean "at", not an address.
 */
const EMAIL = new RegExp(
  `${LOCAL}@[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,24}|${LOCAL}[ \\t]{0,3}@${BREAK}${MAIL_DOMAIN}|${LOCAL}${BREAK}@${MAIL_DOMAIN}|${LOCAL}@[ \\t]{1,3}${MAIL_DOMAIN}`,
  "gi",
);
const PROFILE_URL = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s|,;)]+/gi;
const DATE_OF_BIRTH = /\b(?:DOB|D\.O\.B\.?|Date of Birth)\b\s*[:\-–]?\s*[^\n|]{4,30}?(?=\s*(?:\||\n|$))/gi;
const AADHAAR = /(?<![+\d])\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;
const AADHAAR_LABELLED = /(\b(?:aadhaa?r|uid)\b(?:\s?card)?(?:\s?(?:no\.?|number))?\s?[:\-]?\s?)\d{4}[ -]?\d{4}[ -]?\d{4}\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
/** Separators people and PDF exports put between digit groups, en and em dashes included. */
const SEP = "[\\s().\\u2013\\u2014-]";
/**
 * Indian mobiles in any common grouping ("+91 98765 43210", "987-654-3210", "+91 (987) 654-3210", "98765 - 43210",
 * "98765 / 43210", "0091 98765 43210", "919876543210"), landlines with an STD code in brackets, and international numbers starting with +. A mobile is
 * exactly 10 digits starting with 6-9, so years, amounts and percentages don't match.
 */
/**
 * Words before a number pair that make it a score, rank or ID rather than a phone ("Rank 61234 / 98765"). Only
 * compound labels for "No" and "ID", since "Mobile No." and "WhatsApp ID" are how Indian resumes label a phone.
 */
const COUNT_WORDS =
  "scores?|rank|air|roll\\s?no|reg(?:istration)?\\s?no|ticket\\s?no|hall\\s?ticket|tickets?|employee\\s?ids?|credential\\s?id|txn\\s?id|order\\s?id|invoice(?:\\s?no)?|part(?:\\s?no)?|users|rows|out\\s?of|range\\s?of|txn|order|ref|model|sku";
/** Labels that make the number after them a phone, whatever it looks like. */
const PHONE_LABEL = "ph|phone|mob|mobile|tel|contact|whatsapp|cell|alternate|alt|emergency|office|residence";
const PHONE = new RegExp(
  [
    // "98765 - 43210" only with a +91 or 0 in front, or a phone label before it, so "60000 - 80000" stays a salary range.
    `(?<![\\d+])(?:(?:\\+\\s?|00)91${SEP}{0,2}|0)\\(?[6-9]\\d{4}\\s?[-\\u2013\\u2014]\\s?\\d{5}(?!\\d)`,
    `(?<=\\b(?:${PHONE_LABEL})\\b[^\\d\\n]{0,12})[6-9]\\d{4}\\s?[-\\u2013\\u2014/]\\s?\\d{5}(?!\\d)`,
    `(?<=\\b(?:${PHONE_LABEL})\\b[^\\d\\n]{0,12})91[6-9]\\d{9}(?!\\d)`,
    // Not after a money word, so "Salary range 70000–90000" stays.
    `(?<![\\d+])(?<!\\b(?:salary|range|ctc|budget|stipend|rs\\.?|inr|usd|\\u20b9|\\$)\\s?[:\\-]?\\s?)(?:(?:\\+\\s?|00)91${SEP}{0,2}|91${SEP}{1,2}|0)?\\(?[6-9](?:${SEP}{0,2}\\d){9}(?!\\d)`,
    // A bare "98765 - 43210" or "98765 / 43210": a salary range ("70000 - 90000") is two round numbers, so it stays.
    `(?<![\\d+])(?<!\\b(?:salary|range|ctc|budget|stipend|rs\\.?|inr|usd|\\u20b9|\\$|${COUNT_WORDS})\\.?\\s?[:\\-]?\\s?)(?![6-9]\\d{2}00\\s?[-\\u2013\\u2014/]\\s?\\d{3}00(?!\\d))(?<pair>[6-9]\\d{4}\\s?[-\\u2013\\u2014/]\\s?\\d{5})(?!\\d)`,
    // "919876543210": the country code run straight into the mobile.
    `(?<![\\d+])(?<!\\b(?:${COUNT_WORDS})\\.?\\s?[:#\\-]?\\s?)91[6-9]\\d{9}(?!\\d)`,
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
  /(?<=(?:,\s{0,3}(?:\p{Lu}\p{Ll}{2,}|[A-Z]{2})|\b\p{Lu}\p{Ll}+\s{1,3}\p{Lu}\p{Ll}{2,})\s{0,3}[,\-–]?\s{0,3})(?<!\b(?:Code|Id|ID|UID|No|Rank|Credential|Revenue|Users|Budget|Saved|Number|Size|Count|Score|Salary|Ctc)\s{0,3}[,\-–:]?\s{0,3})\b[1-9]\d{2}\s?\d{3}(?=\s{0,3}(?:[,(]?\s{0,3}(?:India|[A-Z]{2}|\p{Lu}\p{Ll}+(?:\s\p{Lu}\p{Ll}+)?)\)?\s{0,3})?\.?\s{0,3}(?:$|\|))/u;
/** "Pincode: 411038", "PIN - 411 038": the number goes wherever the line is. */
const PIN_LABELLED = /(\b(?:pin\s?code|pin|zip(?:\s?code)?)\s?[:\-]?\s?)[1-9]\d{2}\s?\d{3}\b/gi;
/** Words only an address uses: with a place and PIN they make the whole line an address anywhere in the resume. */
const STRONG_ADDRESS_WORDS =
  /\b(?:flat|house no|h\.?\s?no|plot no|apartment|apts?|residency|society|chs|street|st\.|road|rd\b\.?|lane|marg|nagar|colony|peth|village|vill\.|dist\.|tehsil|taluka|tal\b\.?|mandal|at post|p\.\s?o\.?)\b/i;
/** Also job words ("Ward Manager", "Floor Manager", "District Coordinator"), so these count only in the header. */
const ADDRESS_WORDS = new RegExp(
  `${STRONG_ADDRESS_WORDS.source}|\\b(?:plot|tower|wing|floor|sector|phase|layout|cross|near|opp\\.?|behind|ward|dist|district)\\b`,
  "i",
);
/**
 * A flat or house number opening the line ("B-204,", "B204,", "14,", "12/3A,"), never a year. Codes like "S3," also
 * fit, so this only counts next to a place and PIN; the header uses the stricter HOUSE_NUMBER.
 */
const HOUSE_START = /^\s*(?:[A-Za-z]{1,2}[-/]?)?(?!(?:19|20)\d{2}\b)\d{1,4}(?:[-/]\d{1,4})*[A-Za-z]?\s*,/;
const HOUSE_NUMBER = /^\s*(?:[A-Za-z]{1,2}[-/])?(?!(?:19|20)\d{2}\b)\d{1,4}(?:[-/]\d{1,4})*[A-Za-z]?\s*,/;
/**
 * Lines that say they are an address: "Address:", "Res. Address -", "Permanent Address 14 ...". Only these qualifiers,
 * and a colon or a spaced dash, so "Address-lookup API" or "Memory Address:" stay.
 */
const ADDRESS_LABEL =
  /^\s{0,8}(?:[-•*]\s{0,3})?(?:(?:res\.?|residential|permanent|current|present|correspondence|communication|postal|home|mailing|contact|local)\s+)?(?:address|addr\.?|add|residence)\s?(?::[-–]?|[-–](?=\s|\d|$))|^\s{0,8}(?:permanent|current|present|residential|postal|home|mailing)\s+address\s+(?=\d)/i;
/** A guardian the way Indian addresses name one: "C/o Ramesh Rao, ..." or "S/O Ramesh Rao 14 ...". */
const GUARDIAN = /^\s*[CSDW]\/[Oo]\.?\s*[:\-]?\s*(?:(?:Mr|Mrs|Ms|Shri|Smt|Late)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z.]*){0,3}\s*(?:,|\d)/;
/** A label line with nothing after it starts a block: the next few lines are the address. */
const LABEL_ONLY = /[:\-–]\s*$/;
const ADDRESS_BLOCK_LINES = 4;
const SECTION_NAME =
  /^\s*(?:experience|work experience|employment|summary|profile|objective|education|skills|technical skills|projects|certifications?|achievements|languages|personal details|contact|about me)\s*:?\s*$/i;
/** Address lines are only looked for in the contact block at the top, unless the line carries a PIN code. */
const HEADER_LINES = 8;

/**
 * A bare pair that reads as a run of IDs ("60231 / 60298", "70001 - 70450"): the second a little above the first.
 * One mobile split 5-5 ("98765 / 98712") has its halves in any order, so it fails this about 1 time in 200.
 */
function isIdRange(pair: string): boolean {
  const [a, b] = pair.split(/\D+/).filter(Boolean).map(Number);
  return b > a && b - a <= 1000;
}

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
  if (GUARDIAN.test(head)) return true;
  const label = head.match(ADDRESS_LABEL);
  // What follows the label starts like an address (a number, a capital, "#") or the address is on the next lines;
  // "Address: customer escalations" is a sentence.
  if (label) {
    const rest = head.slice(label.index! + label[0].length);
    if (/^\s*$/.test(rest)) return true;
    // A clear address: a house number ("14", "B-204") or quote first, an address word, a guardian ("c/o") or a PIN.
    const clear =
      /^\s{0,3}(?:[#"']|(?:[A-Za-z]{1,2}[-/]?)?\d)/.test(rest) || ADDRESS_WORDS.test(rest) || /\b[cswd]\/o\b/i.test(rest) || PIN_CODE.test(rest);
    // "Add:" is also a verb ("Add: Docker, Kubernetes to the CI stack", "Add: 3 new KPIs"), so it needs a house number
    // before a name ("14 Gandhi Chowk"), one with a comma, a strong address word, a guardian or a PIN.
    const short = /\badd\s?[:\-–]/i.test(label[0]);
    const shortClear =
      STRONG_ADDRESS_WORDS.test(rest) ||
      /\b[cswd]\/o\b/i.test(rest) ||
      PIN_CODE.test(rest) ||
      HOUSE_START.test(rest) ||
      /^\s{0,3}(?:[A-Za-z]{1,2}[-/]?)?\d+[A-Za-z]?\s+[A-Z]/.test(rest);
    // Place names: capitalised with a comma, up to three words, or a run of capitalised words ("Sai Krupa Kothrud Pune").
    const named =
      /^\s{0,3}[A-Z]/.test(rest) && (rest.includes(",") || rest.trim().split(/\s+/).length <= 3 || /^\s{0,3}[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){1,7}\s*$/.test(rest));
    if (short ? shortClear : clear || named) return true;
  }
  if (line.length === 0 || line.length > 140 || /^[-•*]/.test(line)) return false;
  // A PIN code marks a whole address line only with an address word or a house number; elsewhere just the PIN goes.
  const flat = line.replace(/[ \t]{2,}/g, " ");
  const hasPin = (STRONG_ADDRESS_WORDS.test(flat) || HOUSE_START.test(flat)) && PLACE_PIN.test(flat);
  const headerAddress = index < HEADER_LINES && /\d/.test(flat) && (ADDRESS_WORDS.test(flat) || HOUSE_NUMBER.test(flat));
  return hasPin || headerAddress;
}

/**
 * Whether a line under an "Address:" label is still the address: short, not a heading or a dated line, and carrying a
 * comma, a number or an address word. A short line with none of those (a city) is the last line of the block.
 */
function blockLine(line: string): "more" | "full" | "last" | "end" {
  const t = line.trim();
  if (!t || t.length > 80 || SECTION_NAME.test(t) || /^[A-Z][A-Z &/]{2,}:?$/.test(t) || /:\s*$/.test(t)) return "end";
  // A "Phone:" or "Skills:" line, a date or an email is the next part of the resume.
  if (/^[\p{L}][\p{L} .]{0,20}:/u.test(t) || /\b(?:19|20)\d{2}\b|@|\b(?:present|till date)\b/i.test(t)) return "end";
  // A full address line (a number and a comma): only lines with an address word or a PIN may follow it.
  if (/\d/.test(t) && t.includes(",")) return "full";
  if (/\d/.test(t) || ADDRESS_WORDS.test(t)) return "more";
  // A comma line ("Kota, Rajasthan") or a short one ("Delhi") ends the address.
  return t.includes(",") || t.split(/\s+/).length <= 2 ? "last" : "end";
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
        // One blank line between the label and the address is fine.
        if (i + 2 < source.length && source[i + 1].trim() === "" && blockLine(source[i + 2]) !== "end") lines.push(source[++i]);
        for (let k = 0; k < ADDRESS_BLOCK_LINES && i + 1 < source.length; k++) {
          const kind = blockLine(source[i + 1]);
          if (kind === "end") break;
          if (k > 0 && blockLine(source[i]) === "full" && !ADDRESS_WORDS.test(source[i + 1]) && !PIN_CODE.test(source[i + 1])) break;
          i++;
          counts.address++;
          lines.push("[ADDRESS]");
          if (kind === "last" || PIN_CODE.test(source[i])) break;
        }
      }
    } else if (line.length <= 300 && PLACE_PIN.test(line.replace(/[ \t]{2,}/g, " "))) {
      // Keep the line (it may name a job or a skill) and drop only the PIN code. Space runs from PDF layout are
      // squeezed first, so the place check stays fast.
      counts.address++;
      lines.push(line.replace(/[ \t]{2,}/g, " ").replace(PLACE_PIN, "[PIN]"));
    } else {
      lines.push(line);
    }
  }

  let text = lines.join("\n");
  text = replaceCounting(text, EMAIL, "[EMAIL]", () => counts.email++);
  text = replaceCounting(text, PROFILE_URL, "[PROFILE URL]", () => counts.profileUrl++);
  text = replaceCounting(text, DATE_OF_BIRTH, "[DATE OF BIRTH]", () => counts.dateOfBirth++);
  text = replaceCounting(text, PAN, "[ID]", () => counts.id++);
  text = text.replace(PIN_LABELLED, (_, label: string) => {
    counts.address++;
    return `${label}[PIN]`;
  });
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
  text = text.replace(PHONE, (match, ...args) => {
    const pair = (args.at(-1) as { pair?: string }).pair;
    if (pair && isIdRange(pair)) return match;
    counts.phone++;
    return "[PHONE]";
  });
  return { text, counts };
}
