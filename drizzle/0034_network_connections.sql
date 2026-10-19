-- Network part 1 (FR-49, docs/plans/network-plan.md; plan approved by the Project manager under Milin's delegation, 2026-10-19): new table connections, one row per pair of people stored with user_a < user_b, holding a request (pending, from requested_by) or an accepted connection; the receiver's Ignore sets ignored_at, which the sender is never shown. A block either way deletes the row (app code); both accounts cascade on delete. user_settings gains people_can_find ("Let people find me by name"), off by default. profile_visibility gains 'connections' with ALTER TYPE ... ADD VALUE: Postgres can't use a value in the transaction that adds it, so nothing here does; an enum value can't be dropped, so a rollback keeps it, and an older build reads such a profile as hidden (it matches none of its cases). Row level security on with no policies, like every table. Expand only.
ALTER TYPE "public"."profile_visibility" ADD VALUE 'connections' BEFORE 'only_me';--> statement-breakpoint
CREATE TABLE "connections" (
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "connections_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "connections_pair_order" CHECK ("connections"."user_a" < "connections"."user_b"),
	CONSTRAINT "connections_requested_by" CHECK ("connections"."requested_by" = "connections"."user_a" or "connections"."requested_by" = "connections"."user_b"),
	CONSTRAINT "connections_status" CHECK ("connections"."status" in ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "people_can_find" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_user_b" ON "connections" USING btree ("user_b");--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;
