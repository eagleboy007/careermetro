-- Data only (Testing T48, dev/profile-certs-plan.md decision 19): a Credly badge fills a goal only once a Credly check
-- has confirmed it. Certificates saved before that rule, accepted on a Credly link without a verification, stop
-- counting as Met. Old code reads them as held proofs, so this works before and after the code that needs it.
-- Goals they filled are brought in line by the daily job (reopenUnconfirmedGoals in src/lib/goals/store.ts, from
-- /api/cron/cleanup) and by the next sync on the person's own visit.

-- Credly already named another earner: refused, like a typed name mismatch.
UPDATE "gap_proofs"
SET "status" = 'rejected', "held_reason" = NULL, "verifier" = NULL, "verified_at" = NULL
WHERE "type" = 'certification'
  AND "status" = 'accepted'
  AND "verifier" IS NULL
  AND "badge_id" IS NOT NULL
  AND "check_note" = 'earner_name';
--> statement-breakpoint
-- Their credentials are free again for the real owner, unless another of that person's proofs still uses them.
DELETE FROM "certificate_credentials" cc
WHERE EXISTS (
    SELECT 1 FROM "gap_proofs" gp
    WHERE gp."user_id" = cc."user_id" AND gp."cert_id" = cc."cert_id" AND gp."credential_key" = cc."credential_key"
      AND gp."status" = 'rejected' AND gp."check_note" = 'earner_name'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "gap_proofs" gp
    WHERE gp."user_id" = cc."user_id" AND gp."cert_id" = cc."cert_id" AND gp."credential_key" = cc."credential_key"
      AND gp."status" <> 'rejected'
  );
--> statement-breakpoint
-- Every other unverified Credly badge waits for its check ("Added by you, check pending"), filling nothing. That
-- includes Credly links with no badge id (accepted before links needed one, Testing review B1): they can't be checked,
-- so they wait until the person adds the certificate again with its badge link.
UPDATE "gap_proofs"
SET "status" = 'pending', "held_reason" = 'credly_check', "verified_at" = NULL
WHERE "type" = 'certification'
  AND "status" = 'accepted'
  AND "verifier" IS NULL
  AND ("badge_id" IS NOT NULL OR "evidence"->>'url' ~* '^https://(www\.)?(credly\.com|youracclaim\.com)/');
