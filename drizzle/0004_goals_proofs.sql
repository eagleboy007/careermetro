CREATE TYPE "public"."goal_status" AS ENUM('active', 'met', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."proof_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proof_type" AS ENUM('skill_check', 'certification', 'work');--> statement-breakpoint
CREATE TYPE "public"."proof_verifier" AS ENUM('app', 'credly', 'issuer', 'person');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('learn', 'prove');--> statement-breakpoint
CREATE TABLE "gap_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"type" "proof_type" NOT NULL,
	"status" "proof_status" DEFAULT 'pending' NOT NULL,
	"evidence" jsonb NOT NULL,
	"verifier" "proof_verifier",
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"source" text DEFAULT 'gap' NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"position" integer NOT NULL,
	"gap_analysis_id" uuid,
	"swapped_to" text,
	"skipped_at" timestamp with time zone,
	"met_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "path_steps" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "path_steps" ADD COLUMN "kind" "step_kind" DEFAULT 'learn' NOT NULL;--> statement-breakpoint
ALTER TABLE "path_steps" ADD COLUMN "source" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD CONSTRAINT "gap_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD CONSTRAINT "gap_proofs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_gap_analysis_id_gap_analyses_id_fk" FOREIGN KEY ("gap_analysis_id") REFERENCES "public"."gap_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_swapped_to_skills_id_fk" FOREIGN KEY ("swapped_to") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_proofs_user_skill" ON "gap_proofs" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_goals_skill" ON "user_goals" USING btree ("user_id","skill_id");--> statement-breakpoint
ALTER TABLE "path_steps" ADD CONSTRAINT "path_steps_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_steps_goal" ON "path_steps" USING btree ("goal_id");--> statement-breakpoint
-- Like 0001: no policies, so Supabase's public REST API can't read these tables. The server connects directly.
ALTER TABLE "user_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gap_proofs" ENABLE ROW LEVEL SECURITY;
