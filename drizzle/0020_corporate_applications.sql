-- Corporate applications and the board (dev/corporate-plan.md, build step 4): new tables applications and application_events, and their enums. Expand only: new types and tables, nothing existing changes.
CREATE TYPE "public"."application_event_kind" AS ENUM('applied', 'moved', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."application_stage" AS ENUM('applied', 'shortlisted', 'ai', 'team', 'offer', 'not_this_time');--> statement-breakpoint
CREATE TYPE "public"."can_join" AS ENUM('now', '30', '60', '90');--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "application_event_kind" NOT NULL,
	"stage" "application_stage" NOT NULL,
	"by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_note_length" CHECK (char_length("application_events"."note") <= 500),
	CONSTRAINT "application_events_not_this_time_note" CHECK ("application_events"."kind" <> 'moved' or "application_events"."stage" <> 'not_this_time' or coalesce(char_length("application_events"."note"), 0) >= 10)
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"stage" "application_stage" DEFAULT 'applied' NOT NULL,
	"can_join" "can_join" NOT NULL,
	"resume_id" uuid,
	"phone_shared" text,
	"withdrawn_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"company_access_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_application" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "application_events_by_user" ON "application_events" USING btree ("by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_user" ON "applications" USING btree ("job_id","user_id");--> statement-breakpoint
CREATE INDEX "applications_job_stage" ON "applications" USING btree ("job_id","stage");--> statement-breakpoint
CREATE INDEX "applications_org" ON "applications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "applications_user" ON "applications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "applications_consent" ON "applications" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "applications_resume" ON "applications" USING btree ("resume_id");--> statement-breakpoint
-- As in 0001: the app reaches these tables from the server only, so row level security with no policies keeps them off Supabase's public API.
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application_events" ENABLE ROW LEVEL SECURITY;
