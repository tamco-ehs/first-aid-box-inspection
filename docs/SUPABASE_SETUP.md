# Supabase Setup Notes

Step-by-step from zero to a working, locked-down database. Takes ~15 minutes.

## 1. Create the project

1. [supabase.com](https://supabase.com) > New project.
2. Pick the **Singapore (ap-southeast-1)** region (closest to Malaysia).
3. Use a strong database password (only needed for direct DB access; store it
   in your password manager).

## 2. Run the SQL (in this exact order)

Dashboard > **SQL Editor** > New query. Paste and run each file as its own
query, in order:

1. `supabase/schema.sql` - tables, constraints, triggers, helper function, view
2. `supabase/rls_policies.sql` - RLS + privilege hardening (safe to re-run)
3. `supabase/seed.sql` - baseline template (22 items) + 2 example boxes

Do **not** run anything from `supabase/tests/` against Supabase - those files
fake the auth environment and are for the local test runner only.

After running, Table Editor should show 11 tables, each marked "RLS enabled".

## 3. Lock down authentication

Authentication > Sign In / Providers (naming varies slightly by dashboard
version):

- Keep **Email** enabled.
- **Disable new user signups** ("Allow new users to sign up" = off). Admins
  create all accounts; even if this is ever re-enabled, the signup trigger
  creates new users as inactive viewers with no access.
- Leave **anonymous sign-ins disabled**.
- Under password settings: minimum length **12+**, enable **leaked password
  protection**.

## 4. Create the first users

1. Authentication > Users > **Add user** > "Create new user".
   Enter the email + a strong temporary password and tick **Auto Confirm
   User**. (Optionally add `{"full_name": "Person Name"}` as user metadata.)
2. Repeat for your admin and each first aider.
3. Each new user automatically gets a profile with `role = 'viewer'`,
   `is_active = false` - they can log in but do nothing yet.

## 5. Promote the admin and first aiders

Open `supabase/seed.sql`, section 4. Copy each user's UUID from
Authentication > Users, paste it into the placeholder `update` statements
(name, employee id, department, role), and run them in the SQL Editor.

## 6. Assign boxes to first aiders

Uncomment and edit the `box_assignments` insert at the bottom of `seed.sql`
(box UUIDs for the two seeded boxes are in the file). From Phase 2 onward,
admins do this in the UI instead.

## 7. Collect the keys for `.env.local`

Project Settings > **API**:

| Key | Goes into |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` (server only - never expose, never prefix with NEXT_PUBLIC_) |

Copy `.env.example` to `.env.local` and fill these in. In Vercel, add the same
variables under Project Settings > Environment Variables.

## 8. Sanity-check the lockdown (recommended)

SQL Editor:

```sql
-- All 11 tables must show rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public';

-- anon must have NO privileges on any app table (0 rows expected)
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';
```

For a deeper check, run the full role-by-role test suite locally (no Docker
required): `npm install && npm run test:sql`.

## Maintenance notes

- **New box:** insert into `boxes` (or Phase 2 admin UI), then
  `select public.apply_template_to_box('<box-uuid>');` to copy the checklist in.
- **Checklist changes:** edit `first_aid_kit_template_items` rows (name,
  quantity, expiry, threshold, photo, order). Re-running
  `apply_template_to_box` on a box adds newly added template items to it;
  existing box items are never overwritten.
- **Leavers:** set `profiles.is_active = false` (instantly removes all access,
  keeps history); deactivate their `box_assignments` and assign a replacement.
- **Never** paste the service role key into frontend code, client components,
  or anything prefixed `NEXT_PUBLIC_`.
