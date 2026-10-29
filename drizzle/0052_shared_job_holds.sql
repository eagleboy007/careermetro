-- My jobs phase 2, share from the phone (C21, approved by Milin 2026-10-29; docs/plans/application-tracker-plan.md section 5): shared_job_holds keeps what a phone's share sheet sent to POST /share (the text, cut to 12,000 characters, and an https link) until Departures opens it. user_id is set when the person was signed in and goes with the account; otherwise only the browser holding the cm_share cookie can open the hold. Read once and deleted on read; refused after an hour, and the daily cleanup deletes older holds. Never logged and never exported. Row level security with no policies, like every table. Expand only: one new table.
CREATE TABLE "shared_job_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"text" text DEFAULT '' NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_job_holds_text_length" CHECK (char_length("shared_job_holds"."text") <= 12000),
	CONSTRAINT "shared_job_holds_url" CHECK ("shared_job_holds"."url" is null or ("shared_job_holds"."url" like 'https://%' and char_length("shared_job_holds"."url") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "shared_job_holds" ADD CONSTRAINT "shared_job_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_job_holds_created" ON "shared_job_holds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shared_job_holds_user" ON "shared_job_holds" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "shared_job_holds" ENABLE ROW LEVEL SECURITY;
