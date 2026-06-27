# First Aid Box Inspection System

Mobile-first web application for inspecting workplace first aid boxes, recording
item usage, and auto-raising restock (top-up) requests. Built for a Malaysian
manufacturing site with many boxes across the factory and ~20-30 inspection
submissions per month.

Design principle: **simple, but never at the expense of security.** The app may
sit on a public URL, so every sensitive surface requires login and is enforced
at the database level with Row Level Security - not by hiding buttons.

## Project status

| Phase | Scope | Status |
|---|---|---|
| **1** | Database schema, auth model, roles, RLS, checklist template, box assignments, seed data | **Done - all SQL verified by automated tests** |
| **2** | Secure backend: API routes, inspection scoring + top-up automation, signed Cloudinary uploads, usage API, reporting API, reminder cron, no-index headers | **Done - logic tested, type-checked, production build passes** |
| **3** | Mobile-first PWA: login + role routing, my-boxes, inspection with photo checklist cards + offline drafts, usage page, reports dashboard + CSV, full admin | **Done - type-checked, production build passes, UI render-verified** |
| **v2** | ESH revamp: green theme, 4-question Quick Inspection that only opens the item checklist when needed, unified **actions** model, ESH dashboard + bulk **Close Action**, box readiness | **Done - SQL + logic tested, type-checked, build passes, UI render-verified** |

## Stack

- **Framework:** Next.js 15 (App Router) + TypeScript + Tailwind CSS, hosted on Vercel
- **Database / Auth:** Supabase Postgres + Supabase Auth (email login)
- **Images:** Cloudinary (item reference photos + optional live box photos), signed server-side
- **Email:** Brevo or Resend, triggered by Vercel Cron (`0 0 * * *` = 08:00 Malaysia)
- **Mobile:** PWA (installable, offline app-shell, localStorage inspection drafts)
- **QR codes:** `qrcode.react` (inspection + usage QR per box, in Admin)

> **v2 workflow (current):** a first aider taps **Inspect**, answers 4 quick
> questions, and is done — unless the **seal is broken** or an **item is
> expired**, which auto-opens the simple item checklist (OK / Low Qty / Missing
> / Expired). Every issue raises an **action** (code `FA-ACT-YYYY-NNNN`) for the
> ESH team, who clear them on the bulk **Close Action** screen; the box returns
> to **Ready** when no open actions remain. See the confirmation table below.

## Repository layout

```
app/
  layout.tsx, page.tsx          Root shell (noindex, theme, SW); / -> /login
  login/                        Email login + role-based redirect
  my-boxes/                     Assigned boxes (sorted), Start inspection
  inspect/[box_id]/             Inspection form (photo checklist + box photo)
  usage/                        Public usage form (box from QR ?box=)
  reports/                      Dashboard + 4 reports + filters + CSV
  admin/                        Boxes, assignments, checklist, box items, top-ups, users
  offline/                      Service-worker offline fallback
  api/                          Phase 2 route handlers (see docs/API.md)
components/
  ChecklistCard, PhotoCapture, BoxCard, ItemPhoto, StatusBadge,
  AppHeader, RequireAuth, Spinner, ServiceWorkerRegister
  admin/                        One component per admin section
lib/
  client/                       Browser utils: api fetch, draft (localStorage),
                                compress (Canvas), cloudinary upload, csv, types
  supabase/{server,admin,client}.ts   RLS user client, service-role, browser
  logic/                        PURE, unit-tested: inspection scoring, due,
                                reminder, top-up dedup, cloudinary URL (+ tests)
  env, http, auth, validation, cloudinary, email
supabase/
  schema.sql, rls_policies.sql, seed.sql   (Phase 1)
  tests/                        PGlite runner + RLS smoke test (LOCAL ONLY)
public/
  manifest.webmanifest, sw.js, icons/, robots.txt
docs/
  DATABASE.md, SUPABASE_SETUP.md, API.md
SECURITY.md            Auth + security model (Phases 1-3)
next.config.mjs        Security headers incl. X-Robots-Tag: noindex
tailwind.config.ts, postcss.config.mjs, vercel.json, .env.example
```

## Quickstart

1. Follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) - create the Supabase
   project, run the three SQL files in order, create the first users, promote
   your admin.
2. Copy `.env.example` to `.env.local` and fill in the keys (server-only
   secrets stay out of `NEXT_PUBLIC_*`). Configure Cloudinary + Brevo or Resend.
3. `npm install && npm run dev` and open http://localhost:3000 - you are routed
   to `/login`. Sign in to reach your boxes / reports / admin by role.
4. Deploy to Vercel; set the same env vars; the cron runs daily automatically.
   When adding or changing email env vars such as `BREVO_API_KEY`,
   `EMAIL_PROVIDER`, or `REMINDER_FROM_EMAIL`, redeploy Production before
   testing `/api/check-reminders`, because Vercel env vars only apply to new
   deployments.

## Verifying locally (no Docker needed)

```
npm install
npm test          # 52 logic unit tests + full SQL/RLS smoke test
npm run typecheck # strict TypeScript, no errors
npm run build     # Next.js production build
```

- `npm run test:logic` covers inspection scoring, due status, reminder
  milestones, top-up de-duplication, and the Cloudinary URL guard.
- `npm run test:sql` runs schema + 35 RLS policies + a role-by-role smoke test
  against an in-process Postgres (PGlite), impersonating every role (anon,
  inactive, viewer, two first aiders, admin, service role).

> Note: `npm audit` reports a moderate advisory in `postcss`, pulled in
> transitively by Next.js as **build-time** CSS tooling (not used by the API
> runtime). Do **not** run `npm audit fix --force` - it downgrades Next.js to
> v9. It clears when Next ships a patch bumping its postcss.

## Phase 1 confirmation checklist

- **Checklist stored in database, not hard-coded:** `first_aid_kit_templates` +
  `first_aid_kit_template_items` hold the 22-item EHS baseline as editable rows
  (names, quantities, expiry rules, thresholds, photos, ordering).
- **Item photo supported:** reference photo on each template item, optional
  per-box override on `box_items`, resolved by the `box_items_effective` view
  (override wins, template is the fallback; UI shows a placeholder when null).
- **Box assignment supported:** `box_assignments` join table, admin-managed.
- **One first aider, many boxes / one box, many first aiders:** M:N by design;
  verified in tests (Farid holds 2 boxes; the warehouse box has 2 aiders).
- **RLS enabled:** on all 11 tables; 35 policies; `anon` additionally has zero
  grants, so even a future policy mistake exposes nothing publicly.
- **Public users cannot access inspection data:** verified by tests - every
  table and the view reject anonymous reads and writes.

## Phase 2 confirmation checklist

| Spec self-check | Result | Where |
|---|---|---|
| First aider submits inspection for an **unassigned** box? | **No** | `requireBoxAccess` (assignment check) in [inspections route](app/api/inspections/route.ts) |
| **Inactive** user submits inspection? | **No** | `requireActive` rejects inactive accounts |
| **Public** user reads inspection data? | **No** | every read route calls `requireActive`; RLS denies anon |
| Item statuses calculated **server-side**? | **Yes** | recomputed from box spec in [logic/inspection.ts](lib/logic/inspection.ts); client values ignored |
| Low stock flagged at **<= 50%**? | **Yes** | `evaluateItem`; unit-tested |
| **Half / Below Half / Empty** volumes flagged? | **Yes** | `evaluateItem`; unit-tested |
| **Expired** and **expiring soon** flagged? | **Yes** | `evaluateItem` with `expiry_warning_days`; unit-tested |
| Top-up requests **auto-created**? | **Yes** | [logic/topup.ts](lib/logic/topup.ts) during submission |
| **Duplicate open** top-ups prevented? | **Yes** | de-dup vs existing Open/In Progress + within batch; unit-tested |
| Cloudinary API secret hidden? | **Yes** | signed server-side in [lib/cloudinary.ts](lib/cloudinary.ts); only cloud name is public |
| Cron protected? | **Yes** | `CRON_SECRET` bearer check ([check-reminders](app/api/check-reminders/route.ts)) |
| Reminder logs created? | **Yes** | one audit row per send attempt; dedup guard |

## Phase 3 confirmation checklist

| Spec self-check | Result | Where |
|---|---|---|
| One-box first aider goes straight to that box | **Yes** | login routing in [login](app/login/page.tsx) (`count === 1`) |
| Many-box first aider sees only assigned boxes | **Yes** | [my-boxes](app/my-boxes/page.tsx) from `/api/my-boxes` |
| First aider cannot inspect an unassigned box | **Yes** | API 403 -> [inspect](app/inspect/[box_id]/page.tsx) shows "Access blocked" |
| Admin reaches all boxes / viewer reaches reports only | **Yes** | role redirect + `RequireAuth roles=[…]` |
| Checklist loads from the database | **Yes** | rendered from `/api/.../inspection-template`, never hard-coded |
| Item photos appear; missing -> placeholder | **Yes** | [ItemPhoto](components/ItemPhoto.tsx) ("No reference photo") |
| Low stock at <=50%, volume Half/Below/Empty, present/absent, expiry flags | **Yes** | live in [ChecklistCard](components/ChecklistCard.tsx) via shared `evaluateItem` |
| Top-up list appears after submission | **Yes** | result screen on [inspect](app/inspect/[box_id]/page.tsx) |
| Exactly one box photo, camera capture, compressed before upload | **Yes** | [PhotoCapture](components/PhotoCapture.tsx) (`capture="environment"`, Canvas <=~150 KB) |
| Draft saved offline; survives failed submit | **Yes** | [draft util](lib/client/draft.ts) (localStorage), auto-saved every change |
| Reports filter; CSV export; usage private | **Yes** | [reports](app/reports/page.tsx) (admin/viewer only; 3 CSV exports) |
| Noindex + PWA + RLS still enforced | **Yes** | robots/header/meta; manifest + `sw.js`; all data behind authed APIs |

UI render verified by screenshot (login screen). Full end-to-end flows require
your Supabase/Cloudinary/email-provider credentials in `.env.local`.

See [docs/API.md](docs/API.md) for the full endpoint reference and the
per-route authorization matrix.

## Revamp (v2) confirmation checklist

The new ESH quick-inspection workflow, mapped to the spec's expected flow:

| Spec requirement | Result | Where |
|---|---|---|
| Home shows assigned boxes with simple status tags + one Inspect button | **Yes** | [/home](app/home/page.tsx), [BoxCard](components/BoxCard.tsx) (Issue Found / Overdue / Due Soon / Not Due) |
| 4-question Quick Inspection (accessible / clean / seal / contact) | **Yes** | [/inspect/[box_id]](app/inspect/[box_id]/page.tsx) + [YesNo](components/YesNo.tsx) |
| Item checklist opens ONLY when seal broken or item expired | **Yes** | `itemCheckRequired` ([logic/actions.ts](lib/logic/actions.ts)); unit-tested |
| Item cards: OK / Low Qty / Missing / Expired with the right inputs | **Yes** | [ItemCheckCard](components/ItemCheckCard.tsx) |
| Failed quick checks raise ESH actions (accessibility / condition / contact) | **Yes** | server `quickCheckActions`; [inspections route](app/api/inspections/route.ts) |
| One "Save Item Check" then a review summary before final submit | **Yes** | review step in [/inspect/[box_id]](app/inspect/[box_id]/page.tsx) |
| Dashboard: 7 cards + Needs Attention Today + compliance + trend | **Yes** | [/reports](app/reports/page.tsx) from [/api/reports](app/api/reports/route.ts) |
| Bulk Close Action: Select Risk / All / Clear, preselected risk, qty/expiry badges, after-refill + new-expiry, closure note | **Yes** | [/actions/[id]](app/actions/[id]/page.tsx), [/api/actions/close](app/api/actions/close/route.ts) |
| Closing updates items, records closed-by/at + note, recomputes box readiness | **Yes** | [/api/actions/close](app/api/actions/close/route.ts) |
| First aider cannot edit master data or close actions | **Yes** | RLS (admin-only writes) + role guards |
| Action codes `FA-ACT-YYYY-NNNN` | **Yes** | DB trigger ([revamp.sql](supabase/revamp.sql)); tested |

Roles: **ESH Team = `admin`**, **First Aider = `first_aider`**, viewer =
read-only. The box photo is now optional. The Phase 1 RLS suite still passes;
the actions table adds 4 policies (39 total) and its own smoke test.

## Key design decisions

- **Login by email** (Supabase native). `employee_id` is kept on the profile
  for reporting. Self-signup stays disabled; admins create accounts, and a DB
  trigger creates every new profile as an **inactive viewer** until promoted.
- **First aiders see only their assigned boxes.** After login the app loads
  `box_assignments` for the user: one box auto-preselects, several show a
  short list (Phase 2 behaviour, data model ready now).
- **Inspections are append-only.** No UPDATE exists for anyone; corrections =
  admin deletes the bad record (lines cascade), the aider re-submits.
- **Usage logs are write-only for submitters** via a validated, rate-limited
  server endpoint (service role). Only admin/viewer can read them. The
  endpoint is gated by `PUBLIC_USAGE_SUBMISSION_ENABLED`.
- **Top-up requests are system-created** during inspection submission (server
  side) when an item is expired, expiring soon, missing, damaged, empty or
  below half; admins manage their lifecycle.
- The seeded checklist wording marks the baseline as **current site practice,
  pending admin verification against the latest DOSH guidance** - it makes no
  legal compliance claim.
