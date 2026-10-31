-- Junction, the community board, part 1 (docs/plans/junction-plan.md sections 2 and 3, FR-61; plan approved by Milin 2026-10-31 with his decisions: no pre-moderation, Following is connections only, auto-hold at the first child_safety report or 3 reports from accounts at least 7 days old, no model calls, comments deleted with their post). interests is the shared tag table (seeded with common interests, then one row per distinct name key already in user_interests, the earliest name kept), and user_interests gains interest_id, filled here for every row and nullable until a later contract step, so Me, the Life line and Network read the same names. junction_posts, junction_post_interests, junction_comments, junction_votes, junction_comment_votes, junction_reshares, junction_saves and junction_pins hold posts and what people do with them; counts are denormalised on the post. junction_removals keeps a copy of removed content for 180 days under IT Rules rule 3(1)(g) (no foreign key to the content or author, so it outlives both; legal_hold keeps it longer), junction_appeals one appeal per removal, and grievance_intake complaints and orders an admin logs from outside the app. report_target gains post and comment and report_reason five reasons (nothing here uses them, since a new enum value can't be used in the transaction that adds it); reports gains reference (shown to the reporter, unique) and decide_by (stored at filing). notifications gains post_id, comment_id, report_id and appeal_id, and its kind and refs checks are rewritten for six new kinds, each holding exactly one reference. user_settings gains show_junction_posts (on) and junction_rules_version. Every foreign key is indexed except admin-id columns. Row level security with no policies, like every table. Expand only: new tables, new columns with defaults or nullable, enum values, and two widened checks.
ALTER TYPE "public"."report_target" ADD VALUE 'post';--> statement-breakpoint
ALTER TYPE "public"."report_target" ADD VALUE 'comment';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'child_safety';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'hate';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'privacy';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'misleading';--> statement-breakpoint
ALTER TYPE "public"."report_reason" ADD VALUE 'copyright';--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	CONSTRAINT "interests_name_length" CHECK (char_length("interests"."name") between 1 and 40),
	CONSTRAINT "interests_key_length" CHECK (char_length("interests"."name_key") between 1 and 40),
	CONSTRAINT "interests_hidden_reason" CHECK (char_length("interests"."hidden_reason") between 1 and 500),
	CONSTRAINT "interests_hidden_pair" CHECK (("interests"."hidden_at" is null) = ("interests"."hidden_reason" is null))
);--> statement-breakpoint
CREATE TABLE "junction_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_url" text,
	"link_host" text,
	"resource_id" uuid,
	"route_slug" text,
	"goal_id" uuid,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"reshare_count" integer DEFAULT 0 NOT NULL,
	"top_points" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"hidden_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "junction_posts_kind" CHECK ("junction_posts"."kind" in ('idea', 'question', 'win', 'resource')),
	CONSTRAINT "junction_posts_title_length" CHECK (char_length("junction_posts"."title") between 5 and 140),
	CONSTRAINT "junction_posts_body_length" CHECK (char_length("junction_posts"."body") <= 2000),
	CONSTRAINT "junction_posts_link" CHECK ("junction_posts"."link_url" is null or ("junction_posts"."link_url" like 'https://%' and char_length("junction_posts"."link_url") <= 500 and "junction_posts"."link_host" is not null)),
	CONSTRAINT "junction_posts_resource_link" CHECK ("junction_posts"."kind" <> 'resource' or "junction_posts"."link_url" is not null),
	CONSTRAINT "junction_posts_route_length" CHECK (char_length("junction_posts"."route_slug") between 1 and 120),
	CONSTRAINT "junction_posts_status" CHECK ("junction_posts"."status" in ('visible', 'pending', 'held', 'hidden')),
	CONSTRAINT "junction_posts_hidden_pair" CHECK (("junction_posts"."status" = 'hidden') = ("junction_posts"."hidden_at" is not null)),
	CONSTRAINT "junction_posts_hidden_reason" CHECK (char_length("junction_posts"."hidden_reason") between 1 and 500),
	CONSTRAINT "junction_posts_counts" CHECK ("junction_posts"."upvote_count" >= 0 and "junction_posts"."comment_count" >= 0 and "junction_posts"."reshare_count" >= 0 and "junction_posts"."top_points" >= 0)
);--> statement-breakpoint
CREATE TABLE "junction_post_interests" (
	"post_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	CONSTRAINT "junction_post_interests_post_id_interest_id_pk" PRIMARY KEY("post_id","interest_id")
);--> statement-breakpoint
CREATE TABLE "junction_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"hidden_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "junction_comments_body_length" CHECK (char_length("junction_comments"."body") between 1 and 1000),
	CONSTRAINT "junction_comments_status" CHECK ("junction_comments"."status" in ('visible', 'held', 'hidden')),
	CONSTRAINT "junction_comments_hidden_pair" CHECK (("junction_comments"."status" = 'hidden') = ("junction_comments"."hidden_at" is not null)),
	CONSTRAINT "junction_comments_hidden_reason" CHECK (char_length("junction_comments"."hidden_reason") between 1 and 500),
	CONSTRAINT "junction_comments_counts" CHECK ("junction_comments"."upvote_count" >= 0)
);--> statement-breakpoint
CREATE TABLE "junction_votes" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "junction_votes_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);--> statement-breakpoint
CREATE TABLE "junction_comment_votes" (
	"user_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "junction_comment_votes_user_id_comment_id_pk" PRIMARY KEY("user_id","comment_id")
);--> statement-breakpoint
CREATE TABLE "junction_reshares" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "junction_reshares_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);--> statement-breakpoint
CREATE TABLE "junction_saves" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "junction_saves_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);--> statement-breakpoint
CREATE TABLE "junction_pins" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "junction_pins_user_id_post_id_pk" PRIMARY KEY("user_id","post_id"),
	CONSTRAINT "junction_pins_position" CHECK ("junction_pins"."position" between 1 and 3)
);--> statement-breakpoint
CREATE TABLE "junction_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"target_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_username" text,
	"snapshot" jsonb NOT NULL,
	"rule" text,
	"cause" text NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"order_ref" text,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	CONSTRAINT "junction_removals_target_kind" CHECK ("junction_removals"."target" in ('post', 'comment')),
	CONSTRAINT "junction_removals_cause" CHECK ("junction_removals"."cause" in ('report', 'order', 'author_deleted_reported')),
	CONSTRAINT "junction_removals_order_ref" CHECK (char_length("junction_removals"."order_ref") <= 200)
);--> statement-breakpoint
CREATE TABLE "junction_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"removal_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "junction_appeals_note_length" CHECK (char_length("junction_appeals"."note") between 1 and 1000),
	CONSTRAINT "junction_appeals_status" CHECK ("junction_appeals"."status" in ('open', 'upheld', 'reversed')),
	CONSTRAINT "junction_appeals_decided" CHECK (("junction_appeals"."status" = 'open') = ("junction_appeals"."decided_at" is null)),
	CONSTRAINT "junction_appeals_reason" CHECK ("junction_appeals"."status" = 'open' or char_length("junction_appeals"."decision_reason") between 1 and 500)
);--> statement-breakpoint
CREATE TABLE "grievance_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"from_label" text NOT NULL,
	"reference" text,
	"target" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"report_id" uuid,
	"logged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grievance_intake_source" CHECK ("grievance_intake"."source" in ('email', 'court_order', 'government_notice', 'other')),
	CONSTRAINT "grievance_intake_from_length" CHECK (char_length("grievance_intake"."from_label") between 1 and 200),
	CONSTRAINT "grievance_intake_reference_length" CHECK (char_length("grievance_intake"."reference") <= 200)
);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "show_junction_posts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "junction_rules_version" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "decide_by" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reference" ON "reports" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "reports_decide_by" ON "reports" USING btree ("decide_by") WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reports_open_target" ON "reports" USING btree ("target","target_id") WHERE "reports"."status" = 'open';--> statement-breakpoint
ALTER TABLE "user_interests" ADD COLUMN "interest_id" uuid;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_interests_interest" ON "user_interests" USING btree ("interest_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "comment_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "appeal_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_junction_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."junction_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appeal_id_junction_appeals_id_fk" FOREIGN KEY ("appeal_id") REFERENCES "public"."junction_appeals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_post" ON "notifications" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "notifications_comment" ON "notifications" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "notifications_report" ON "notifications" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "notifications_appeal" ON "notifications" USING btree ("appeal_id");--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('connection_request', 'connection_accepted', 'application_moved', 'application_closed', 'interview_scheduled', 'interview_cancelled', 'junction_comment', 'junction_post_hidden', 'junction_comment_hidden', 'junction_appeal_decided', 'report_decided', 'report_filed'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_refs";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_refs" CHECK (num_nonnulls("notifications"."connection_request_id", "notifications"."application_id", "notifications"."interview_id", "notifications"."post_id", "notifications"."comment_id", "notifications"."report_id", "notifications"."appeal_id") = 1 and (("notifications"."kind" in ('connection_request', 'connection_accepted') and "notifications"."connection_request_id" is not null) or ("notifications"."kind" in ('application_moved', 'application_closed') and "notifications"."application_id" is not null) or ("notifications"."kind" in ('interview_scheduled', 'interview_cancelled') and "notifications"."interview_id" is not null) or ("notifications"."kind" in ('junction_comment', 'junction_post_hidden') and "notifications"."post_id" is not null) or ("notifications"."kind" = 'junction_comment_hidden' and "notifications"."comment_id" is not null) or ("notifications"."kind" = 'junction_appeal_decided' and "notifications"."appeal_id" is not null) or ("notifications"."kind" in ('report_decided', 'report_filed') and "notifications"."report_id" is not null)));--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_posts" ADD CONSTRAINT "junction_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_posts" ADD CONSTRAINT "junction_posts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_posts" ADD CONSTRAINT "junction_posts_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_posts" ADD CONSTRAINT "junction_posts_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_post_interests" ADD CONSTRAINT "junction_post_interests_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_post_interests" ADD CONSTRAINT "junction_post_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_comments" ADD CONSTRAINT "junction_comments_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_comments" ADD CONSTRAINT "junction_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_comments" ADD CONSTRAINT "junction_comments_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_votes" ADD CONSTRAINT "junction_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_votes" ADD CONSTRAINT "junction_votes_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_comment_votes" ADD CONSTRAINT "junction_comment_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_comment_votes" ADD CONSTRAINT "junction_comment_votes_comment_id_junction_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."junction_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_reshares" ADD CONSTRAINT "junction_reshares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_reshares" ADD CONSTRAINT "junction_reshares_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_saves" ADD CONSTRAINT "junction_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_saves" ADD CONSTRAINT "junction_saves_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_pins" ADD CONSTRAINT "junction_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_pins" ADD CONSTRAINT "junction_pins_post_id_junction_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."junction_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_removals" ADD CONSTRAINT "junction_removals_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_appeals" ADD CONSTRAINT "junction_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_appeals" ADD CONSTRAINT "junction_appeals_removal_id_junction_removals_id_fk" FOREIGN KEY ("removal_id") REFERENCES "public"."junction_removals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_appeals" ADD CONSTRAINT "junction_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_intake" ADD CONSTRAINT "grievance_intake_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_intake" ADD CONSTRAINT "grievance_intake_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interests_name_key" ON "interests" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "interests_created_by" ON "interests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "junction_posts_author_created" ON "junction_posts" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "junction_posts_resource" ON "junction_posts" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "junction_posts_goal" ON "junction_posts" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "junction_posts_new" ON "junction_posts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "junction_posts"."status" = 'visible' and "junction_posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "junction_posts_route" ON "junction_posts" USING btree ("route_slug","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "junction_posts"."status" = 'visible' and "junction_posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "junction_posts_top" ON "junction_posts" USING btree ("top_points" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "junction_posts"."status" = 'visible' and "junction_posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "junction_post_interests_interest" ON "junction_post_interests" USING btree ("interest_id","post_id");--> statement-breakpoint
CREATE INDEX "junction_comments_post_created" ON "junction_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "junction_comments_author" ON "junction_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "junction_votes_post" ON "junction_votes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "junction_comment_votes_comment" ON "junction_comment_votes" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "junction_reshares_post" ON "junction_reshares" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "junction_reshares_user_created" ON "junction_reshares" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "junction_saves_post" ON "junction_saves" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "junction_pins_user_position" ON "junction_pins" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "junction_pins_post" ON "junction_pins" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "junction_removals_target" ON "junction_removals" USING btree ("target","target_id");--> statement-breakpoint
CREATE INDEX "junction_removals_author" ON "junction_removals" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "junction_removals_purge" ON "junction_removals" USING btree ("purge_after") WHERE "junction_removals"."legal_hold" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "junction_appeals_removal" ON "junction_appeals" USING btree ("removal_id");--> statement-breakpoint
CREATE INDEX "junction_appeals_user" ON "junction_appeals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "junction_appeals_status_created" ON "junction_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "grievance_intake_report" ON "grievance_intake" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "grievance_intake_logged_by" ON "grievance_intake" USING btree ("logged_by");--> statement-breakpoint
INSERT INTO "interests" ("name", "name_key") VALUES ('AI', 'ai'), ('Data', 'data'), ('Design', 'design'), ('Marketing', 'marketing'), ('Public speaking', 'public speaking'), ('Writing', 'writing'), ('Finance', 'finance'), ('Product', 'product'), ('Photography', 'photography'), ('Cloud', 'cloud'), ('Cyber security', 'cyber security'), ('Open source', 'open source'), ('Career change', 'career change'), ('Interviews', 'interviews'), ('Resumes', 'resumes'), ('Freelancing', 'freelancing'), ('Startups', 'startups'), ('Leadership', 'leadership'), ('Excel', 'excel'), ('SQL', 'sql'), ('Python', 'python'), ('JavaScript', 'javascript'), ('Machine learning', 'machine learning'), ('UX research', 'ux research'), ('Sales', 'sales'), ('Customer success', 'customer success'), ('HR', 'hr'), ('Operations', 'operations'), ('Project management', 'project management'), ('Accounting', 'accounting'), ('Healthcare', 'healthcare'), ('Teaching', 'teaching'), ('Content creation', 'content creation'), ('Video editing', 'video editing'), ('Networking', 'networking'), ('Certifications', 'certifications'), ('Higher studies', 'higher studies'), ('Remote work', 'remote work'), ('Mental health', 'mental health'), ('Productivity', 'productivity') ON CONFLICT ("name_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "interests" ("name", "name_key", "created_by", "created_at") SELECT DISTINCT ON ("name_key") "name", "name_key", "user_id", "created_at" FROM "user_interests" ORDER BY "name_key", "created_at", "user_id" ON CONFLICT ("name_key") DO NOTHING;--> statement-breakpoint
UPDATE "user_interests" SET "interest_id" = "interests"."id" FROM "interests" WHERE "interests"."name_key" = "user_interests"."name_key" AND "user_interests"."interest_id" IS NULL;--> statement-breakpoint
ALTER TABLE "interests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_post_interests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_comment_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_reshares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_saves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_pins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_removals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "junction_appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grievance_intake" ENABLE ROW LEVEL SECURITY;
