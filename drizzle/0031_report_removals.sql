-- Reports removal tools (FR-46, docs/plans/reports-review-plan.md; Project manager's decision under Milin's delegation, 2026-10-15): from /admin/reports an admin can hide a reported message and suspend an account, and undo either. messages gain hidden_at, hidden_by (the admin) and hidden_reason; users gain suspended_at, suspended_by (the admin) and suspended_reason. All nullable, reasons 1 to 500 characters. Hiding never deletes the body, and nothing is hard-deleted. The admin columns are set null if that admin's account goes, and are not indexed: they are never queried by. Expand only: nullable columns and constraints on those new columns. No new table, so no new row level security; both tables already have it.
ALTER TABLE "messages" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "hidden_by" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_suspended_by_users_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_hidden_reason_length" CHECK (char_length("messages"."hidden_reason") between 1 and 500);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_suspended_reason_length" CHECK (char_length("users"."suspended_reason") between 1 and 500);