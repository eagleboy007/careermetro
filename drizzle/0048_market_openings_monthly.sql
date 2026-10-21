-- Market trends PR 1 (docs/plans/market-trends-plan.md, "Data model"; Milin's decisions of 2026-10-21): market_openings_monthly holds openings a month for /market, one row per month (first day, UTC) × role_slug × state (a two-letter code, or 'IN' for all of India) × city (null for the whole state) × band (null when the posts state no years), with new_posts (first seen that month), open_at_end (open on the month's last run), boards_ok (that month's lowest daily board count) and computed_at. Written by the daily feed (scripts/departures/fetch-feeds.mjs) as an idempotent upsert of the current month, so the counts outlive the 180-day purge of closed job_posts; the daily cleanup never deletes it. Counts only: a post belongs to no one, and no post text, URL or person is kept. Unique on the cell with nulls not distinct (the upsert's target; Postgres 15 or later); index on (role_slug, month) for the screen's reads. No foreign keys (role slugs are content, not rows), so no foreign-key indexes. Row level security with no policies, like every table; no grant: the feed still writes as the owner login, and the T89 feed-only role (dev/feed-db-role-steps.md) is not made in a migration and does not exist yet; when it is made it needs select, insert, update and delete on this table and a policy like the ones on job_posts and job_feed_runs. Expand only: one new table and its index.
CREATE TABLE "market_openings_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"role_slug" text NOT NULL,
	"state" text NOT NULL,
	"city" text,
	"band" text,
	"new_posts" integer DEFAULT 0 NOT NULL,
	"open_at_end" integer DEFAULT 0 NOT NULL,
	"boards_ok" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_openings_monthly_cell" UNIQUE NULLS NOT DISTINCT("month","role_slug","state","city","band"),
	CONSTRAINT "market_openings_monthly_month" CHECK (extract(day from "market_openings_monthly"."month") = 1),
	CONSTRAINT "market_openings_monthly_state" CHECK ("market_openings_monthly"."state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "market_openings_monthly_city" CHECK ("market_openings_monthly"."city" is null or (char_length("market_openings_monthly"."city") between 1 and 60 and "market_openings_monthly"."state" <> 'IN')),
	CONSTRAINT "market_openings_monthly_band" CHECK ("market_openings_monthly"."band" is null or "market_openings_monthly"."band" in ('0-2', '3-5', '6-10', '10+')),
	CONSTRAINT "market_openings_monthly_counts" CHECK ("market_openings_monthly"."new_posts" >= 0 and "market_openings_monthly"."open_at_end" >= 0 and "market_openings_monthly"."boards_ok" >= 0)
);
--> statement-breakpoint
CREATE INDEX "market_openings_monthly_role_month" ON "market_openings_monthly" USING btree ("role_slug","month");--> statement-breakpoint
ALTER TABLE "market_openings_monthly" ENABLE ROW LEVEL SECURITY;
