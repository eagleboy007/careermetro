-- As in 0001: the app reaches the database from the server only, so row level security with no policies keeps these
-- tables off Supabase's public API. Migrations 0006 to 0014 created these without it; db/rls.test.ts now fails if a
-- new table is missed.
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certificate_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_checks" ENABLE ROW LEVEL SECURITY;
