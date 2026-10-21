// CSV for the jd-mining files (scripts/jd-mining/mine.mjs): every field quoted, quotes doubled (RFC 4180), the format
// mine.mjs has always written.

/** Rows (arrays of values) to CSV text. null and undefined are written as empty fields. */
export const toCsv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
