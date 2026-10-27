-- Feed health (Project manager, 2026-10-27): job_feed_boards holds each listed board's health over the daily feed's runs, one row per (ats, board_token): bad_runs (runs in a row the board failed or kept no India post; 0 after a good run), last_problem (the failure code, or 'empty'; null after a good run), last_ok_at and updated_at. Written by the daily feed (scripts/departures/fetch-feeds.mjs, writeRun) in its run's transaction; rows of boards taken off the list are deleted there. The run summary and /api/health name the boards with 3 or more bad runs. Counts only: a board belongs to no one, and no post or person is kept. Unique on the board (the upsert's target). No foreign keys. Row level security with no policies, like every table; no grant: the feed writes as the owner login, and the T89 feed-only role (dev/feed-db-role-steps.md) would need select, insert, update and delete here. Expand only: one new table.
CREATE TABLE "job_feed_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ats" text NOT NULL,
	"board_token" text NOT NULL,
	"bad_runs" integer DEFAULT 0 NOT NULL,
	"last_problem" text,
	"last_ok_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_feed_boards_board" UNIQUE("ats","board_token"),
	CONSTRAINT "job_feed_boards_bad_runs" CHECK ("job_feed_boards"."bad_runs" >= 0),
	CONSTRAINT "job_feed_boards_problem" CHECK ("job_feed_boards"."last_problem" is null or char_length("job_feed_boards"."last_problem") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "job_feed_boards" ENABLE ROW LEVEL SECURITY;