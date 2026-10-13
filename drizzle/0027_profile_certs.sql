-- Verified certifications on the profile (pending item 13, dev/profile-certs-plan.md): gap_proofs gains badge_id (the public Credly badge id from the certificate's link, so one badge is verified on one account only), checked_at (the last Credly check) and check_note (why the check didn't verify it, null when verified or never checked), plus an index for the one-account check. Expand only: three nullable columns and an index on an existing table, which already has row level security. Account deletion removes them with the proof rows (on delete cascade).
ALTER TABLE "gap_proofs" ADD COLUMN "badge_id" text;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "check_note" text;--> statement-breakpoint
CREATE INDEX "gap_proofs_badge" ON "gap_proofs" USING btree ("badge_id") WHERE "gap_proofs"."verifier" = 'credly';
