-- My jobs phase 1, part 2: Prepare for this job (docs/plans/application-tracker-plan.md section 3, handoff 12m with C18; approved by Milin 2026-10-28). A mock interview can be for one job in My jobs: focus 'job' ("This job's skills") and job_save_id, set null when that job is deleted, so the round and its feedback stay. Expand only: a new nullable column with its key and index, and the focus check widened.
ALTER TABLE "mock_sessions" ADD COLUMN "job_save_id" uuid;--> statement-breakpoint
ALTER TABLE "mock_sessions" ADD CONSTRAINT "mock_sessions_job_save_id_job_saves_id_fk" FOREIGN KEY ("job_save_id") REFERENCES "public"."job_saves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mock_sessions_job_save" ON "mock_sessions" USING btree ("job_save_id");--> statement-breakpoint
ALTER TABLE "mock_sessions" DROP CONSTRAINT "mock_sessions_focus";--> statement-breakpoint
ALTER TABLE "mock_sessions" ADD CONSTRAINT "mock_sessions_focus" CHECK ("mock_sessions"."focus" in ('mix', 'gaps', 'technical', 'about', 'job'));
