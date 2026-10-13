-- Corporate jobs (dev/corporate-plan.md, build step 3): new tables jobs and job_team, and a new report target for "Report this job". Expand only: new tables, and an enum value added at the end (no code reads it before this release).
CREATE TYPE "public"."job_status" AS ENUM('draft', 'open', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."job_team_role" AS ENUM('owner', 'hiring', 'interviewer');--> statement-breakpoint
CREATE TYPE "public"."job_work_type" AS ENUM('full_time', 'part_time', 'freelance');--> statement-breakpoint
ALTER TYPE "public"."report_target" ADD VALUE 'job';--> statement-breakpoint
CREATE TABLE "job_team" (
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "job_team_role" NOT NULL,
	CONSTRAINT "job_team_job_id_user_id_pk" PRIMARY KEY("job_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid,
	"role_profile_id" uuid NOT NULL,
	"track" text,
	"title" text NOT NULL,
	"work_type" "job_work_type" DEFAULT 'full_time' NOT NULL,
	"city" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"ai_round" boolean DEFAULT false NOT NULL,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "jobs_title_length" CHECK (char_length("jobs"."title") between 2 and 120),
	CONSTRAINT "jobs_city_length" CHECK (char_length("jobs"."city") between 2 and 60),
	CONSTRAINT "jobs_ai_round_off" CHECK (not "jobs"."ai_round")
);
--> statement-breakpoint
ALTER TABLE "job_team" ADD CONSTRAINT "job_team_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_team" ADD CONSTRAINT "job_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_role_profile_id_role_profiles_id_fk" FOREIGN KEY ("role_profile_id") REFERENCES "public"."role_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_team_user" ON "job_team" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_org_status" ON "jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "jobs_status_created" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_owner" ON "jobs" USING btree ("owner_id");--> statement-breakpoint
-- As in 0001: the app reaches these tables from the server only, so row level security with no policies keeps them off Supabase's public API.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_team" ENABLE ROW LEVEL SECURITY;
