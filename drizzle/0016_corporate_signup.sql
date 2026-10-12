-- Company sign-up, team and access (dev/corporate-plan.md, build steps 1 and 2). Expand only: organizations gains nullable columns and two with defaults; it has never been written by app code (it was unused until now), so the new unique index on email_domain, a new column, can't meet duplicate rows.
CREATE TYPE "public"."org_invite_kind" AS ENUM('invite', 'request');--> statement-breakpoint
CREATE TYPE "public"."org_review_status" AS ENUM('pending', 'verified', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('admin', 'hiring', 'interviewer');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('company', 'college', 'training_partner');--> statement-breakpoint
CREATE TYPE "public"."work_email_purpose" AS ENUM('org_member', 'current_job');--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "org_invite_kind" NOT NULL,
	"role" "org_role",
	"email_hash" text,
	"email_domain" text NOT NULL,
	"user_id" uuid,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "org_invites_shape" CHECK (("org_invites"."kind" = 'invite') = ("org_invites"."email_hash" is not null) and ("org_invites"."kind" = 'request') = ("org_invites"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"work_email_domain" text NOT NULL,
	"work_email_verified_at" timestamp with time zone NOT NULL,
	"recheck_due_at" timestamp with time zone NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work_email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "work_email_purpose" NOT NULL,
	"org_id" uuid,
	"email" text,
	"code_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "type" "org_type" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email_domain" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "offices" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gstin_or_cin" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "domain_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "review_status" "org_review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "second_admin_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_email_codes" ADD CONSTRAINT "work_email_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invites_org" ON "org_invites" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "org_invites_email_hash" ON "org_invites" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "org_invites_user" ON "org_invites" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_one_active_role" ON "org_members" USING btree ("user_id") WHERE "org_members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "org_members_org" ON "org_members" USING btree ("org_id","removed_at");--> statement-breakpoint
CREATE INDEX "org_members_user" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_email_codes_user" ON "work_email_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "work_email_codes_expires" ON "work_email_codes" USING btree ("expires_at") WHERE "work_email_codes"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_email_domain" ON "organizations" USING btree ("email_domain");--> statement-breakpoint
-- As in 0001: the app reaches these tables from the server only, so row level security with no policies keeps them off Supabase's public API.
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_email_codes" ENABLE ROW LEVEL SECURITY;