CREATE INDEX IF NOT EXISTS "consents_user" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gap_analyses_profile" ON "gap_analyses" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gap_analyses_job_description" ON "gap_analyses" USING btree ("job_description_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_descriptions_user" ON "job_descriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paths_gap_analysis" ON "paths" USING btree ("gap_analysis_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_checks_resource" ON "resource_checks" USING btree ("resource_id","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_goals_gap_analysis" ON "user_goals" USING btree ("gap_analysis_id");