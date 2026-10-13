-- Interviews (dev/corporate-plan.md, build step 6): new tables candidate_slots, interviews, interview_interviewers and interview_feedback, and their enums. Expand only: new types and tables, nothing existing changes. The phone a candidate shares goes, encrypted, in applications.phone_shared, which 0020 already made.
CREATE TYPE "public"."interview_recommendation" AS ENUM('yes', 'not_sure', 'no');--> statement-breakpoint
CREATE TYPE "public"."interview_round" AS ENUM('team');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('proposed', 'accepted', 'declined', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "candidate_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"minutes" integer DEFAULT 60 NOT NULL,
	"ask_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_slots_minutes" CHECK ("candidate_slots"."minutes" between 15 and 240)
);
--> statement-breakpoint
CREATE TABLE "interview_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"interviewer_id" uuid,
	"text" text NOT NULL,
	"recommendation" "interview_recommendation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_feedback_text_length" CHECK (char_length("interview_feedback"."text") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "interview_interviewers" (
	"interview_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "interview_interviewers_interview_id_user_id_pk" PRIMARY KEY("interview_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"round" "interview_round" DEFAULT 'team' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"status" "interview_status" DEFAULT 'proposed' NOT NULL,
	"slot_id" uuid,
	"created_by" uuid,
	"phone_shared" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interviews_minutes" CHECK ("interviews"."minutes" between 15 and 240)
);
--> statement-breakpoint
ALTER TABLE "candidate_slots" ADD CONSTRAINT "candidate_slots_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_slots" ADD CONSTRAINT "candidate_slots_ask_message_id_messages_id_fk" FOREIGN KEY ("ask_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_slot_id_candidate_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."candidate_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_slots_application" ON "candidate_slots" USING btree ("application_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_slots_ask_start" ON "candidate_slots" USING btree ("ask_message_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_feedback_interviewer" ON "interview_feedback" USING btree ("interview_id","interviewer_id");--> statement-breakpoint
CREATE INDEX "interview_feedback_by" ON "interview_feedback" USING btree ("interviewer_id");--> statement-breakpoint
CREATE INDEX "interview_interviewers_user" ON "interview_interviewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interviews_application" ON "interviews" USING btree ("application_id","starts_at");--> statement-breakpoint
CREATE INDEX "interviews_starts" ON "interviews" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "interviews_slot" ON "interviews" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "interviews_created_by" ON "interviews" USING btree ("created_by");--> statement-breakpoint
-- As in 0001: the app reaches these tables from the server only, so row level security with no policies keeps them off Supabase's public API.
ALTER TABLE "candidate_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interview_feedback" ENABLE ROW LEVEL SECURITY;