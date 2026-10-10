CREATE TABLE "ride_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"task_ids" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "ride_days" ADD CONSTRAINT "ride_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Like 0001: no policies, so Supabase's public REST API can't read this table. The server connects directly.
ALTER TABLE "ride_days" ENABLE ROW LEVEL SECURITY;
