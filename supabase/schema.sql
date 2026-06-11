-- =============================================================================
-- First Aid Box Inspection System - Phase 1: Database Schema
-- Target: Supabase Postgres (15+)
--
-- Run order (Supabase Dashboard > SQL Editor, as separate scripts):
--   1. schema.sql        (this file: tables, constraints, indexes, triggers)
--   2. rls_policies.sql  (row level security + privilege hardening)
--   3. seed.sql          (checklist baseline template + example boxes)
--
-- UUID support: gen_random_uuid() is built into PostgreSQL 13+ and is enabled
-- by default on every Supabase project. No extension is required.
--
-- Design principles
--   * The checklist is DATA, not code: admins edit templates/items in the DB,
--     the frontend only renders what these tables contain.
--   * CHECK constraints are a backstop. The app must still validate every
--     field server-side before writing (see SECURITY.md).
--   * Inspections and their line items are append-only audit records.
--   * Master data is soft-deleted via is_active; hard deletes of boxes with
--     history are intentionally blocked by foreign keys.
-- =============================================================================


-- =============================================================================
-- A. PROFILES - one row per auth user; role + is_active drive all RLS
-- =============================================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null
              check (char_length(full_name) between 1 and 120),
  employee_id text unique
              check (employee_id is null or employee_id ~ '^[A-Za-z0-9_-]{2,32}$'),
  department  text
              check (department is null or char_length(department) <= 120),
  email       text
              check (email is null or (char_length(email) <= 254
                     and email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  role        text not null default 'viewer'
              check (role in ('admin', 'first_aider', 'viewer')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'App profile per auth user. New sign-ups are created as INACTIVE viewers by trigger; an admin must activate them and assign a role.';
comment on column public.profiles.is_active is
  'Kill switch. Inactive users keep their login but lose all access (enforced in RLS).';
comment on column public.profiles.email is
  'Convenience copy of auth.users.email, set by the signup trigger. Login is by email via Supabase Auth.';


-- =============================================================================
-- B. FIRST_AID_KIT_TEMPLATES - checklist master (one row per checklist version)
-- =============================================================================
create table public.first_aid_kit_templates (
  id                  uuid primary key default gen_random_uuid(),
  template_name       text not null
                      check (char_length(template_name) between 1 and 150),
  guideline_reference text
                      check (guideline_reference is null or char_length(guideline_reference) <= 300),
  description         text
                      check (description is null or char_length(description) <= 1000),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.first_aid_kit_templates is
  'Checklist master. The baseline list lives here as data so admins can edit it without code changes. Not a legal compliance claim unless admin verifies against the latest DOSH guidance.';


-- =============================================================================
-- C. FIRST_AID_KIT_TEMPLATE_ITEMS - checklist item master + reference photo
-- =============================================================================
create table public.first_aid_kit_template_items (
  id                               uuid primary key default gen_random_uuid(),
  template_id                      uuid not null
                                   references public.first_aid_kit_templates (id) on delete cascade,
  item_code                        text
                                   check (item_code is null or char_length(item_code) <= 32),
  item_name                        text not null
                                   check (char_length(item_name) between 1 and 150),
  required_quantity                numeric
                                   check (required_quantity is null
                                          or (required_quantity >= 0 and required_quantity <= 10000)),
  unit                             text
                                   check (unit is null or char_length(unit) <= 30),
  measurement_type                 text not null
                                   check (measurement_type in ('quantity', 'volume_level', 'present_absent')),
  has_expiry                       boolean not null default false,
  expiry_warning_days              integer not null default 60
                                   check (expiry_warning_days between 0 and 730),
  is_critical                      boolean not null default false,
  restock_threshold_type           text
                                   check (restock_threshold_type is null or restock_threshold_type in
                                          ('below_half', 'fixed_quantity', 'any_missing', 'expired_only')),
  restock_threshold_quantity       numeric
                                   check (restock_threshold_quantity is null or restock_threshold_quantity >= 0),
  item_photo_url                   text
                                   check (item_photo_url is null
                                          or (item_photo_url like 'https://res.cloudinary.com/%'
                                              and char_length(item_photo_url) <= 500)),
  item_photo_cloudinary_public_id  text
                                   check (item_photo_cloudinary_public_id is null
                                          or char_length(item_photo_cloudinary_public_id) <= 200),
  display_order                    integer not null default 0
                                   check (display_order between 0 and 10000),
  is_active                        boolean not null default true,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now(),

  -- a fixed_quantity threshold makes no sense without the quantity
  constraint template_items_threshold_qty_required
    check (restock_threshold_type <> 'fixed_quantity' or restock_threshold_quantity is not null)
);

comment on table public.first_aid_kit_template_items is
  'Checklist item master. item_photo_url is the reference photo shown on every inspection checklist card so first aiders can identify items. Editable by admin only.';


-- =============================================================================
-- D. BOXES - each physical first aid box
-- =============================================================================
create table public.boxes (
  id                         uuid primary key default gen_random_uuid(),
  box_code                   text unique not null
                             check (box_code ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$'),
  box_name                   text not null
                             check (char_length(box_name) between 1 and 150),
  location_description       text not null
                             check (char_length(location_description) between 1 and 300),
  area                       text
                             check (area is null or char_length(area) <= 120),
  template_id                uuid
                             references public.first_aid_kit_templates (id),
  inspection_frequency_days  integer not null default 30
                             check (inspection_frequency_days between 1 and 365),
  qr_code_url                text
                             check (qr_code_url is null
                                    or (qr_code_url like 'https://%' and char_length(qr_code_url) <= 500)),
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.boxes is
  'Physical first aid boxes. Deactivate (is_active=false) instead of deleting; hard deletes are blocked once inspection/usage history exists.';


-- =============================================================================
-- E. BOX_ASSIGNMENTS - many-to-many: boxes <-> responsible first aiders
-- =============================================================================
create table public.box_assignments (
  id                      uuid primary key default gen_random_uuid(),
  box_id                  uuid not null references public.boxes (id) on delete cascade,
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  is_primary_responsible  boolean not null default false,
  assigned_at             timestamptz not null default now(),
  assigned_by             uuid references public.profiles (id) on delete set null,
  is_active               boolean not null default true
);

comment on table public.box_assignments is
  'One box can have many first aiders; one first aider can manage many boxes. RLS uses ACTIVE assignments to decide which boxes a first aider may see and inspect.';

-- a person can only hold one ACTIVE assignment per box (history rows may repeat)
create unique index uq_box_assignments_active
  on public.box_assignments (box_id, profile_id) where is_active;


-- =============================================================================
-- F. BOX_ITEMS - expected item setup for each actual box
-- =============================================================================
create table public.box_items (
  id                               uuid primary key default gen_random_uuid(),
  box_id                           uuid not null references public.boxes (id) on delete cascade,
  template_item_id                 uuid
                                   references public.first_aid_kit_template_items (id) on delete set null,
  item_name                        text not null
                                   check (char_length(item_name) between 1 and 150),
  required_quantity                numeric
                                   check (required_quantity is null
                                          or (required_quantity >= 0 and required_quantity <= 10000)),
  unit                             text
                                   check (unit is null or char_length(unit) <= 30),
  measurement_type                 text not null
                                   check (measurement_type in ('quantity', 'volume_level', 'present_absent')),
  has_expiry                       boolean not null default false,
  expiry_date                      date,
  expiry_status                    text not null default 'No expiry date recorded'
                                   check (expiry_status in
                                          ('Valid', 'Expiring soon', 'Expired',
                                           'No expiry date recorded', 'Expiry label mismatch')),
  last_verified_date               timestamptz,
  last_verified_by                 uuid references public.profiles (id) on delete set null,
  last_replaced_date               date,
  last_replaced_by                 uuid references public.profiles (id) on delete set null,
  remarks                          text
                                   check (remarks is null or char_length(remarks) <= 1000),
  replacement_photo_url            text
                                   check (replacement_photo_url is null
                                          or (replacement_photo_url like 'https://res.cloudinary.com/%'
                                              and char_length(replacement_photo_url) <= 500)),
  replacement_photo_cloudinary_public_id text
                                   check (replacement_photo_cloudinary_public_id is null
                                          or char_length(replacement_photo_cloudinary_public_id) <= 200),
  current_quantity                 numeric
                                   check (current_quantity is null or current_quantity >= 0),
  current_volume_level             text
                                   check (current_volume_level is null or current_volume_level in
                                          ('Full', 'Three Quarter', 'Half', 'Below Half', 'Empty')),
  current_present_status           text
                                   check (current_present_status is null or current_present_status in
                                          ('Present', 'Missing', 'Damaged')),
  item_photo_url                   text
                                   check (item_photo_url is null
                                          or (item_photo_url like 'https://res.cloudinary.com/%'
                                              and char_length(item_photo_url) <= 500)),
  item_photo_cloudinary_public_id  text
                                   check (item_photo_cloudinary_public_id is null
                                          or char_length(item_photo_cloudinary_public_id) <= 200),
  is_active                        boolean not null default true,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now()
);

comment on table public.box_items is
  'Per-box expected setup, instantiated from the template via apply_template_to_box(). item_photo_url here is an optional override; the effective photo falls back to the template item photo (see box_items_effective view).';
comment on column public.box_items.expiry_date is
  'Expiry of the actual stock currently in THIS box (the template only says whether the item type expires).';

-- no duplicate active items in the same box
create unique index uq_box_items_name
  on public.box_items (box_id, lower(item_name)) where is_active;


-- =============================================================================
-- G. INSPECTIONS - inspection header + live photo of the box (append-only)
-- =============================================================================
create table public.inspections (
  id                              uuid primary key default gen_random_uuid(),
  box_id                          uuid not null references public.boxes (id),
  inspector_id                    uuid references public.profiles (id) on delete set null,
  inspector_name                  text not null
                                  check (char_length(inspector_name) between 1 and 120),
  inspector_department            text
                                  check (inspector_department is null or char_length(inspector_department) <= 120),
  created_at                      timestamptz not null default now(),
  overall_status                  text not null
                                  check (overall_status in ('Pass', 'Fail', 'Needs Restock')),
  box_photo_url                   text
                                  check (box_photo_url is null
                                         or (box_photo_url like 'https://res.cloudinary.com/%'
                                             and char_length(box_photo_url) <= 500)),
  box_photo_cloudinary_public_id  text
                                  check (box_photo_cloudinary_public_id is null
                                         or char_length(box_photo_cloudinary_public_id) <= 200),
  notes                           text
                                  check (notes is null or char_length(notes) <= 2000),
  submitted_device                text
                                  check (submitted_device is null or char_length(submitted_device) <= 120),
  submitted_user_agent            text
                                  check (submitted_user_agent is null or char_length(submitted_user_agent) <= 400)
);

comment on table public.inspections is
  'Append-only audit record. inspector_name/department are snapshotted by trigger from profiles so history survives staff changes. No UPDATE policy exists for anyone.';


-- =============================================================================
-- H. INSPECTION_ITEMS - line-by-line inspection results (append-only)
-- =============================================================================
create table public.inspection_items (
  id                      uuid primary key default gen_random_uuid(),
  inspection_id           uuid not null references public.inspections (id) on delete cascade,
  box_item_id             uuid references public.box_items (id) on delete set null,
  item_name               text not null
                          check (char_length(item_name) between 1 and 150),
  required_quantity       numeric
                          check (required_quantity is null or required_quantity >= 0),
  observed_quantity       numeric
                          check (observed_quantity is null or observed_quantity >= 0),
  unit                    text
                          check (unit is null or char_length(unit) <= 30),
  measurement_type        text
                          check (measurement_type is null or measurement_type in
                                 ('quantity', 'volume_level', 'present_absent')),
  observed_volume_level   text
                          check (observed_volume_level is null or observed_volume_level in
                                 ('Full', 'Three Quarter', 'Half', 'Below Half', 'Empty')),
  observed_present_status text
                          check (observed_present_status is null or observed_present_status in
                                 ('Present', 'Missing', 'Damaged')),
  expiry_date             date,
  system_expiry_date      date,
  expiry_validation_status text
                          check (expiry_validation_status is null or expiry_validation_status in
                                 ('matches_label', 'different_date', 'no_label', 'expired',
                                  'replaced_now', 'missing_not_replaced')),
  expiry_label_mismatch   boolean not null default false,
  no_expiry_date_recorded boolean not null default false,
  item_status             text
                          check (item_status is null or item_status in
                                 ('OK', 'Low Stock', 'Missing', 'Expired', 'Expiring Soon',
                                  'No Expiry Date', 'Expiry Label Mismatch', 'Damaged', 'Not Applicable')),
  is_below_half           boolean not null default false,
  is_expired              boolean not null default false,
  expires_soon            boolean not null default false,
  topup_required          boolean not null default false,
  remarks                 text
                          check (remarks is null or char_length(remarks) <= 1000)
);

comment on table public.inspection_items is
  'One row per checklist item per inspection. Values are denormalized snapshots so reports stay correct even if the template changes later.';


-- =============================================================================
-- I. TOPUP_REQUESTS - auto-created restock requests
-- =============================================================================
create table public.topup_requests (
  id                    uuid primary key default gen_random_uuid(),
  box_id                uuid not null references public.boxes (id),
  inspection_id         uuid references public.inspections (id) on delete set null,
  inspection_item_id    uuid references public.inspection_items (id) on delete set null,
  item_name             text not null
                        check (char_length(item_name) between 1 and 150),
  reason                text
                        check (reason is null or char_length(reason) <= 500),
  required_quantity     numeric
                        check (required_quantity is null or required_quantity >= 0),
  observed_quantity     numeric
                        check (observed_quantity is null or observed_quantity >= 0),
  observed_volume_level text
                        check (observed_volume_level is null or observed_volume_level in
                               ('Full', 'Three Quarter', 'Half', 'Below Half', 'Empty')),
  expiry_date           date,
  priority              text
                        check (priority is null or priority in ('Low', 'Medium', 'High')),
  status                text not null default 'Open'
                        check (status in ('Open', 'In Progress', 'Completed', 'Rejected')),
  requested_by          uuid references public.profiles (id) on delete set null,
  requested_at          timestamptz not null default now(),
  completed_by          uuid references public.profiles (id) on delete set null,
  completed_at          timestamptz,
  remarks               text
                        check (remarks is null or char_length(remarks) <= 1000),

  constraint topup_completed_after_requested
    check (completed_at is null or completed_at >= requested_at)
);

comment on table public.topup_requests is
  'Auto-created by the server (service role) during inspection submission when an item is expired, expiring soon, missing, damaged, empty or below half. Managed (status updates) by admin.';


-- =============================================================================
-- J. EXPIRY_AUDIT_LOGS - per-box item expiry date change history
-- =============================================================================
create table public.expiry_audit_logs (
  id                    uuid primary key default gen_random_uuid(),
  box_id                uuid not null references public.boxes (id) on delete cascade,
  box_item_id           uuid not null references public.box_items (id) on delete cascade,
  old_expiry_date       date,
  new_expiry_date       date,
  changed_by            uuid references public.profiles (id) on delete set null,
  changed_at            timestamptz not null default now(),
  reason                text check (reason is null or char_length(reason) <= 1000),
  source                text not null
                        check (source in ('replacement', 'inspection_correction', 'admin_correction')),
  replacement_photo_url text
                        check (replacement_photo_url is null
                               or (replacement_photo_url like 'https://res.cloudinary.com/%'
                                   and char_length(replacement_photo_url) <= 500)),
  replacement_photo_cloudinary_public_id text
                        check (replacement_photo_cloudinary_public_id is null
                               or char_length(replacement_photo_cloudinary_public_id) <= 200)
);

comment on table public.expiry_audit_logs is
  'Audit trail for box-level expiry date changes. The template only says whether expiry tracking is required; actual dates live on box_items.';


-- =============================================================================
-- K. FIRST_AID_USAGE_LOGS - "I took something from the box" records
-- =============================================================================
create table public.first_aid_usage_logs (
  id             uuid primary key default gen_random_uuid(),
  box_id         uuid not null references public.boxes (id),
  user_name      text not null
                 check (char_length(user_name) between 2 and 120),
  department     text not null
                 check (char_length(department) between 1 and 120),
  usage_purpose  text not null
                 check (char_length(usage_purpose) between 3 and 500),
  items_taken    jsonb
                 check (items_taken is null
                        or (jsonb_typeof(items_taken) in ('array', 'object')
                            and pg_column_size(items_taken) <= 8192)),
  notes          text
                 check (notes is null or char_length(notes) <= 1000),
  client_ip_hash text
                 check (client_ip_hash is null or client_ip_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now()
);

comment on table public.first_aid_usage_logs is
  'Written ONLY by the server endpoint (service role) after validation + rate limiting; submitters never get read access. Readable by admin and viewer roles only.';
comment on column public.first_aid_usage_logs.client_ip_hash is
  'sha256(submitter IP + IP_HASH_SALT). Used for rate limiting and abuse investigation on the public usage form. Raw IPs are never stored; not shown in any UI.';


-- =============================================================================
-- L. REMINDER_LOGS - reminder audit trail (prevents duplicate reminders)
-- =============================================================================
create table public.reminder_logs (
  id                 uuid primary key default gen_random_uuid(),
  box_id             uuid not null references public.boxes (id),
  reminder_type      text not null default 'overdue'
                     check (reminder_type in ('due_soon', 'overdue')),
  days_overdue       integer not null default 0
                     check (days_overdue between -365 and 3650),
  email_sent_to      text
                     check (email_sent_to is null or (char_length(email_sent_to) <= 254
                            and email_sent_to ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  sent_at            timestamptz not null default now(),
  resend_message_id  text
                     check (resend_message_id is null or char_length(resend_message_id) <= 200),
  status             text not null default 'sent'
                     check (status in ('sent', 'failed')),
  error_message      text
                     check (error_message is null or char_length(error_message) <= 1000)
);

comment on table public.reminder_logs is
  'Written only by the Phase 3 cron job (service role). The cron checks the latest row per (box_id, reminder_type) before sending, which prevents duplicate reminders.';


-- =============================================================================
-- INDEXES
-- =============================================================================
create index idx_template_items_template      on public.first_aid_kit_template_items (template_id, display_order);
create index idx_boxes_template               on public.boxes (template_id);
create index idx_box_assignments_profile      on public.box_assignments (profile_id) where is_active;
create index idx_box_items_box                on public.box_items (box_id) where is_active;
create index idx_box_items_template_item      on public.box_items (template_item_id);
create index idx_box_items_expiry             on public.box_items (expiry_status, expiry_date) where is_active and has_expiry;
create index idx_inspections_box_created      on public.inspections (box_id, created_at desc);
create index idx_inspections_inspector        on public.inspections (inspector_id, created_at desc);
create index idx_inspections_created          on public.inspections (created_at desc);
create index idx_inspection_items_inspection  on public.inspection_items (inspection_id);
create index idx_inspection_items_box_item    on public.inspection_items (box_item_id);
create index idx_topups_box_requested         on public.topup_requests (box_id, requested_at desc);
create index idx_topups_status                on public.topup_requests (status, requested_at desc);
create index idx_topups_inspection            on public.topup_requests (inspection_id);
create index idx_expiry_audit_box_item        on public.expiry_audit_logs (box_item_id, changed_at desc);
create index idx_expiry_audit_box             on public.expiry_audit_logs (box_id, changed_at desc);
create index idx_usage_logs_box_created       on public.first_aid_usage_logs (box_id, created_at desc);
create index idx_usage_logs_created           on public.first_aid_usage_logs (created_at desc);
create index idx_usage_logs_ip                on public.first_aid_usage_logs (client_ip_hash, created_at desc);
create index idx_reminder_logs_box            on public.reminder_logs (box_id, reminder_type, sent_at desc);


-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- ---- updated_at maintenance -------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at        before update on public.profiles                       for each row execute function public.set_updated_at();
create trigger trg_templates_updated_at       before update on public.first_aid_kit_templates        for each row execute function public.set_updated_at();
create trigger trg_template_items_updated_at  before update on public.first_aid_kit_template_items   for each row execute function public.set_updated_at();
create trigger trg_boxes_updated_at           before update on public.boxes                          for each row execute function public.set_updated_at();
create trigger trg_box_items_updated_at       before update on public.box_items                      for each row execute function public.set_updated_at();

-- ---- auto-create a locked-down profile for every new auth user ---------------
-- New users (invited by admin, or self-signup if it is ever enabled) start as
-- role 'viewer' AND is_active = false: they can log in but can access nothing
-- until an admin activates them and assigns the proper role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'new.user@unknown'), '@', 1)
    ),
    new.email,
    'viewer',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- snapshot inspector identity onto each inspection -------------------------
-- The client cannot spoof inspector_name/department: whatever it sends is
-- overwritten from the inspector's profile at insert time.
create or replace function public.set_inspection_inspector_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  if new.inspector_id is not null then
    select p.full_name, p.department
      into v_profile
      from public.profiles p
     where p.id = new.inspector_id;
    if found then
      new.inspector_name       := v_profile.full_name;
      new.inspector_department := v_profile.department;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_inspections_inspector_snapshot
  before insert on public.inspections
  for each row execute function public.set_inspection_inspector_snapshot();

-- Trigger functions are not meant to be called directly by API roles.
revoke execute on function public.set_updated_at()                      from public, anon, authenticated;
revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.set_inspection_inspector_snapshot()   from public, anon, authenticated;


-- =============================================================================
-- HELPER: instantiate a box's expected items from its template
-- =============================================================================
-- SECURITY INVOKER on purpose: when an admin calls it, the box_items RLS
-- policies decide whether the inserts are allowed (admin only). The server
-- (service role) may also call it and bypasses RLS as usual. A first aider
-- calling it gets "row-level security" errors - exactly right.
-- Idempotent: items already instantiated for the box are skipped, so it can
-- also sync newly added template items onto existing boxes.
create or replace function public.apply_template_to_box(p_box_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.box_items
    (box_id, template_item_id, item_name, required_quantity, unit, measurement_type, has_expiry)
  select b.id, ti.id, ti.item_name, ti.required_quantity, ti.unit, ti.measurement_type, ti.has_expiry
    from public.boxes b
    join public.first_aid_kit_template_items ti on ti.template_id = b.template_id
   where b.id = p_box_id
     and ti.is_active
     and not exists (
           select 1
             from public.box_items bi
            where bi.box_id = b.id
              and bi.template_item_id = ti.id
              and bi.is_active
         );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.apply_template_to_box(uuid) from public, anon;
grant  execute on function public.apply_template_to_box(uuid) to authenticated;


-- =============================================================================
-- VIEW: box items with the EFFECTIVE photo (box override -> template default)
-- =============================================================================
-- security_invoker: the querying user's own RLS applies to the underlying
-- tables, so this view never widens access. Phase 2 renders inspection
-- checklist cards from this view; effective_item_photo_url is null when no
-- photo exists yet (the UI shows a placeholder icon in that case).
create or replace view public.box_items_effective
with (security_invoker = true)
as
select
  bi.id,
  bi.box_id,
  bi.template_item_id,
  bi.item_name,
  bi.required_quantity,
  bi.unit,
  bi.measurement_type,
  bi.has_expiry,
  bi.expiry_date,
  bi.expiry_status,
  bi.last_verified_date,
  bi.last_verified_by,
  bi.last_replaced_date,
  bi.last_replaced_by,
  bi.remarks,
  bi.replacement_photo_url,
  bi.replacement_photo_cloudinary_public_id,
  bi.current_quantity,
  bi.current_volume_level,
  bi.current_present_status,
  bi.is_active,
  bi.updated_at,
  coalesce(bi.item_photo_url, ti.item_photo_url)                                 as effective_item_photo_url,
  coalesce(bi.item_photo_cloudinary_public_id, ti.item_photo_cloudinary_public_id) as effective_item_photo_public_id,
  ti.item_code,
  ti.display_order,
  ti.is_critical,
  ti.expiry_warning_days,
  ti.restock_threshold_type,
  ti.restock_threshold_quantity
from public.box_items bi
left join public.first_aid_kit_template_items ti on ti.id = bi.template_item_id;

comment on view public.box_items_effective is
  'Checklist cards for the inspection page: box-level photo override wins, otherwise the template reference photo. Respects the caller''s RLS (security_invoker).';
