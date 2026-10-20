-- Mock interviews (FR-50 part 3, docs/plans/elite-plan.md): mock_sessions holds the role, length, focus, the bank question ids picked by code, the times, the summary in words and the one AI call for feedback; mock_answers holds each answer by position (kept 30 days by the daily clean-up, never logged) with the model's "what worked" and "add next time". Row level security with no policies, like every table. Account deletion removes both (on delete cascade). Expand only: two new tables and their indexes.
CREATE TABLE "mock_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_slug" text NOT NULL,
	"length" text NOT NULL,
	"focus" text NOT NULL,
	"question_ids" text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"feedback" jsonb,
	"ai_call_id" uuid,
	CONSTRAINT "mock_sessions_length" CHECK ("mock_sessions"."length" in ('quick', 'full')),
	CONSTRAINT "mock_sessions_focus" CHECK ("mock_sessions"."focus" in ('mix', 'gaps', 'technical', 'about'))
);
--> statement-breakpoint
CREATE TABLE "mock_answers" (
	"session_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"answer" text NOT NULL,
	"what_worked" text,
	"add_next_time" text,
	CONSTRAINT "mock_answers_session_id_position_pk" PRIMARY KEY("session_id","position"),
	CONSTRAINT "mock_answers_answer_length" CHECK (char_length("mock_answers"."answer") between 1 and 4000),
	CONSTRAINT "mock_answers_position" CHECK ("mock_answers"."position" between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "mock_sessions" ADD CONSTRAINT "mock_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_sessions" ADD CONSTRAINT "mock_sessions_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_answers" ADD CONSTRAINT "mock_answers_session_id_mock_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mock_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mock_sessions_user" ON "mock_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "mock_sessions_started" ON "mock_sessions" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "mock_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mock_answers" ENABLE ROW LEVEL SECURITY;
