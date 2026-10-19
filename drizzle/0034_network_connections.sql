-- Network part 1 (FR-49, handoff 12j / C12, data proposal approved by the Project manager under Milin's delegation 2026-10-19; docs/plans/network-plan.md). New tables connections (one row per connected pair, user_low < user_high, with how the two know each other) and connection_requests (one open request per pair either way, kept as the record). user_settings gains people_can_find ("Let people find me", off), requests_from ("Connection requests from", anyone) and gaps_visible_to ("Your gaps show to"). profile_visibility gains 'connections'. Rulings 3 and 4: nobody's saved choice changes and the new defaults are for new users only. So every existing user without a settings row gets one now holding today's defaults (Only you, gaps off), which keeps "no row" meaning a new user; and existing rows get gaps_visible_to from show_gaps (on: profile, off: nobody), while new rows default to connections. 'connections' is added with ALTER TYPE ... ADD VALUE: Postgres can't use a value in the transaction that adds it, so nothing here does, and the column default stays 'only_me' (the app writes the new-user default itself). An enum value can't be dropped, so a rollback keeps it; an older build reads such a profile as hidden. Row level security on with no policies, like every table. Expand only.
ALTER TYPE "public"."profile_visibility" ADD VALUE 'connections' BEFORE 'only_me';--> statement-breakpoint
CREATE TABLE "connection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"how" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "connection_requests_not_self" CHECK ("connection_requests"."from_user" <> "connection_requests"."to_user"),
	CONSTRAINT "connection_requests_how" CHECK ("connection_requests"."how" in ('same_line', 'worked_together', 'studied_together', 'event', 'other')),
	CONSTRAINT "connection_requests_status" CHECK ("connection_requests"."status" in ('pending', 'accepted', 'ignored', 'withdrawn', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"how" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_user_low_user_high_pk" PRIMARY KEY("user_low","user_high"),
	CONSTRAINT "connections_pair_order" CHECK ("connections"."user_low" < "connections"."user_high"),
	CONSTRAINT "connections_how" CHECK ("connections"."how" in ('same_line', 'worked_together', 'studied_together', 'event', 'other'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "people_can_find" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "gaps_visible_to" text DEFAULT 'connections' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "requests_from" text DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
UPDATE "user_settings" SET "gaps_visible_to" = CASE WHEN "show_gaps" THEN 'profile' ELSE 'nobody' END;--> statement-breakpoint
INSERT INTO "user_settings" ("user_id", "gaps_visible_to") SELECT "id", 'nobody' FROM "users" ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_requests_open_pair" ON "connection_requests" USING btree (least("from_user", "to_user"),greatest("from_user", "to_user")) WHERE "connection_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "connection_requests_to" ON "connection_requests" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "connection_requests_from" ON "connection_requests" USING btree ("from_user","status");--> statement-breakpoint
CREATE INDEX "connections_user_high" ON "connections" USING btree ("user_high");--> statement-breakpoint
ALTER TABLE "connection_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;
