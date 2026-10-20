-- Me editing (docs/plans/me-editing-plan.md, v44 gap item 23; approved by the Project manager under Milin's delegation). What a person adds on Me by hand, all owner only and kept until the person deletes it or the account goes (on delete cascade); no cleanup job. me_roles is "+ Add role": title, company, start and end month (YYYY-MM), and at most one current row per person (a partial unique index); ended rows have an end month on or after the start. me_education is "+ Add" under Education, with a free-text year. stories holds hand-written Situation, Task, Action, Result stories (no model call in v1), each part at most 400 characters; goal_id is one of the person's own goals and is set null when that goal goes; source is "user" for now ("resume", "goal" and "college" are kept for drafting later). story_boxes holds each story's boxes (at least one, checked in the store). user_interests holds interests as typed with a lowercase, single-spaced key, one per key. The SMART check is worked out when a story is shown and never stored. The matcher, gaps and company Match keep reading the confirmed resume profile only. Row level security with no policies, like every table. Expand only: five new tables and their indexes.
CREATE TABLE "me_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"employer" text NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "me_roles_title_length" CHECK (char_length("me_roles"."title") between 1 and 120),
	CONSTRAINT "me_roles_employer_length" CHECK (char_length("me_roles"."employer") between 1 and 120),
	CONSTRAINT "me_roles_start_month" CHECK ("me_roles"."start_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "me_roles_end_month" CHECK ("me_roles"."end_month" is null or "me_roles"."end_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "me_roles_end_after_start" CHECK ("me_roles"."end_month" is null or "me_roles"."end_month" >= "me_roles"."start_month"),
	CONSTRAINT "me_roles_current_open" CHECK ("me_roles"."is_current" = ("me_roles"."end_month" is null))
);
--> statement-breakpoint
CREATE TABLE "me_education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"qualification" text NOT NULL,
	"institution" text NOT NULL,
	"year" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "me_education_qualification_length" CHECK (char_length("me_education"."qualification") between 1 and 160),
	CONSTRAINT "me_education_institution_length" CHECK (char_length("me_education"."institution") between 1 and 160),
	CONSTRAINT "me_education_year_length" CHECK ("me_education"."year" is null or char_length("me_education"."year") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"where_text" text DEFAULT '' NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"task" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"goal_id" uuid,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stories_title_length" CHECK (char_length("stories"."title") between 1 and 120),
	CONSTRAINT "stories_where_length" CHECK (char_length("stories"."where_text") <= 120),
	CONSTRAINT "stories_parts_length" CHECK (char_length("stories"."situation") <= 400 and char_length("stories"."task") <= 400 and char_length("stories"."action") <= 400 and char_length("stories"."result") <= 400),
	CONSTRAINT "stories_source" CHECK ("stories"."source" in ('user', 'resume', 'goal', 'college'))
);
--> statement-breakpoint
CREATE TABLE "story_boxes" (
	"story_id" uuid NOT NULL,
	"box" text NOT NULL,
	CONSTRAINT "story_boxes_story_id_box_pk" PRIMARY KEY("story_id","box"),
	CONSTRAINT "story_boxes_box" CHECK ("story_boxes"."box" in ('Ownership', 'Problem solving', 'Delivering results', 'Learning', 'Working with others', 'Speaking up'))
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_interests_user_id_name_key_pk" PRIMARY KEY("user_id","name_key"),
	CONSTRAINT "user_interests_name_length" CHECK (char_length("user_interests"."name") between 1 and 40),
	CONSTRAINT "user_interests_key_length" CHECK (char_length("user_interests"."name_key") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "me_roles" ADD CONSTRAINT "me_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "me_education" ADD CONSTRAINT "me_education_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_boxes" ADD CONSTRAINT "story_boxes_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "me_roles_user_start" ON "me_roles" USING btree ("user_id","start_month");--> statement-breakpoint
CREATE UNIQUE INDEX "me_roles_one_current" ON "me_roles" USING btree ("user_id") WHERE "me_roles"."is_current";--> statement-breakpoint
CREATE INDEX "me_education_user" ON "me_education" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stories_user_updated" ON "stories" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "stories_goal" ON "stories" USING btree ("goal_id");--> statement-breakpoint
ALTER TABLE "me_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "me_education" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story_boxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_interests" ENABLE ROW LEVEL SECURITY;
