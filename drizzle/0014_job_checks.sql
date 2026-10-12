CREATE TABLE "job_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"role_slug" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"required_skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"nice_skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"unknown_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"text_hash" text NOT NULL,
	"ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_checks" ADD CONSTRAINT "job_checks_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_checks_resume" ON "job_checks" USING btree ("resume_id","created_at");