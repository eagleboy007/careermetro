// The company review list and the review step, shared by the in-app page (/admin/companies, src/lib/admin) and the
// Companies workflow (scripts/companies.mjs). Plain JavaScript over a postgres.js client so the script runs with plain
// Node. No one's email address or phone is read here: only company fields and counts.

/** @typedef {"company" | "college" | "training_partner"} OrgType */
/** @typedef {"pending" | "verified" | "suspended"} ReviewStatus */
/**
 * @typedef {{ id: string; name: string; type: OrgType; domain: string; website: string | null; city: string | null;
 *   size: string | null; created: string; status: ReviewStatus; members: number; admins: number }} QueueRow
 */

/** True when the website's host is the email domain or a subdomain either way; a mismatch is flagged for the check. */
export function websiteMatches(/** @type {string} */ website, /** @type {string} */ domain) {
  try {
    const host = new URL(website).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

/**
 * Companies that need a look: waiting for review, suspended (so they can be verified again), or left with no active
 * Recruiter admin (for example after the only admin deleted their account). Oldest first. `created` is the day in
 * India time. Admins and members count active roles on accounts that are not deleted.
 * @param {import("postgres").Sql} sql
 * @returns {Promise<QueueRow[]>}
 */
export async function reviewQueue(sql) {
  const rows = await sql`
    select o.id, o.name, o.type, o.email_domain as domain, o.website, o.city, o.size,
      to_char(o.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as created,
      o.review_status as status,
      count(m.id) filter (where m.removed_at is null and u.deletion_requested_at is null)::int as members,
      count(m.id) filter (where m.removed_at is null and u.deletion_requested_at is null and m.role = 'admin')::int as admins
    from organizations o
    left join org_members m on m.org_id = o.id
    left join users u on u.id = m.user_id
    where o.email_domain is not null
    group by o.id
    having o.review_status in ('pending', 'suspended')
      or count(m.id) filter (where m.removed_at is null and u.deletion_requested_at is null and m.role = 'admin') = 0
    order by o.created_at, o.id`;
  return /** @type {QueueRow[]} */ (/** @type {unknown} */ (rows));
}

/**
 * How many companies are in each part of the list. A company can be both waiting and without an admin.
 * @param {Pick<QueueRow, "status" | "admins">[]} rows
 */
export function queueCounts(rows) {
  return {
    total: rows.length,
    waiting: rows.filter((r) => r.status === "pending").length,
    suspended: rows.filter((r) => r.status === "suspended").length,
    noAdmin: rows.filter((r) => r.admins === 0).length,
  };
}

/** The review status each decision sets. */
export const DECISION_STATUS = /** @type {const} */ ({ verify: "verified", suspend: "suspended" });

/**
 * Sets one company's review status, when and by whom, and writes one audit line, in one transaction. The company is
 * found by its id (the page) or its email domain (the workflow). `reviewer` is "admin:<user id>" or "github:<login>",
 * never an email address. Returns the company's id and name, or null when no company matches.
 * @param {import("postgres").Sql} sql
 * @param {{ id: string } | { domain: string }} which
 * @param {"verify" | "suspend"} decision
 * @param {string} reviewer
 * @returns {Promise<{ id: string; name: string } | null>}
 */
export async function setReviewStatus(sql, which, decision, reviewer) {
  const status = DECISION_STATUS[decision];
  return /** @type {Promise<{ id: string; name: string } | null>} */ (
    sql.begin(async (tx) => {
      const match = "id" in which ? tx`id = ${which.id}` : tx`email_domain = ${which.domain}`;
      const [org] = await tx`
        update organizations set review_status = ${status}, reviewed_at = now(), reviewed_by = ${reviewer}
        where ${match} and email_domain is not null returning id, name`;
      if (!org) return null;
      await tx`insert into audit_logs (actor, action, target) values (${reviewer}, ${`company_${status}`}, ${`organization:${org.id}`})`;
      return { id: String(org.id), name: String(org.name) };
    })
  );
}
