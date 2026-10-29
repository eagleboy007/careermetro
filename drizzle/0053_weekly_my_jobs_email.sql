-- My jobs phase 2, the weekly My jobs email (C22, approved by Milin 2026-10-29; docs/plans/application-tracker-plan.md section 6). job_saves.status_at is when the status last changed (a note doesn't move it), backfilled from the applied date, else the saved date, else the last change, and new rows take now() (nullable, as migrations only expand; reads fall back to the applied date, then the last change); "waiting on a reply" counts 7 days from it. user_settings.email_off_token is the email's one-tap "Turn it off" token (random, base64url, unique, made on the first send, replaced each time it is used). weekly_emails keeps one row per person per India week (its Monday) so a re-run never sends twice; it goes with the account and the daily cleanup deletes rows over 90 days old. No email content is kept. Row level security with no policies, like every table. Expand only: two new columns and one new table.
ALTER TABLE "job_saves" ADD COLUMN "status_at" timestamp with time zone;--> statement-breakpoint
UPDATE "job_saves" SET "status_at" = coalesce("applied_at", "saved_at", "updated_at");--> statement-breakpoint
ALTER TABLE "job_saves" ALTER COLUMN "status_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "email_off_token" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_email_off_token_unique" UNIQUE("email_off_token");--> statement-breakpoint
CREATE TABLE "weekly_emails" (
	"user_id" uuid NOT NULL,
	"week" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_emails_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
ALTER TABLE "weekly_emails" ADD CONSTRAINT "weekly_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_emails_sent" ON "weekly_emails" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "weekly_emails" ENABLE ROW LEVEL SECURITY;
