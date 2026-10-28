-- My jobs phase 1 (docs/plans/application-tracker-plan.md, handoff 12m with C18 and C19; approved by Milin 2026-10-28). job_checks keeps, for a job added from "Add a job you found", its link (https, at most 2,000 characters, fetched only when it is a company job board's), where it came from ('pasted' or 'board'), its city when known and the person's own copy of the description (Milin, 2026-10-28: at most 20,000 characters, private, never logged, in Download your data, deleted with the account or the row). The Gaps page's check keeps no text. job_saves becomes the person's whole list: a surrogate id replaces the (user, post) key, and each row is exactly one of a feed post or a job check (cascade with either). Unique on (user, post) and (user, check), so the Departures upserts keep their target. stage now runs 1 to 6 (5 Not this time, 6 Withdrawn; existing rows keep their numbers), with closed_at only for those two, plus interview_at and a private note of at most 2,000 characters. Row level security stays on with no policies. Expand only: new nullable columns, one key swapped for unique indexes, one column made nullable, and the stage check widened.
ALTER TABLE "job_checks" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "job_checks" ADD COLUMN "source" text DEFAULT 'pasted' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checks" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "job_checks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_source" CHECK ("job_checks"."source" in ('pasted', 'board'));--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_url" CHECK ("job_checks"."url" is null or ("job_checks"."url" like 'https://%' and char_length("job_checks"."url") <= 2000));--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_city_length" CHECK ("job_checks"."city" is null or char_length("job_checks"."city") between 1 and 60);--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_description_length" CHECK ("job_checks"."description" is null or char_length("job_checks"."description") <= 20000);--> statement-breakpoint
ALTER TABLE "job_saves" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_saves" DROP CONSTRAINT "job_saves_user_id_job_post_id_pk";--> statement-breakpoint
ALTER TABLE "job_saves" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "job_saves" ALTER COLUMN "job_post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "job_saves" ADD COLUMN "job_check_id" uuid;--> statement-breakpoint
ALTER TABLE "job_saves" ADD COLUMN "interview_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_saves" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_saves" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_job_check_id_job_checks_id_fk" FOREIGN KEY ("job_check_id") REFERENCES "public"."job_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_saves_user_post" ON "job_saves" USING btree ("user_id","job_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_saves_user_check" ON "job_saves" USING btree ("user_id","job_check_id");--> statement-breakpoint
CREATE INDEX "job_saves_job_check" ON "job_saves" USING btree ("job_check_id");--> statement-breakpoint
CREATE INDEX "job_saves_user_updated" ON "job_saves" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "job_saves" DROP CONSTRAINT "job_saves_stage";--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_stage" CHECK ("job_saves"."stage" is null or "job_saves"."stage" between 1 and 6);--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_one_job" CHECK (num_nonnulls("job_saves"."job_post_id", "job_saves"."job_check_id") = 1);--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_closed" CHECK ("job_saves"."closed_at" is null or "job_saves"."stage" in (5, 6));--> statement-breakpoint
ALTER TABLE "job_saves" ADD CONSTRAINT "job_saves_note_length" CHECK ("job_saves"."note" is null or char_length("job_saves"."note") between 1 and 2000);
