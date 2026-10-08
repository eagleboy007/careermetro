// Loads the skill taxonomy, role profiles and resource catalog from src/content into the database. Safe to re-run:
// skills are upserted, aliases are replaced, a role profile gets a new version only when it changed, and resources
// are upserted by URL. A resource removed from the catalog is marked unhealthy so new paths skip it; old paths keep it.
// Usage: DATABASE_URL=... node scripts/seed-content.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const root = new URL("../", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
// jsonb does not keep key order, so compare with keys sorted.
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
      : JSON.stringify(v);
const normalize = (term) => term.trim().toLowerCase().replace(/\s+/g, " ");

const skills = read("src/content/skills.json");
const resources = read("src/content/resources.json").map((r) => ({ ...r, free: r.free ?? true }));
// An empty list would make the insert below invalid and retire nothing; the content tests rule it out, but fail loudly here too.
if (resources.length === 0) throw new Error("src/content/resources.json is empty");
const roles = readdirSync(join(root, "src/content/roles"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(`src/content/roles/${f}`));

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    await tx`
      insert into skills ${tx(skills, "id", "name", "category")}
      on conflict (id) do update set name = excluded.name, category = excluded.category`;

    const aliases = [
      ...new Map(
        skills.flatMap((s) => [s.name, ...s.aliases].map((a) => [`${normalize(a)}|${s.id}`, { alias: normalize(a), skill_id: s.id }])),
      ).values(),
    ];
    await tx`delete from skill_aliases where skill_id in ${tx(skills.map((s) => s.id))}`;
    await tx`insert into skill_aliases ${tx(aliases, "alias", "skill_id")}`;

    let added = 0;
    for (const role of roles) {
      const [latest] = await tx`
        select version, data from role_profiles where slug = ${role.slug} order by version desc limit 1`;
      if (latest && canonical(latest.data) === canonical(role)) continue;
      await tx`
        insert into role_profiles (slug, version, data, published, updated_on)
        values (${role.slug}, ${(latest?.version ?? 0) + 1}, ${tx.json(role)}, ${role.reviewedBy !== null}, ${role.updatedOn})`;
      added += 1;
    }
    // Updating keeps last_checked_at, which belongs to the link check. healthy comes back from the latest check, so a
    // retired URL that is added back is usable again unless the link check last found it dead.
    await tx`
      insert into resources ${tx(
        resources.map((r) => ({ title: r.title, url: r.url, provider: r.provider, kind: r.kind, skill_ids: r.skillIds, minutes: r.minutes, free: r.free })),
        "title", "url", "provider", "kind", "skill_ids", "minutes", "free",
      )}
      on conflict (url) do update set title = excluded.title, provider = excluded.provider, kind = excluded.kind,
        skill_ids = excluded.skill_ids, minutes = excluded.minutes, free = excluded.free,
        healthy = coalesce(
          (select c.ok or c.detail not like 'dead%' from resource_checks c
            where c.resource_id = resources.id order by c.checked_at desc limit 1),
          true)`;
    const retired = await tx`
      update resources set healthy = false where healthy and url not in ${tx(resources.map((r) => r.url))} returning id`;

    return {
      skills: skills.length,
      aliases: aliases.length,
      roles: roles.length,
      newRoleVersions: added,
      resources: resources.length,
      retired: retired.length,
    };
  });
  console.log(
    `Seeded ${summary.skills} skills, ${summary.aliases} aliases; ${summary.newRoleVersions} of ${summary.roles} role profiles got a new version; ` +
      `${summary.resources} resources (${summary.retired} retired).`,
  );
} finally {
  await sql.end();
}
