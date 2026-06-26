# Security Model

How authentication, authorization, and data protection work in this system.

## 1. Authentication

- **Supabase Auth, email + password.** Email is the login ID: it is native to
  Supabase (password reset, rate-limited login, optional MFA later) and avoids
  building a custom credential scheme around employee IDs. `employee_id` is
  stored on the profile for identification and reporting.
- **Self-signup is disabled** in the Supabase dashboard. Admins create accounts
  (Authentication > Users > Add user).
- **Safe-by-default onboarding:** a database trigger (`handle_new_user`) creates
  a profile for every new auth user with `role = 'viewer'` and
  `is_active = false`. A brand-new account - however it was created - can log
  in but can access **nothing** until an admin activates it and assigns a role.
- **Kill switch:** setting `profiles.is_active = false` instantly removes every
  capability (all policies check it via `active_role()`), without deleting the
  person's history.

## 2. Roles and what they can do

| Capability | admin | first_aider | viewer | anon (no login) |
|---|---|---|---|---|
| Manage users / roles / activation | yes | - | - | - |
| Manage boxes, templates, checklist items, item photos | yes | - | - | - |
| Assign first aiders to boxes | yes | - | - | - |
| See boxes | all | **only assigned, active** | all active | - |
| See checklist (template + box items + photos) | all | only for assigned boxes | - | - |
| Submit inspections | -* | only for assigned boxes, only as themselves | - | - |
| Read inspections | all | **own submissions only** | all | - |
| Top-up requests | manage all | read (assigned boxes) | read all | - |
| Usage logs | read + delete | - | read | submit-only via server endpoint |
| Reminder logs | read | - | - | - |

\* Per spec, admins do not submit inspections. A one-line commented toggle in
`rls_policies.sql` (`inspections_insert_first_aider`) enables it if EHS wants
admins to inspect too.

## 3. Three enforcement layers

1. **Database (RLS)** - the source of truth. Every table has RLS enabled and
   deny-by-default policies. Even a compromised or buggy client cannot exceed
   them, because the browser only ever holds the anon key + the user's JWT.
2. **Server-side API routes (Phase 2)** - validate every submission (zod),
   enforce business rules (e.g. auto-creating top-ups), rate-limit the public
   usage endpoint. The service role key lives only here.
3. **Frontend navigation (Phase 2)** - hides what the user cannot do. Pure UX;
   never trusted.

## 4. Row Level Security design

- **Deny by default.** RLS on + no matching policy = no access. `anon` has zero
  policies *and* zero table grants (`revoke all ... from anon`), so even a
  future policy mistake cannot expose data publicly. `authenticated` keeps only
  the privileges some policy can actually allow (e.g. UPDATE on `inspections`
  is not even granted - inspections are immutable for everyone via the API).
- **Helper functions** (`security definer`, locked `search_path`, execute
  revoked from `anon`/`public`):
  - `active_role()` - caller's role, NULL if missing or deactivated profile.
  - `is_assigned_to_box(box_id)` - does the caller hold an active assignment?
  These avoid recursive policy evaluation and keep every policy readable.
- **Anti-spoofing:** `inspections.inspector_id` must equal `auth.uid()` (policy)
  and `inspector_name`/`department` are overwritten from the profile by a
  trigger - whatever the client sends is ignored.
- **Cross-box injection blocked:** an inspection line may only reference a
  `box_item` belonging to the same box as its parent inspection, and only into
  the caller's own inspection.
- **Integrity backstops in the schema:** CHECK constraints on every enum,
  length caps on every free-text field, non-negative quantities, Cloudinary
  URL prefixes for photo fields, one active assignment per (box, person), no
  duplicate active items per box.

## 5. Service role key boundaries

The service role key bypasses RLS, so it is confined to server code for four
jobs only, and is never prefixed `NEXT_PUBLIC_`:

1. Public usage-log submissions (after validation + rate limiting).
2. Auto-creating `topup_requests` and updating `box_items` current state during
   inspection submission.
3. The Phase 3 reminder cron (reads schedules, writes `reminder_logs`).
4. Admin user management (creating accounts, resets).

Inspections themselves are inserted with the **user's own JWT**, so RLS - not
trust in server code - decides whether the submission is allowed.

## 6. The public usage page (Phase 2 behaviour, DB ready now)

Factory staff who take an item are not system users, so usage submission can
run without login - but **write-only**:

- Submissions go through one server endpoint using the service role; there is
  **no insert policy** for anon or authenticated on `first_aid_usage_logs`.
- The endpoint is gated by `PUBLIC_USAGE_SUBMISSION_ENABLED`, validates and
  length-checks all fields (the DB CHECKs are the backstop), uses a honeypot
  field, and rate-limits per salted IP hash (`client_ip_hash`) plus a global
  hourly cap counted from the table itself - stateless-safe on serverless.
- Nothing is ever readable back: no list endpoint, generic "thank you"
  response, RLS read access limited to admin/viewer.

## 7. Image uploads (Phase 2 plan)

- Browser compresses/re-encodes via Canvas (~1600 px, JPEG/WebP) which also
  **strips EXIF/GPS metadata**, then sends to an authenticated server route.
- The route re-validates: session + role, content type in jpeg/webp/png, size
  cap (~1 MB after compression), magic-byte sniffing - then uploads to
  Cloudinary with the server-held credentials. No Cloudinary secret or signed
  upload preset ever reaches the browser.
- Stored values are only the `https://res.cloudinary.com/...` URL and public
  ID (enforced by CHECK constraints).

## 8. Search engine de-indexing (Phase 2 artifacts)

`robots.txt` with `Disallow: /`, `X-Robots-Tag: noindex, nofollow` header,
`<meta name="robots" content="noindex, nofollow">`, no sitemap, nothing
sensitive rendered on any public page. **De-indexing is not a security
control** - every sensitive page still requires login regardless.

## 9. Input handling and SQL injection

- All database access goes through the Supabase client / PostgREST with
  parameterized filters - no string-built SQL anywhere.
- Server routes validate shape, length, and enum values before any write; the
  schema's CHECK constraints catch anything that slips past.
- React escapes output by default; no `dangerouslySetInnerHTML` will be used.

## 10. Secrets

- All secrets via environment variables (see `.env.example`); `.gitignore`
  excludes every `.env*` variant.
- Browser-visible config is limited to the Supabase URL + anon key (safe only
  because RLS is comprehensive - which is why the test suite exists).

## 11. Operational cautions

- Don't demote or deactivate the **last admin** - the policies cannot warn you.
- Review the user list periodically; deactivate leavers (`is_active = false`).
- In Supabase Auth settings: keep signups disabled, set minimum password
  length >= 12, enable leaked-password protection.
- Run `npm run test:sql` after any schema or policy change - it re-verifies
  the entire access matrix in seconds.

---

# Phase 2 - Backend / API security

The API routes are the trusted server tier. They sit *in front of* the database
and add validation, business rules, and the privileged operations RLS cannot
grant directly.

## 12. The request pattern (every protected route)

1. **Authenticate** - `requireActive()` reads the session cookie and calls
   `supabase.auth.getUser()`, which validates the JWT against Supabase's auth
   server (not a local decode). Missing/expired => 401; inactive profile => 403.
2. **Authorize** - an explicit role check (`requireRole`) and, for box-scoped
   actions, an assignment check (`requireBoxAccess`). Re-derived from the DB on
   every request; the frontend is never trusted.
3. **Validate** - zod parses the body/query (shape, length, enums) and strips
   unknown fields before anything reaches the database.
4. **Act** - privileged reads/writes via the service-role client.

## 13. Two Supabase clients, two trust levels

- **User client** (`lib/supabase/server.ts`) - anon key + the caller's session.
  Subject to RLS as that user. This is the RLS-enforced path.
- **Admin client** (`lib/supabase/admin.ts`) - service role, **bypasses RLS**,
  server-only, never imported into client code. Used **only after** step 2
  above, for operations RLS intentionally forbids to end users: creating
  top-up requests, updating box-item state, reading cross-box reports, writing
  usage/reminder logs, admin management.

Because writes go through the admin client *after* an explicit server-side
authorization check, the check - not trust in client code - is the boundary.
RLS remains enabled as defense-in-depth for any anon-key path (and the entire
Phase 1 test suite still passes).

## 14. Inspection submission integrity

- The inspector is pinned to `auth.uid()`; `inspector_name`/`department` are
  re-snapshotted from the profile by a DB trigger, so a client cannot submit as
  someone else or spoof identity.
- A first aider can only submit for a box they are **actively assigned** to;
  admins may submit for any active box. Viewers/anon cannot submit.
- **All item statuses and the overall verdict are recomputed server-side** from
  the stored box spec (`lib/logic/inspection.ts`). Statuses sent by the client
  are ignored - they are derived reporting data, not a trust boundary.
- Every submitted `box_item_id` must belong to the target box (no cross-box
  injection); each observation is validated for its measurement type.
- Writes are atomic: if line/top-up/state writes fail after the header insert,
  the inspection is rolled back (compensating delete).

## 15. Image upload security

- The browser never holds a Cloudinary credential. It requests a **signed**,
  folder-restricted upload from `/api/cloudinary-signature` (auth + role
  checked), uploads directly to Cloudinary, then sends back the resulting URL.
- Stored photo URLs are re-validated with `isAllowedCloudinaryUrl`: must be
  `https://res.cloudinary.com/<our-cloud>/image/upload/.../<approved-folder>/...`
  ending in jpg/jpeg/png/webp. This blocks storing arbitrary/attacker URLs.
  The DB CHECK (`https://res.cloudinary.com/%`) is the final backstop.
- Item-reference uploads are admin-only; inspection-photo uploads are
  first_aider/admin. Folders are fixed server-side, not chosen by the client.
- Compression + EXIF/GPS stripping happen client-side via Canvas (Phase 3 UI);
  the server enforces source, folder, and format regardless.

## 16. Public usage endpoint

- Gated by `PUBLIC_USAGE_SUBMISSION_ENABLED`. When public, it is **write-only**:
  no insert policy exists for anon/authenticated, so writes go through the
  service role after validation; there is no read path for submitters.
- Defenses: zod validation, a honeypot field, per-IP rate limit (salted
  SHA-256 of the IP - raw IPs are never stored) and a global hourly cap counted
  from the table itself (stateless-safe on serverless). Generic responses only.

## 17. Cron protection

- `/api/check-reminders` requires `Authorization: Bearer <CRON_SECRET>`,
  compared with `timingSafeEqual`. Vercel Cron injects this header when the env
  var is set. The secret is never returned or logged.
- The route only reads schedules and writes `reminder_logs`; it sends each
  milestone once (dedup via the logs) and escalates at 28 days.

## 18. Search-engine de-indexing (implemented)

- `public/robots.txt` => `Disallow: /`, no sitemap.
- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on every response
  (`next.config.mjs`), plus `<meta name="robots" content="noindex,nofollow">`
  in the root layout.
- Hardening headers also set: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- As stated throughout: **de-indexing is not access control** - every sensitive
  route still authenticates and authorizes server-side.

## 19. Error hygiene

- One `safe()` wrapper turns thrown `ApiError`s into clean
  `{ error: { code, message } }` responses and everything else into a generic
  500. Stack traces, SQL, and secrets are logged server-side only, never
  returned to the client.

---

# Phase 3 - Frontend security

## 20. Client guards are UX, not enforcement

- `RequireAuth` and the login role-routing only decide what to *render*. They
  call `/api/me` and redirect; they never gate data. Every byte of data still
  comes from an API route that authenticates + authorizes server-side, or from
  the Supabase browser client under RLS. A user who tampers with client state
  gains nothing the server would not already allow.
- A logged-out deep link (e.g. a QR to `/inspect/<id>`) is remembered, the user
  is sent to `/login`, then back; the target still re-checks authorization and
  shows "Access blocked" if they are not assigned.

## 21. Admin screens run on RLS, not a privileged API

- The admin pages use the **browser Supabase client** (anon key + the admin's
  own session). Their reads/writes succeed only because the Phase 1 admin RLS
  policies allow them; a non-admin session is rejected by Postgres. The service
  role key is never shipped to the browser.
- New auth accounts are still created in the Supabase dashboard (service-role
  operation); the UI only manages role + active status via the `profiles`
  update policy.

## 22. Browser image uploads

- The browser receives only a short-lived Cloudinary **signature** from an
  authenticated, role-checked route - never the API secret. Photos are
  compressed + re-encoded via Canvas first (which strips EXIF/GPS), then sent
  straight to Cloudinary. Saved URLs are re-validated server-side
  (`isAllowedCloudinaryUrl`) before they touch the database.

## 23. Offline drafts

- Inspection drafts live in `localStorage` per box, so a weak-signal inspection
  is never lost and a failed submit can be retried. Drafts hold only the
  inspector's own in-progress observations (no secrets, no other users' data),
  are device-local, and are cleared on successful submit. The service worker
  (`public/sw.js`) deliberately **never** caches API or authenticated
  responses - only the static app shell + an offline fallback page.

## 24. Public usage page

- `/usage` identifies its box from the QR query param; it cannot list or read
  any box, inspection, or prior usage data. Submissions go through the
  validated, rate-limited, honeypot-guarded `/api/usage` endpoint, and the page
  shows only a generic thank-you. Carries the global `noindex`.

---

# Revamp (v2) - quick inspection + actions

## 25. Same security model, new workflow

- The quick inspection and the `actions` table reuse the existing boundaries
  exactly: `/api/inspections` still authenticates, checks role
  (admin/first_aider) + active + box assignment, then writes via the service
  role and raises actions; a first aider still cannot inspect an unassigned box.
- **`actions` RLS** mirrors the old top-up model: admin manages all; viewer
  reads all; first_aider reads only actions for their assigned boxes; **anon
  gets nothing**. First aiders cannot insert or close actions (no policy) - the
  server raises them and only ESH/admin closes them. Verified by
  `supabase/tests/actions_test.sql`.
- **Closing actions** (`/api/actions/close`) is admin-only and is the only path
  that bulk-updates box-item quantity/expiry; box readiness ("Ready" vs "Action
  Required") is derived from remaining open actions, never trusted from input.
- All item statuses and which actions to raise are still decided **server-side**
  from the submitted answers; the client cannot fabricate a "Ready" box that has
  unresolved issues.
