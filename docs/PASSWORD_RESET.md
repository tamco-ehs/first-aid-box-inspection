# Password reset deployment and verification

The application requests a recovery token from Supabase Auth on the server and
sends it through the existing Brevo/Resend email helper. Supabase still verifies
the one-time token and updates the password. No password is sent by email.

## Before deployment

1. Run `supabase/password_reset_rate_limits.sql` in the **First Aid** Supabase
   project's SQL editor. It is additive and safe to rerun; do not rerun schema.sql.
2. Confirm the Vercel production environment contains the existing Supabase URL,
   anon key, service-role key, `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, approved
   `REMINDER_FROM_EMAIL`, and
   `NEXT_PUBLIC_APP_URL=https://first-aid-box-inspection.vercel.app`.
3. Deploy the app. This flow does not use Supabase's built-in email sender or
   require a new SMTP credential. Keep the reset redirect allowlist for old emails.
4. Request one reset for a designated test account. Check Brevo Transactional
   logs for delivery, rejection, bounce, or suppression. API acceptance alone
   does not prove inbox delivery.
5. Open the newest email in another browser. Submit a new password, then sign in
   with it. Confirm the old password and reused link fail. Do not change a real
   user's password for testing.

## Behavior and protections

- New links put `token_hash` in the fragment so it is not sent in navigation logs.
- Loading a link does not verify it; submission verifies once, then updates the
  password using an isolated, memory-only recovery client.
- Normal login sessions cannot stand in for a missing or invalid recovery link.
- Password policy failures allow retry using the already verified session.
- Legacy PKCE links are exchanged once, after stripping the code from the URL.
  These old links still need the originating browser's verifier cookie.
- Request limits are atomic across serverless instances: one request per email
  per 60 seconds, five per email per hour, twenty per IP per hour, and one hundred
  globally per hour. Unknown addresses count equally. Server errors fail closed.
- Successful requests return the same generic response for unknown and inactive
  accounts. Recovery tokens, passwords, and email addresses are not logged.
- Provider failures return an error, not a success message. Server logs contain
  only a diagnostic code. Missing migration: `reset_rate_limit_unavailable`.
- Counters contain HMAC hashes, are accessible only to the service role, and
  entries older than a day are cleaned during subsequent requests.
- Brevo link tracking should be disabled for authentication emails when possible.
  Confirm the delivered link preserves the fragment during the inbox test.

## Local checks

`npm run typecheck`, `npm test`, and `npm run build` cover compilation, request
and recovery behavior, and the migration against disposable PostgreSQL (PGlite).
The request/recovery tests use fake email/auth adapters; they do not prove that
the production provider delivered an email or that production Auth is configured.
