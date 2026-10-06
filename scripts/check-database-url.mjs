// Explains what is wrong with DATABASE_URL without printing the password.
// Used by the Migrate database workflow before drizzle-kit runs.
const raw = process.env.DATABASE_URL ?? "";
const problems = [];

if (raw !== raw.trim()) problems.push("it has a space or line break at the start or end");
const url = raw.trim();
if (/^DATABASE_\w*\s*=/.test(url)) problems.push("it includes the name (DATABASE_...=); save only the value");
if (/^["']|["']$/.test(url)) problems.push("it is wrapped in quotes");
const bare = url.replace(/^["']|["']$/g, "");
if (!/^postgres(ql)?:\/\//.test(bare)) problems.push("it does not start with postgresql://");
if (/\s/.test(url)) problems.push("it contains a space");
if (/[[\]]/.test(url)) problems.push("it still contains [ or ] from the [YOUR-PASSWORD] placeholder");

const afterScheme = bare.replace(/^[a-z]+:\/\//, "");
const at = afterScheme.lastIndexOf("@");
if (at === -1) {
  problems.push("it has no @ between the password and the host");
} else if (/[#/?]/.test(afterScheme.slice(0, at))) {
  problems.push("the password contains #, / or ?; reset it to letters and numbers only");
}

let parsed;
try {
  parsed = new URL(bare);
} catch {
  if (!problems.length) problems.push("it is not a valid link");
}

if (parsed) console.log(`Host: ${parsed.hostname}  Port: ${parsed.port || "(none)"}`);
if (problems.length) {
  for (const p of problems) console.log(`::error::DATABASE_MIGRATION_URL: ${p}`);
  process.exit(1);
}
console.log("Database link looks valid.");
