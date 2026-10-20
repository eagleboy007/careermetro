-- Build your resume (FR-36, docs/plans/resume-builder-plan.md): one draft of answers a person, and where a resume came from.
CREATE TABLE "resume_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"answers" jsonb NOT NULL,
	"resume_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_drafts" ADD CONSTRAINT "resume_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_drafts" ADD CONSTRAINT "resume_drafts_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_drafts_resume" ON "resume_drafts" USING btree ("resume_id");--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_source" CHECK ("resumes"."source" in ('upload', 'builder'));--> statement-breakpoint
ALTER TABLE "resume_drafts" ENABLE ROW LEVEL SECURITY;
