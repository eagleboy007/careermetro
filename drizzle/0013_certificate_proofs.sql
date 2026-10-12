-- 'renew' is added and not used here. Postgres refuses a new enum value inside the transaction that added it, and drizzle runs every pending migration in one transaction, so a migration that uses 'renew' must ship in a later release than this one.
ALTER TYPE "public"."goal_status" ADD VALUE 'renew';--> statement-breakpoint
CREATE TABLE "certificate_credentials" (
	"cert_id" text NOT NULL,
	"credential_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_credentials_cert_id_credential_key_pk" PRIMARY KEY("cert_id","credential_key")
);
--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "cert_id" text;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "issued_on" date;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "expires_on" date;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "credential_key" text;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "name_matched" boolean;--> statement-breakpoint
ALTER TABLE "gap_proofs" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "certificate_credentials" ADD CONSTRAINT "certificate_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_credentials_user" ON "certificate_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gap_proofs_credential" ON "gap_proofs" USING btree ("cert_id","credential_key");--> statement-breakpoint
CREATE INDEX "gap_proofs_expires" ON "gap_proofs" USING btree ("expires_on") WHERE "gap_proofs"."status" = 'accepted' and "gap_proofs"."expires_on" is not null;