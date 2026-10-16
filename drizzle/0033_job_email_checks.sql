-- Verified current job (FR-47, handoff 12d, dev/current-job-check-plan.md; C5 approved by Milin 2026-10-10): new table job_email_checks, one row per person and job (employer and start month as on the confirmed profile). It keeps the work email's domain and when it was checked, never the address; "review" rows wait for an admin. The code itself uses work_email_codes with the existing "current_job" purpose. Row level security on with no policies, like every table. Account deletion removes the rows (on delete cascade); an admin's account going sets reviewed_by null. Expand only: one new table and its indexes.
CREATE TABLE "job_email_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employer" text NOT NULL,
	"employer_key" text NOT NULL,
	"start_month" text NOT NULL,
	"domain" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "job_email_checks_status" CHECK ("job_email_checks"."status" in ('verified', 'review', 'refused')),
	CONSTRAINT "job_email_checks_lengths" CHECK (char_length("job_email_checks"."employer") between 1 and 120 and char_length("job_email_checks"."employer_key") between 1 and 120 and char_length("job_email_checks"."domain") between 3 and 253),
	CONSTRAINT "job_email_checks_start" CHECK ("job_email_checks"."start_month" ~ '^([0-9]{4}(-[0-9]{2})?)?$')
);
--> statement-breakpoint
ALTER TABLE "job_email_checks" ADD CONSTRAINT "job_email_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_email_checks" ADD CONSTRAINT "job_email_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_email_checks_job" ON "job_email_checks" USING btree ("user_id","employer_key","start_month");--> statement-breakpoint
CREATE INDEX "job_email_checks_review" ON "job_email_checks" USING btree ("checked_at") WHERE "job_email_checks"."status" = 'review';--> statement-breakpoint
ALTER TABLE "job_email_checks" ENABLE ROW LEVEL SECURITY;
