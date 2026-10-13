-- Company chats (dev/corporate-plan.md, build step 5): conversations gain org_id, and application_id becomes a real link to applications, one chat per application. Expand only: one new nullable column; the foreign key and the unique index on application_id are safe because no code before this migration ever wrote that column (every row holds null). No new table, so no new row level security line; conversations already has it (0015).
ALTER TABLE "conversations" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_application" ON "conversations" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "conversations_org" ON "conversations" USING btree ("org_id","last_message_at");
