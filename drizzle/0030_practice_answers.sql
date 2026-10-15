-- Practice (handoff 12h, FR-21 to FR-23, dev/practice-match-plan.md): new table practice_answers, one row per "Get feedback": the bank question's id, the answer (kept 30 days, deleted by the daily clean-up, in the data download, never logged), the model's feedback in words (null when it wasn't available) and the person's own confidence rating (1 to 4, null until rated). With row level security and no policies, like every table. Account deletion removes the rows (on delete cascade). Expand only: one new table and its indexes.
CREATE TABLE "practice_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"feedback" jsonb,
	"confidence" smallint,
	"ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_answers_answer_length" CHECK (char_length("practice_answers"."answer") between 1 and 4000),
	CONSTRAINT "practice_answers_confidence" CHECK ("practice_answers"."confidence" is null or "practice_answers"."confidence" between 1 and 4)
);
--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_answers" ADD CONSTRAINT "practice_answers_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_answers_user" ON "practice_answers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "practice_answers_created" ON "practice_answers" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "practice_answers" ENABLE ROW LEVEL SECURITY;