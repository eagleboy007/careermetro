-- Account settings part 2 (dev/account-settings-plan.md, part 2 table plan): users gains username, username_changed_at and headline, with a unique index on lower(username) (the column is new, so no existing row can clash); new tables username_redirects, user_pay (owner-only pay, never logged) and user_settings (privacy and stored-only notification choices), each with row level security and no policies. Expand only: new types, tables and nullable columns.
CREATE TYPE "public"."profile_visibility" AS ENUM('signed_in', 'line', 'only_me');--> statement-breakpoint
CREATE TYPE "public"."ride_reminder" AS ENUM('18:30', '19:30', '20:30', '21:30', 'off');--> statement-breakpoint
CREATE TABLE "user_pay" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_lakh" numeric(6, 2),
	"expected_lakh" numeric(6, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pay_current" CHECK ("user_pay"."current_lakh" is null or "user_pay"."current_lakh" between 0.1 and 999),
	CONSTRAINT "user_pay_expected" CHECK ("user_pay"."expected_lakh" is null or "user_pay"."expected_lakh" between 0.1 and 999)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"profile_visibility" "profile_visibility" DEFAULT 'only_me' NOT NULL,
	"show_target_role" boolean DEFAULT false NOT NULL,
	"show_experience" boolean DEFAULT true NOT NULL,
	"show_education" boolean DEFAULT true NOT NULL,
	"show_skills" boolean DEFAULT true NOT NULL,
	"show_gaps" boolean DEFAULT false NOT NULL,
	"show_certifications" boolean DEFAULT true NOT NULL,
	"ride_reminder" "ride_reminder" DEFAULT '19:30' NOT NULL,
	"email_company_messages" boolean DEFAULT true NOT NULL,
	"email_weekly_summary" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "username_redirects" (
	"username" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "user_pay" ADD CONSTRAINT "user_pay_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_redirects" ADD CONSTRAINT "username_redirects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "username_redirects_user" ON "username_redirects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower" ON "users" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "username_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_pay" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
