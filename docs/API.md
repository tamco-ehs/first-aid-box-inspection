# API Reference (Phase 2)

All routes live under `app/api/*` as Next.js App Router route handlers, run on
the Node.js runtime, and return JSON. Errors share one shape and never leak
internal detail:

```json
{ "error": { "code": "forbidden", "message": "You are not assigned to this first aid box." } }
```

Common status codes: `400` validation, `401` not logged in, `403` wrong
role / not assigned / inactive, `404` not found, `429` rate-limited, `500`
generic internal error (detail logged server-side only).

## Authorization at a glance

| Route | Method | anon | viewer | first_aider | admin |
|---|---|---|---|---|---|
| `/api/me` | GET | - | self | self | self |
| `/api/my-boxes` | GET | - | all active | assigned only | all active |
| `/api/boxes/[box_id]/inspection-template` | GET | - | read | assigned only | any active |
| `/api/inspections` | POST | - | - | assigned only | any active |
| `/api/usage` | POST | submit\* | submit | submit | submit |
| `/api/reports` | GET | - | yes | - | yes |
| `/api/cloudinary-signature` | POST | - | - | inspection | inspection + item_reference |
| `/api/admin/item-photo` | POST | - | - | - | yes |
| `/api/check-reminders` | GET | CRON_SECRET only | | | |

\* `/api/usage` accepts anonymous submissions only when
`PUBLIC_USAGE_SUBMISSION_ENABLED=true`; otherwise it requires an active login.
Nobody (except admin/viewer via `/api/reports`) can ever **read** usage logs.

Every protected route runs `requireActive()` (validates the Supabase JWT and
rejects inactive accounts) and then a role/assignment check **server-side** -
before any data is touched.

---

## A. `GET /api/me`
Caller's profile + role, for post-login routing. Uses `requireAuth` (not
`requireActive`) so a deactivated user gets their status instead of a bare 403.

```json
{ "id":"...", "full_name":"...", "employee_id":"...", "department":"...",
  "email":"...", "role":"first_aider", "is_active":true }
```

## B. `GET /api/my-boxes`
Boxes the caller may act on, each with due status, sorted
Overdue -> Due Soon -> Not Yet Inspected -> Completed. First aiders get only
their actively-assigned boxes (one box => the UI auto-preselects).

```json
{ "role":"first_aider", "count":1, "boxes":[{
  "box_id":"...", "box_code":"FAB-WH-001", "box_name":"Warehouse A First Aid Box",
  "location_description":"...", "area":"Warehouse",
  "last_inspection_date":"2026-05-01T...", "next_due_date":"2026-05-31T...",
  "due_status":"Overdue", "days_overdue":10,
  "assigned_inspectors":[{"full_name":"...","email":"...","is_primary":true}]
}]}
```

## C. `GET /api/boxes/[box_id]/inspection-template`
The checklist the inspection form is generated from. `403` if a first aider
is not assigned to the box; `404` if the box is missing/inactive.

```json
{ "box":{...}, "template":{...}, "item_count":22, "items":[{
    "box_item_id":"...", "item_name":"Yellow lotion", "measurement_type":"volume_level",
    "required_quantity":1, "unit":"bottle", "has_expiry":true, "is_critical":false,
    "current_volume_level":"Full", "current_expiry_date":null,
    "item_photo_url":"https://res.cloudinary.com/.../item-reference-photos/...jpg",
    "display_order":10 }],
  "last_inspection":{ "overall_status":"Pass", "created_at":"...", "inspector_name":"..." } }
```
`item_photo_url` is the **effective** photo (box override else template default,
`null` => UI placeholder).

## D. `POST /api/inspections`
Submit an inspection. Body:

```json
{ "box_id":"...", "notes":"optional",
  "box_photo_url":"https://res.cloudinary.com/<cloud>/image/upload/first-aid/inspection-photos/...jpg",
  "box_photo_cloudinary_public_id":"optional",
  "submitted_device":"optional",
  "inspection_items":[
    { "box_item_id":"...", "observed_quantity":12, "remarks":"optional" },
    { "box_item_id":"...", "observed_volume_level":"Below Half" },
    { "box_item_id":"...", "observed_present_status":"Missing", "expiry_date":"2027-01-01" }
  ] }
```

Server flow: validate user -> box exists & active -> box access -> validate the
photo is one of our Cloudinary inspection URLs -> load box spec -> validate &
**recompute** each item status -> compute `overall_status` -> insert inspection
(inspector pinned to `auth.uid()`, name/department re-snapshotted by trigger) ->
insert lines -> auto-create non-duplicate top-ups -> update box item state.
Any post-insert failure rolls the inspection back (atomic).

```json
{ "ok":true, "inspection_id":"...", "overall_status":"Needs Restock",
  "summary":{ "total":22,"ok":19,"low_stock":2,"missing":1,"expired":0,
              "expiring_soon":0,"topup_required":3 },
  "topups_created":3,
  "topup_items":[{"item_name":"Yellow lotion","priority":"Medium","reason":"..."}] }
```

Scoring rules live in `lib/logic/inspection.ts` (unit-tested):
- quantity: `0` => Missing; `<= 50%` of required => Low Stock; else OK.
- volume: Full/Three Quarter => OK; Half/Below Half => Low Stock; Empty => Missing.
- presence: Present => OK; Missing => Missing; Damaged => Damaged.
- expiry: past => Expired; within `expiry_warning_days` (default 60) => Expiring Soon.
- overall: **Fail** if any expired item, a critical item missing/damaged, or no
  box photo; **Needs Restock** for any other top-up trigger; else **Pass**.

## E. `POST /api/usage`
Record first aid usage. Public when `PUBLIC_USAGE_SUBMISSION_ENABLED=true`, else
login required. Validated, honeypot-guarded (`website` must be empty),
rate-limited per salted IP hash + a global hourly cap. Response is generic; no
data is echoed and history is never exposed.

```json
{ "box_id":"...", "user_name":"...", "department":"...",
  "usage_purpose":"Treated a minor cut", "items_taken":["Handyplast"], "notes":"optional" }
```
=> `201 { "ok":true, "message":"Thank you. Your first aid usage has been recorded." }`

## F. `GET /api/reports`
Admin/viewer only. Query filters (all optional): `from`, `to` (YYYY-MM-DD),
`box_id`, `area`, `inspector_id`, `department`, `status`
(Pass|Fail|Needs Restock), `issue_type`
(expired|expiring_soon|missing|low_stock|damaged|topup).

```json
{ "filters":{...},
  "dashboard":{ "total_boxes":12, "boxes_inspected_this_month":7, "overdue_boxes":2,
    "boxes_needing_topup":3, "boxes_with_expired_items":1,
    "boxes_with_expiring_soon_items":2, "open_topup_requests":5,
    "usage_logs_this_month":9 },
  "inspections":[...], "inspection_items":[...],
  "topup_requests":[...], "usage_logs":[...] }
```

## G. `POST /api/cloudinary-signature`
Short-lived signed upload params so the browser uploads directly to Cloudinary
without the API secret. `{ "upload_type": "inspection" | "item_reference" }`.
`item_reference` is admin-only; `inspection` is first_aider/admin. The folder is
fixed server-side.

```json
{ "timestamp":1717900000, "signature":"<sha1>", "api_key":"...",
  "cloud_name":"...", "folder":"first-aid/inspection-photos",
  "allowed_formats":["jpg","jpeg","png","webp"] }
```
Client upload (browser) - compress + strip EXIF via Canvas first, then:
```
POST https://api.cloudinary.com/v1_1/<cloud_name>/image/upload
form-data: file, api_key, timestamp, signature, folder
```

## H. `POST /api/admin/item-photo`
Admin sets a reference photo on a template item (all boxes using it) or one box
item (override). Exactly one id; URL must be an item-reference Cloudinary URL.

```json
{ "template_item_id":"...", "item_photo_url":"https://res.cloudinary.com/.../item-reference-photos/...webp",
  "item_photo_cloudinary_public_id":"..." }
```
=> `{ "ok":true, "target":"first_aid_kit_template_items", "id":"..." }`

## I. `GET /api/check-reminders` (cron)
Daily at `0 0 * * *` UTC = **08:00 Malaysia**. Requires
`Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically).
Doubles as a Supabase keep-alive. For each active overdue box it sends a
reminder at the 7/14/21/28-day milestones (each once), escalates to
`ADMIN_NOTIFICATION_EMAIL` at 28 days, and logs every attempt to
`reminder_logs`.

```json
{ "ok":true, "keep_alive":true, "boxes_checked":12, "reminders_processed":2,
  "results":[{"box":"Warehouse A First Aid Box","milestone":14,"days_overdue":15,
              "sent":true,"recipients":2,"escalated":false}] }
```

### Manual test
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/check-reminders
```
