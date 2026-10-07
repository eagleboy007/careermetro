ALTER TABLE "resumes" ALTER COLUMN "file_delete_after" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "consent_id" uuid;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "client_hash" text;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resumes_anonymous_session" ON "resumes" USING btree ("anonymous_session_id");--> statement-breakpoint
CREATE INDEX "resumes_client_hash" ON "resumes" USING btree ("client_hash","created_at");