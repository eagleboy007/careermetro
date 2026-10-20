-- Live Departures (docs/plans/departures-live-plan.md, v44 gap items 40 and 42; approved by the Project manager under Milin's delegation). job_posts holds roles from the reviewed public job boards (src/content/job-boards.json: the Greenhouse, Lever, Ashby and SmartRecruiters public APIs only, never scraped), written once a day by scripts/departures/fetch-feeds.mjs: the title, company, place, work type, the experience the post states, the live role read from the title and the skill ids found by code, never the post's text; it belongs to no one, and closed posts go 180 days after closing. job_saves is the person's own Saved and Applied lists (stage 1 Applied to 4 Offer), owner only, deleted with the account (on delete cascade) or with its post; a row with neither a save nor a stage is deleted, not kept. job_feed_runs records each run's counts for "Updated" (kept 90 days). user_goals gets an index on (skill_id, status) for the On your line count. Row level security with no policies, like every table. Expand only: three new tables and their indexes, and one index on an existing table.
CREATE TABLE "job_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ats" text NOT NULL,
	"board_token" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"city" text NOT NULL,
	"work_type" "job_work_type" DEFAULT 'full_time' NOT NULL,
	"experience_note" text,
	"role_slug" text,
	"required_skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"nice_skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "job_posts_ats" CHECK ("job_posts"."ats" in ('greenhouse', 'lever', 'ashby', 'smartrecruiters')),
	CONSTRAINT "job_posts_url_https" CHECK ("job_posts"."url" like 'https://%'),
	CONSTRAINT "job_posts_title_length" CHECK (char_length("job_posts"."title") between 2 and 160),
	CONSTRAINT "job_posts_company_length" CHECK (char_length("job_posts"."company") between 1 and 80),
	CONSTRAINT "job_posts_city_length" CHECK (char_length("job_posts"."city") between 1 and 60),
	CONSTRAINT "job_posts_experience_length" CHECK ("job_posts"."experience_note" is null or char_length("job_posts"."experience_note") <= 40)
);
--> statement-breakpoint
CREATE TABLE "job_saves" (
	"user_id" uuid NOT NULL,
	"job_post_id" uuid NOT NULL,
	"saved_at" timestamp with time zone,
	"stage" smallint,
	"applied_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_saves_user_id_job_post_id_pk" PRIMARY KEY("user_id","job_post_id"),
	CONSTRAINT "job_saves_stage" CHECK ("job_saves"."stage" is null or "job_saves"."stage" between 1 and 4),
	CONSTRAINT "job_saves_not_empty" CHECK ("job_saves"."saved_at" is not null or "job_saves"."stage" is not null)
);
--> statement-breakpoint
CREATE TABLE "job_feed_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"boards_ok" integer DEFAULT 0 NOT NULL,
	"boards_failed" integer DEFAULT 0 NOT NULL,
	"posts_open" integer DEFAULT 0 NOT NULL,
	"posts_closed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_job_post_id_job_posts_id_fk" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_posts_external" ON "job_posts" USING btree ("ats","board_token","external_id");--> statement-breakpoint
CREATE INDEX "job_posts_closed_role" ON "job_posts" USING btree ("closed_at","role_slug");--> statement-breakpoint
CREATE INDEX "job_posts_open_role_city" ON "job_posts" USING btree ("role_slug","city") WHERE "job_posts"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "job_saves_job_post" ON "job_saves" USING btree ("job_post_id");--> statement-breakpoint
CREATE INDEX "job_feed_runs_finished" ON "job_feed_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "user_goals_skill_status" ON "user_goals" USING btree ("skill_id","status");--> statement-breakpoint
ALTER TABLE "job_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_saves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_feed_runs" ENABLE ROW LEVEL SECURITY;
