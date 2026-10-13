ALTER TABLE "user_goals" ADD COLUMN "job_check_id" uuid;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_job_check_id_job_checks_id_fk" FOREIGN KEY ("job_check_id") REFERENCES "public"."job_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_goals_job_check" ON "user_goals" USING btree ("job_check_id");