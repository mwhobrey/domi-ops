-- WHO-449: Google sign-in bounced people straight back to the login page after Better Auth 1.7.7.
-- Better Auth 1.7.0 to 1.7.2 matched an account on (provider, account id, issuer). Migration 0064 gave every existing row a
-- made-up issuer ("local:oauth:google"), so a Google sign-in under 1.7.2 could miss the old row and quietly add a second one
-- for the same person and the same Google account. 1.7.3 and later match on (provider, account id) alone and treat two matches
-- as fatal ("Multiple accounts match the same accountId"), so those people could no longer sign in with Google.
--
-- Repair: keep one row per person and Google account. Prefer the row Better Auth wrote itself over the backfilled one, then the
-- one that holds a refresh token, then the most recently updated. Then make the pair unique, so it cannot happen again.
DELETE FROM "ba_accounts" a
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider_id, account_id, user_id
           ORDER BY (issuer IS NOT NULL AND issuer LIKE 'local:%') ASC,
                    (refresh_token IS NOT NULL) DESC,
                    updated_at DESC,
                    created_at DESC,
                    id
         ) AS rn
  FROM "ba_accounts"
) d
WHERE a.id = d.id AND d.rn > 1;

-- Two different people sharing one provider account cannot be told apart automatically. Leave those rows alone and say so,
-- rather than deleting someone's link or failing the whole deploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ba_accounts" GROUP BY provider_id, account_id HAVING count(*) > 1) THEN
    RAISE WARNING 'ba_accounts still has the same (provider_id, account_id) on different users; the unique index was not added. Resolve them by hand (WHO-449).';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "ba_accounts_provider_account_uidx" ON "ba_accounts" ("provider_id", "account_id");
  END IF;
END $$;
