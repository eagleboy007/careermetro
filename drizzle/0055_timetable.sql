-- Timetable PR 1 (docs/plans/timetable-plan.md sections 1 to 3; data model signed off by the Project manager under Milin's delegation, 2026-10-30). events holds our short summary of an event from an organiser's public feed or a moderated suggestion: its source and the source's own key (unique together, so a re-read updates rather than duplicates), the https link to the organiser's page, title, organiser, kind, start and end, online or a city from the person city list, an area (never a street address), the cost as words (never a payment link) and a status (feed events start live, suggestions pending). It belongs to no one, and there is no lat/lng: distance is worked out between city centres. The organiser's description is never kept; event_topics keeps only the skill ids and interest topic keys code found in it (no model call), and goes with its event. event_rsvps is the person's own Save or I'm going, with the goal a prep task is for (only when going); owner only, in Download your data (export version 36), and goes with the account or the event. events_digests keeps one row per person per India week (its Monday) for the Monday digest, like weekly_emails, so a re-run never sends twice; it goes with the account and the daily cleanup deletes rows over 90 days old. user_settings gains the radius (25 or 100 km, 25 by default), Include online (on) and the digest (off until the person turns it on). Row level security with no policies, like every table. Expand only: four new tables, their indexes, and three columns with defaults.
ALTER TABLE "user_settings" ADD COLUMN "events_radius_km" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "events_online" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "events_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_events_radius_km" CHECK ("user_settings"."events_radius_km" in (25, 100));--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"source_url" text NOT NULL,
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
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_source" CHECK ("events"."source" in ('feed', 'suggestion')),
	CONSTRAINT "events_kind" CHECK ("events"."kind" in ('meetup', 'workshop', 'conference', 'online')),
	CONSTRAINT "events_status" CHECK ("events"."status" in ('pending', 'live', 'hidden', 'cancelled')),
	CONSTRAINT "events_source_key_length" CHECK (char_length("events"."source_key") between 1 and 200),
	CONSTRAINT "events_source_url" CHECK ("events"."source_url" like 'https://%' and char_length("events"."source_url") <= 2000),
	CONSTRAINT "events_title_length" CHECK (char_length("events"."title") between 1 and 160),
	CONSTRAINT "events_organiser_length" CHECK (char_length("events"."organiser") between 1 and 120),
	CONSTRAINT "events_city_length" CHECK ("events"."city" is null or char_length("events"."city") between 1 and 60),
	CONSTRAINT "events_venue_length" CHECK ("events"."venue" is null or char_length("events"."venue") between 1 and 120),
	CONSTRAINT "events_cost_length" CHECK (char_length("events"."cost") <= 60),
	CONSTRAINT "events_online_no_city" CHECK (not "events"."online" or "events"."city" is null),
	CONSTRAINT "events_ends_after_start" CHECK ("events"."ends_at" >= "events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "event_topics" (
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "event_topics_event_id_kind_topic_pk" PRIMARY KEY("event_id","kind","topic"),
	CONSTRAINT "event_topics_kind" CHECK ("event_topics"."kind" in ('skill', 'interest')),
	CONSTRAINT "event_topics_topic_length" CHECK (char_length("event_topics"."topic") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"state" text NOT NULL,
	"goal_skill_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_user_id_event_id_pk" PRIMARY KEY("user_id","event_id"),
	CONSTRAINT "event_rsvps_state" CHECK ("event_rsvps"."state" in ('saved', 'going')),
	CONSTRAINT "event_rsvps_goal_length" CHECK ("event_rsvps"."goal_skill_id" is null or char_length("event_rsvps"."goal_skill_id") between 1 and 80),
	CONSTRAINT "event_rsvps_goal_when_going" CHECK ("event_rsvps"."goal_skill_id" is null or "event_rsvps"."state" = 'going')
);
--> statement-breakpoint
CREATE TABLE "events_digests" (
	"user_id" uuid NOT NULL,
	"week" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_digests_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
ALTER TABLE "event_topics" ADD CONSTRAINT "event_topics_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_digests" ADD CONSTRAINT "events_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_key" ON "events" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "events_status_starts" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "event_topics_topic" ON "event_topics" USING btree ("kind","topic");--> statement-breakpoint
CREATE INDEX "event_rsvps_event" ON "event_rsvps" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_digests_sent" ON "events_digests" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_rsvps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events_digests" ENABLE ROW LEVEL SECURITY;
