// Reads a returned review file and lists every answered line, grouped by role or question:
//   node scripts/review/read-review.mjs <returned.csv>
// Prints only the reviewer's answers and the Refs; it changes nothing in src/content.
import { readFileSync } from "node:fs";
import { ANSWER_COLUMNS, buildPack } from "./build-review-pack.mjs";

/** RFC 4180 CSV rows (quoted cells, doubled quotes, CRLF or LF), without a leading byte-order mark. */
export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  if (cell || row.length) endRow();
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Every full Ref the pack built from today's content holds (column 0 of each CSV), such as "data-analyst#skill:sql",
 * so a line for a removed skill, duty, question or certification is flagged, not only one for a removed role (T158).
 */
export function packRefs(pack = buildPack()) {
  return new Set(
    Object.entries(pack)
      .filter(([name]) => name.endsWith(".csv"))
      .flatMap(([, body]) => parseCsv(body).slice(1).map((r) => r[0]?.trim() ?? ""))
      .filter(Boolean),
  );
}

/** The answered lines of a returned file, and the Refs (whole, as `packRefs` lists them) that no longer exist. */
export function answers(text, known) {
  const [head, ...rows] = parseCsv(text);
  const at = (name) => head.indexOf(name);
  const [agree, change, comment] = ANSWER_COLUMNS.map(at);
  if ([agree, change, comment, at("Ref")].includes(-1)) throw new Error("not a review pack file: the Ref or answer columns are missing");
  const out = [];
  for (const r of rows) {
    const line = { ref: r[at("Ref")]?.trim() ?? "", agree: r[agree]?.trim() ?? "", change: r[change]?.trim() ?? "", comment: r[comment]?.trim() ?? "" };
    if (!line.agree && !line.change && !line.comment) continue;
    const owner = line.ref.split("#")[0] || r[at("Role")]?.trim() || "(no ref)";
    out.push({ ...line, owner, unknown: line.ref !== "" && !known.has(line.ref) });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node scripts/review/read-review.mjs <returned.csv>");
  const known = packRefs();
  let owner = "";
  for (const a of answers(readFileSync(file, "utf8"), known)) {
    if (a.owner !== owner) console.log(`\n## ${(owner = a.owner)}`);
    const said = [a.agree && `agree: ${a.agree}`, a.change && `change to: ${a.change}`, a.comment && `comment: ${a.comment}`].filter(Boolean).join(" | ");
    console.log(`- ${a.ref || "(new line)"}${a.unknown ? " (Ref not found)" : ""}: ${said}`);
  }
}
