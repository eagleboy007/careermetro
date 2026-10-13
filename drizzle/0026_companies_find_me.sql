-- Let companies find me (pending item 19, dev/companies-find-me-plan.md): user_settings gains companies_can_find (off by default); conversations gain job_id (a found chat's job) and conversation_kind gains 'found' (a company's message request to someone it found); new tables company_profile_views (which companies opened a person's profile, kept 30 days) and company_blocks (companies a person blocked), each with row level security and no policies. Expand only: new types, tables, a nullable column, a column with a default and an enum value.
ALTER TYPE "public"."conversation_kind" ADD VALUE 'found';--> statement-breakpoint
CREATE TABLE "company_blocks" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_blocks_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "company_profile_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "companies_can_find" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_blocks" ADD CONSTRAINT "company_blocks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_views" ADD CONSTRAINT "company_profile_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_views" ADD CONSTRAINT "company_profile_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profile_views" ADD CONSTRAINT "company_profile_views_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_blocks_org" ON "company_blocks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "company_profile_views_user" ON "company_profile_views" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "company_profile_views_org" ON "company_profile_views" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "company_profile_views_job" ON "company_profile_views" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "company_profile_views_viewed" ON "company_profile_views" USING btree ("viewed_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_job" ON "conversations" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "company_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_profile_views" ENABLE ROW LEVEL SECURITY;
