# Database Structure

Eleven tables in three groups: **master data** (what should be in each box and
who looks after it), **activity records** (what actually happened), and
**system logs**.

```
                         MASTER DATA
  profiles ─────┐
      │         │ box_assignments (M:N)
      │         ▼
      │       boxes ──── template_id ───► first_aid_kit_templates
      │         │                              │
      │         │ box_items ◄── instantiated ──┘ first_aid_kit_template_items
      │         ▼                                      (item master + photo)
      │
      │                  ACTIVITY RECORDS
      ├──► inspections ──► inspection_items ──► topup_requests
      │         (header + box photo)  (lines)      (restock workflow)
      │
      │                  SYSTEM LOGS
      └──  first_aid_usage_logs (public submissions, write-only)
           reminder_logs        (cron audit trail)
```

## Master data

### `profiles`
One row per auth user (`id` = `auth.users.id`). Carries `role`
(admin / first_aider / viewer) and `is_active` - the two values every RLS
policy checks. Created automatically by trigger on signup as an **inactive
viewer**; an admin promotes from there. `email` is a convenience copy of the
auth email; `employee_id` is unique when present.

### `first_aid_kit_templates`
The checklist master. The seed creates one: **"Current First Aid Box
Baseline"** - the list EHS currently maintains. It is data, not code: admins
can rename it, add versions, or retire it (`is_active = false`).
`guideline_reference` deliberately states the list is *pending verification
against the latest DOSH guidance* - no legal claim until admin confirms.

### `first_aid_kit_template_items`
One row per checklist item (22 seeded). Everything the inspection UI needs is
admin-editable here:

- `measurement_type` - how the item is checked: `quantity` (countable),
  `volume_level` (Full / Three Quarter / Half / Below Half / Empty - lotions,
  Dettol, Optrex), `present_absent` (scissors, splints).
- `required_quantity` + `unit`, `display_order` for card ordering.
- `has_expiry` + `expiry_warning_days` (default 60) for "expiring soon" logic.
- `restock_threshold_type` (`below_half` / `fixed_quantity` / `any_missing` /
  `expired_only`) + `restock_threshold_quantity` - when a top-up is raised.
- `is_critical` - flags items whose absence should escalate priority.
- `item_photo_url` - the **reference photo** shown on every checklist card so
  the first aider can identify the item. Nullable; UI shows a placeholder.

### `boxes`
One row per physical box (`box_code` like `FAB-WH-001`, name, location, area,
inspection frequency, optional QR URL). Points at the template it follows.
Soft-delete via `is_active`; hard deletes are blocked once history exists.

### `box_assignments`
M:N between boxes and first aiders, admin-managed. One box -> many aiders, one
aider -> many boxes; `is_primary_responsible` marks the lead. A partial unique
index allows only one *active* assignment per (box, person) while keeping
history rows. **This table drives first-aider visibility everywhere**: a first
aider can see and inspect exactly the active boxes they hold an active
assignment for. After login, Phase 2 loads the user's assignments: exactly one
box -> auto-preselect; several -> show only that list.

### `box_items`
The expected setup of each actual box, instantiated from the template by
`apply_template_to_box(box_id)` (idempotent - also syncs newly added template
items onto existing boxes). Carries per-box stock state: `expiry_date` of the
actual stock, `current_quantity` / `current_volume_level` /
`current_present_status` (updated server-side after each inspection), and an
optional **item photo override** for box-specific appearance.

### `box_items_effective` (view)
What the inspection page renders: each box item with
`effective_item_photo_url` = box override if set, else the template reference
photo, plus display order, criticality, and threshold metadata from the
template. `security_invoker` - it never widens access beyond the caller's RLS.

## Activity records

### `inspections` (append-only)
Header per submitted inspection: box, inspector, overall status
(Pass / Fail / Needs Restock), notes, device info, and the **live box photo**
(Cloudinary URL) proving actual condition - separate from item reference
photos. `inspector_name` / `inspector_department` are snapshotted from the
profile by trigger (client values ignored), so history survives staff changes.
No UPDATE exists for anyone; admin can delete a bad record and its lines
cascade.

### `inspection_items` (append-only)
One line per checklist item per inspection: observed quantity / volume /
presence, expiry seen, computed `item_status` (OK / Low Stock / Missing /
Expired / Expiring Soon / Damaged / Not Applicable) and the boolean flags
(`is_below_half`, `is_expired`, `expires_soon`, `topup_required`). Values are
denormalized snapshots so old reports stay accurate after template edits.

### `topup_requests`
Restock workflow. Auto-created by the server (service role) during submission
whenever a line is expired, expiring soon, missing, damaged, empty, or below
half - carrying the evidence (quantities, volume, expiry) and a priority.
Admin moves `status` through Open -> In Progress -> Completed / Rejected with
`completed_by` / `completed_at`. Survives deletion of its source inspection
(links null out, evidence fields remain).

## System logs

### `first_aid_usage_logs`
"I took something from the box" records from factory staff: name, department,
purpose, `items_taken` (JSON), optional notes. Inserted **only** by the
validated, rate-limited server endpoint (service role) - no direct write
policy exists for anyone, and only admin/viewer can read. `client_ip_hash`
(salted SHA-256) supports rate limiting without storing raw IPs.

### `reminder_logs`
Audit trail for Phase 3 email reminders (`due_soon` / `overdue`, recipient,
provider message id, status, error). The cron consults the latest row per
(box, type) before sending - this is the duplicate-reminder guard. Written by
service role only; read by admin only.

## Conventions

- UUID primary keys via `gen_random_uuid()` (built into Postgres 13+).
- `created_at` / `updated_at` timestamptz; `updated_at` maintained by trigger.
- Soft deletes (`is_active`) everywhere a row can be referenced by history.
- FK behaviour: history-preserving `set null` for people and template links on
  records; `cascade` only where the child is meaningless without the parent
  (template items, assignments, box items, inspection lines).
- CHECK constraints mirror every enum and cap every text field - the DB is the
  last line of defense, not the only one (see SECURITY.md).
