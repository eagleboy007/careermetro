-- The shared app-email budget (Testing Run 7 part 2, T151 and T153; Project manager for Milin, 2026-10-30). Resend's free plan allows 100 emails a day; sign-in codes keep 60, and app emails (the weekly My jobs email now, the Monday events digest later) share 40 an India day. app_email_days keeps one row per India day (Asia/Kolkata) with the count sent; each send takes one in a single statement that adds only while the count is under the cap, so two runs can't overspend. It holds no person, address or email content. Row level security with no policies, like every table. Expand only: one new table.
CREATE TABLE "app_email_days" (
	"day" date PRIMARY KEY NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_email_days_sent" CHECK ("app_email_days"."sent" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app_email_days" ENABLE ROW LEVEL SECURITY;
