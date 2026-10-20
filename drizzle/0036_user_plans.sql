-- Elite, free in the beta (FR-50, docs/plans/elite-plan.md): one plan row a person. elite_since null is Free. No billing.
CREATE TABLE "user_plans" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"elite_since" timestamp with time zone,
	"badge_shown" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ENABLE ROW LEVEL SECURITY;
