ALTER TABLE "users" ADD COLUMN "auth_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "resumes_user" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_subject");