CREATE TABLE "role_requests" (
	"title" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_checks" ALTER COLUMN "role_slug" DROP NOT NULL;--> statement-breakpoint
-- Server-only, like every public table (0001, 0015): no policies, so the public API can't reach it.
ALTER TABLE "role_requests" ENABLE ROW LEVEL SECURITY;
