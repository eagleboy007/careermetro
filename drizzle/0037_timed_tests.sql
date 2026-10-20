-- Timed tests (FR-50 part 2, docs/plans/elite-plan.md): 12 bank questions in 15 minutes, picked and scored by code.
CREATE TABLE "timed_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_slug" text NOT NULL,
	"question_ids" text[] NOT NULL,
	"picks" smallint[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"right" smallint
);
--> statement-breakpoint
ALTER TABLE "timed_tests" ADD CONSTRAINT "timed_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timed_tests_user" ON "timed_tests" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "timed_tests" ENABLE ROW LEVEL SECURITY;
