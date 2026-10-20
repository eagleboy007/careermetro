-- Library part 2 (docs/plans/library-part-2-plan.md, v44 gap item 48; approved by the Project manager under Milin's delegation). user_resources holds the person's own marks on a catalog resource: saved_at (the bookmark), finished_at ("I finished this", the box only) and on_ride_at (Add to my rides); owner only, deleted with the account or the resource (on delete cascade), and a row with none of the three is deleted, not kept. resource_reports is "Report a broken link" with a fixed reason and no note, so nothing typed is stored; one open report per person and resource; it outlives the reporter (user_id set null). resource_suggestions is "Suggest a free resource": an https link with tracking parameters stripped (never fetched by the server), its host and the goal's skill (null is Other); one per person and link; it outlives the account (user_id set null). Decided reports and suggestions are deleted 180 days after decided_at by the daily cleanup. decided_by is the admin, set null if that account goes, and not indexed: never queried by. resources gets hidden_at for an admin's Hide link, apart from healthy, which the daily link check writes. Row level security with no policies, like every table. Expand only: three new tables, their indexes, and one nullable column.
ALTER TABLE "resources" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "user_resources" (
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"saved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"on_ride_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_resources_user_id_resource_id_pk" PRIMARY KEY("user_id","resource_id"),
	CONSTRAINT "user_resources_not_empty" CHECK ("user_resources"."saved_at" is not null or "user_resources"."finished_at" is not null or "user_resources"."on_ride_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "resource_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "resource_reports_reason" CHECK ("resource_reports"."reason" in ('broken', 'not_free', 'outdated', 'other')),
	CONSTRAINT "resource_reports_status" CHECK ("resource_reports"."status" in ('open', 'hidden', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "resource_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"skill_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "resource_suggestions_url" CHECK ("resource_suggestions"."url" like 'https://%' and char_length("resource_suggestions"."url") <= 500),
	CONSTRAINT "resource_suggestions_host_length" CHECK (char_length("resource_suggestions"."host") between 1 and 253),
	CONSTRAINT "resource_suggestions_status" CHECK ("resource_suggestions"."status" in ('open', 'accepted', 'duplicate', 'declined')),
	CONSTRAINT "resource_suggestions_decline_reason" CHECK (("resource_suggestions"."status" = 'declined') = ("resource_suggestions"."decline_reason" is not null) and ("resource_suggestions"."decline_reason" is null or "resource_suggestions"."decline_reason" in ('not_free', 'paywall', 'affiliate', 'off_topic', 'other')))
);
--> statement-breakpoint
ALTER TABLE "user_resources" ADD CONSTRAINT "user_resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_resources" ADD CONSTRAINT "user_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reports" ADD CONSTRAINT "resource_reports_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reports" ADD CONSTRAINT "resource_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reports" ADD CONSTRAINT "resource_reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_suggestions" ADD CONSTRAINT "resource_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_suggestions" ADD CONSTRAINT "resource_suggestions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_suggestions" ADD CONSTRAINT "resource_suggestions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_resources_resource" ON "user_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_reports_open_once" ON "resource_reports" USING btree ("resource_id","user_id") WHERE "resource_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "resource_reports_status_created" ON "resource_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "resource_reports_resource" ON "resource_reports" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_reports_user" ON "resource_reports" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_suggestions_user_url" ON "resource_suggestions" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "resource_suggestions_status_created" ON "resource_suggestions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "resource_suggestions_skill" ON "resource_suggestions" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "user_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resource_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "resource_suggestions" ENABLE ROW LEVEL SECURITY;
