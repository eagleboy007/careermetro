-- Job search switch and notice period (handoff 6, docs/plans/job-search-plan.md, v44 gap items 7, 22, 25 and 37). Three columns on user_settings, which is owner only and already has row level security: job_search (off pauses Departures and Arrivals: no Express apply, out of company search, no Today board; existing rows get true, so no one's Departures disappear), notice_days (15, 30, 60 or 90) and resigned_on (needs notice_days). Private: never on a profile, never sent to a company, never logged. Deleted with the account (on delete cascade). Expand only: three columns and two checks, no change to foreign keys.
ALTER TABLE "user_settings" ADD COLUMN "job_search" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notice_days" smallint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "resigned_on" date;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_notice_days" CHECK ("user_settings"."notice_days" is null or "user_settings"."notice_days" in (15, 30, 60, 90));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_resigned_needs_days" CHECK ("user_settings"."resigned_on" is null or "user_settings"."notice_days" is not null);--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
