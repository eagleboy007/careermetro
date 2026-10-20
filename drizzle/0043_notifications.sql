-- Notifications, in-app (docs/plans/notifications-plan.md, v44 gap item 15; approved by the Project manager under Milin's delegation, in-app only: the email part waits on RESEND_API_KEY). One row per event the bell shows: a connection request to the person, their request accepted, a company moving or closing their application, and an interview set or cancelled. Ids only, never text: names, company, job, stage and time are read from the live rows when the panel opens, so a hidden, suspended, deleted or blocked source drops out on its own. The recipient's account going deletes its rows (on delete cascade), and so does the request, application or interview going; the actor's account going sets actor_id null, and such rows are not shown. A check holds exactly the reference column each kind needs. One unread row per person, kind and source (a partial unique index), so repeated moves collapse into one. emailed_at is unused until the email part. The daily cleanup deletes read rows 60 days after read_at and any row 90 days after created_at. Every foreign key has an index. Row level security with no policies, like every table. Expand only: one new table and its indexes.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"connection_request_id" uuid,
	"application_id" uuid,
	"interview_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('connection_request', 'connection_accepted', 'application_moved', 'application_closed', 'interview_scheduled', 'interview_cancelled')),
	CONSTRAINT "notifications_refs" CHECK (("notifications"."kind" in ('connection_request', 'connection_accepted') and "notifications"."connection_request_id" is not null and "notifications"."application_id" is null and "notifications"."interview_id" is null) or ("notifications"."kind" in ('application_moved', 'application_closed') and "notifications"."application_id" is not null and "notifications"."connection_request_id" is null and "notifications"."interview_id" is null) or ("notifications"."kind" in ('interview_scheduled', 'interview_cancelled') and "notifications"."interview_id" is not null and "notifications"."connection_request_id" is null and "notifications"."application_id" is null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_connection_request_id_connection_requests_id_fk" FOREIGN KEY ("connection_request_id") REFERENCES "public"."connection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_actor" ON "notifications" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notifications_connection_request" ON "notifications" USING btree ("connection_request_id");--> statement-breakpoint
CREATE INDEX "notifications_application" ON "notifications" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "notifications_interview" ON "notifications" USING btree ("interview_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_one_unread" ON "notifications" USING btree ("user_id","kind",coalesce("notifications"."application_id", "notifications"."connection_request_id", "notifications"."interview_id")) WHERE "notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
