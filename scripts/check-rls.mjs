// Runs in the "Migrate database" workflow after the migrations. Supabase's REST API serves every table in the public
// schema to anyone holding the project's anon key unless row level security is on, and the app never uses that API, so
// every public table must have it. Fails the workflow if one doesn't, naming the tables and whether the API's roles
// can read them. It prints table names, row counts and role names only: never rows, and never the connection string.
import { pathToFileURL } from "node:url";
import postgres from "postgres";

/** Ordinary and partitioned tables in the public schema with row level security off, sorted by name. */
export async function publicTablesWithoutRls(sql) {
  const rows = await sql`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`;
  return rows.map((r) => r.name);
}

/** For each table, whether Supabase's API roles (anon, authenticated) hold SELECT on it, and its row count. */
async function exposure(sql, tables) {
  const roles = (await sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`).map((r) => r.rolname);
  const out = [];
  for (const table of tables) {
    const readers = [];
    for (const role of roles) {
      const [{ ok }] = await sql`select has_table_privilege(${role}, ${`public.${table}`}, 'SELECT') as ok`;
      if (ok) readers.push(role);
    }
    const [{ n }] = await sql`select count(*)::int as n from ${sql("public." + table)}`.catch(() => [{ n: -1 }]);
    out.push({ table, readers, rows: n });
  }
  return { roles, out };
}

async function main() {
  const stage = process.env.CHECK_RLS_STAGE ? ` (${process.env.CHECK_RLS_STAGE.replace(/[^a-z ]/gi, "")})` : "";
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("check-rls: DATABASE_URL is not set; skipping");
    return;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const missing = await publicTablesWithoutRls(sql);
    if (missing.length === 0) {
      console.log(`check-rls${stage}: every public table has row level security on`);
      return;
    }
    const { roles, out } = await exposure(sql, missing);
    console.error(`check-rls${stage}: ${missing.length} public table(s) without row level security (API roles present: ${roles.join(", ") || "none"})`);
    for (const t of out) console.error(`  ${t.table}: ${t.rows} rows; readable through the API by ${t.readers.join(", ") || "no API role"}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(`check-rls: could not check (${error?.code ?? error?.name ?? "error"})`);
    process.exitCode = 1;
  });
}
