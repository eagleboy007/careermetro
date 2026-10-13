// CSV for the jd-mining files (scripts/jd-mining) and the /market feed loader (src/content/market/feed.ts): every
// field quoted, quotes doubled (RFC 4180), the format mine.mjs has always written. parseCsv reads it back, including
// quotes, commas and line breaks inside a field.

/** Rows (arrays of values) to CSV text. null and undefined are written as empty fields. */
export const toCsv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";

/** CSV text to rows of strings. Blank lines are skipped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/** CSV text with a header row to objects keyed by the header. A row with the wrong number of fields is an error. */
export function parseCsvObjects(text) {
  const [head, ...lines] = parseCsv(text);
  if (!head) return [];
  return lines.map((cells, n) => {
    if (cells.length !== head.length) throw new Error(`CSV row ${n + 2} has ${cells.length} fields, expected ${head.length}`);
    return Object.fromEntries(head.map((k, i) => [k, cells[i]]));
  });
}
