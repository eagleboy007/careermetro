-- Timetable PR 6 (docs/plans/timetable-plan.md section 6): "Suggest an event". event_suggestions keeps a signed-in member's suggestion as they typed it: the organiser's https link (cleaned, never fetched by the server) and its host, title, organiser, kind, start and end, online or a city from the person city list, an area, and the cost as words. Members' suggestions need a grievance officer (pending item 15), so the only status the table allows is pending: nothing shows a suggestion to anyone but its owner (Download your data, export version 37) and admins (read only on /admin/reports), and nothing copies it into events. The same event from the same person is kept once (user, link, start), which also indexes user_id. Owner only: it goes with the account (cascade), and the daily cleanup deletes suggestions 90 days after their event ends. Row level security with no policies, like every table. Expand only: one new table and its indexes.
CREATE TABLE "event_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"host" text NOT NULL,
	"title" text NOT NULL,
	"organiser" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"city" text,
	"venue" text,
	"cost" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_suggestions_status" CHECK ("event_suggestions"."status" in ('pending')),
	CONSTRAINT "event_suggestions_kind" CHECK ("event_suggestions"."kind" in ('meetup', 'workshop', 'conference', 'online')),
	CONSTRAINT "event_suggestions_source_url" CHECK ("event_suggestions"."source_url" like 'https://%' and char_length("event_suggestions"."source_url") <= 500),
	CONSTRAINT "event_suggestions_host_length" CHECK (char_length("event_suggestions"."host") between 1 and 253),
	CONSTRAINT "event_suggestions_title_length" CHECK (char_length("event_suggestions"."title") between 1 and 160),
	CONSTRAINT "event_suggestions_organiser_length" CHECK (char_length("event_suggestions"."organiser") between 1 and 120),
	CONSTRAINT "event_suggestions_city_length" CHECK ("event_suggestions"."city" is null or char_length("event_suggestions"."city") between 1 and 60),
	CONSTRAINT "event_suggestions_venue_length" CHECK ("event_suggestions"."venue" is null or char_length("event_suggestions"."venue") between 1 and 120),
	CONSTRAINT "event_suggestions_cost_length" CHECK (char_length("event_suggestions"."cost") <= 60),
	CONSTRAINT "event_suggestions_online_no_city" CHECK (not "event_suggestions"."online" or "event_suggestions"."city" is null),
	CONSTRAINT "event_suggestions_place" CHECK ("event_suggestions"."online" or "event_suggestions"."city" is not null),
	CONSTRAINT "event_suggestions_ends_after_start" CHECK ("event_suggestions"."ends_at" >= "event_suggestions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "event_suggestions" ADD CONSTRAINT "event_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_suggestions_user_link" ON "event_suggestions" USING btree ("user_id","source_url","starts_at");--> statement-breakpoint
CREATE INDEX "event_suggestions_status_created" ON "event_suggestions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "event_suggestions_ends" ON "event_suggestions" USING btree ("ends_at");--> statement-breakpoint
ALTER TABLE "event_suggestions" ENABLE ROW LEVEL SECURITY;
