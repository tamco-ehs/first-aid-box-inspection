-- =============================================================================
-- First Aid Box Inspection System - Phase 1: Row Level Security
-- Run AFTER schema.sql. Safe to re-run (policies are dropped and recreated).
--
-- Access model (deny by default - a table with RLS enabled and no matching
-- policy returns nothing / rejects writes):
--
--   anon (public internet, no login) ... NOTHING. Zero grants, zero policies.
--   authenticated but INACTIVE ......... can read own profile only.
--   viewer (active) .................... reads boxes, inspections, top-ups,
--                                        usage logs. No writes, no master data.
--   first_aider (active) ............... reads ONLY assigned boxes + their
--                                        checklists; submits inspections for
--                                        assigned boxes; reads own inspections.
--   admin (active) ..................... manages profiles, boxes, assignments,
--                                        templates, items; reads everything;
--                                        deletes bad records.
--   service_role (server code only) .... bypasses RLS. Used for: public usage
--                                        submissions (after validation + rate
--                                        limit), auto-created top-up requests,
--                                        cron reminder logs, user management.
--
-- RLS is layer 1. Server-side API validation is layer 2. Frontend navigation
-- guards are layer 3 (UX only, never trusted). See SECURITY.md.
-- =============================================================================


-- =============================================================================
-- 1. HELPER FUNCTIONS
-- =============================================================================
-- SECURITY DEFINER so policy evaluation can consult profiles/box_assignments
-- without recursing into those tables' own RLS policies.

-- Caller's role, or NULL when there is no profile or the profile is inactive.
-- A deactivated user instantly loses every capability that checks this.
create or replace function public.active_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid()
     and p.is_active
$$;

-- Does the caller hold an ACTIVE assignment for this box?
create or replace function public.is_assigned_to_box(p_box_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.box_assignments ba
     where ba.box_id = p_box_id
       and ba.profile_id = auth.uid()
       and ba.is_active
  )
$$;

revoke execute on function public.active_role()              from public, anon;
revoke execute on function public.is_assigned_to_box(uuid)   from public, anon;
grant  execute on function public.active_role()              to authenticated;
grant  execute on function public.is_assigned_to_box(uuid)   to authenticated;


-- =============================================================================
-- 2. ENABLE RLS ON ALL TABLES
-- =============================================================================
alter table public.profiles                       enable row level security;
alter table public.first_aid_kit_templates        enable row level security;
alter table public.first_aid_kit_template_items   enable row level security;
alter table public.boxes                          enable row level security;
alter table public.box_assignments                enable row level security;
alter table public.box_items                      enable row level security;
alter table public.inspections                    enable row level security;
alter table public.inspection_items               enable row level security;
alter table public.topup_requests                 enable row level security;
alter table public.expiry_audit_logs              enable row level security;
alter table public.first_aid_usage_logs           enable row level security;
alter table public.reminder_logs                  enable row level security;


-- =============================================================================
-- 3. POLICIES
-- =============================================================================

-- ---- profiles -----------------------------------------------------------------
-- Users read their own profile even when inactive (so the app can show
-- "account disabled"). Only admins read or modify other profiles. There is NO
-- update policy for non-admins, so users cannot change their own role (or
-- anything else) - satisfies "non-admin cannot change their own role".
-- INSERTs happen only via the signup trigger; DELETEs only via auth.users
-- cascade (Supabase dashboard / admin API).

drop policy if exists profiles_select_own   on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select public.active_role()) = 'admin');

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

-- ---- boxes ----------------------------------------------------------------------
-- admin: everything. viewer: all ACTIVE boxes. first_aider: only ACTIVE boxes
-- they hold an active assignment for.

drop policy if exists boxes_select on public.boxes;
create policy boxes_select on public.boxes
  for select to authenticated
  using (
    (select public.active_role()) = 'admin'
    or ((select public.active_role()) = 'viewer' and is_active)
    or ((select public.active_role()) = 'first_aider'
        and is_active
        and public.is_assigned_to_box(id))
  );

drop policy if exists boxes_insert_admin on public.boxes;
create policy boxes_insert_admin on public.boxes
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists boxes_update_admin on public.boxes;
create policy boxes_update_admin on public.boxes
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists boxes_delete_admin on public.boxes;
create policy boxes_delete_admin on public.boxes
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- box_assignments ---------------------------------------------------------
-- admin manages all; first aiders (and any active user) see only their own
-- active assignments. Nobody can self-assign: insert/update/delete are
-- admin-only.

drop policy if exists box_assignments_select on public.box_assignments;
create policy box_assignments_select on public.box_assignments
  for select to authenticated
  using (
    (select public.active_role()) = 'admin'
    or ((select public.active_role()) is not null
        and profile_id = (select auth.uid())
        and is_active)
  );

drop policy if exists box_assignments_insert_admin on public.box_assignments;
create policy box_assignments_insert_admin on public.box_assignments
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists box_assignments_update_admin on public.box_assignments;
create policy box_assignments_update_admin on public.box_assignments
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists box_assignments_delete_admin on public.box_assignments;
create policy box_assignments_delete_admin on public.box_assignments
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- first_aid_kit_templates ----------------------------------------------------
-- admin manages. A first aider can read an ACTIVE template only when one of
-- their assigned active boxes uses it. Viewers do not need template access
-- (reports read denormalized inspection data).

drop policy if exists templates_select on public.first_aid_kit_templates;
create policy templates_select on public.first_aid_kit_templates
  for select to authenticated
  using (
    (select public.active_role()) = 'admin'
    or ((select public.active_role()) = 'first_aider'
        and is_active
        and exists (
              select 1
                from public.boxes b
               where b.template_id = first_aid_kit_templates.id
                 and b.is_active
                 and public.is_assigned_to_box(b.id)
            ))
  );

drop policy if exists templates_insert_admin on public.first_aid_kit_templates;
create policy templates_insert_admin on public.first_aid_kit_templates
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists templates_update_admin on public.first_aid_kit_templates;
create policy templates_update_admin on public.first_aid_kit_templates
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists templates_delete_admin on public.first_aid_kit_templates;
create policy templates_delete_admin on public.first_aid_kit_templates
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- first_aid_kit_template_items ----------------------------------------------
-- Read access piggybacks on the templates policy: the EXISTS subquery runs
-- under the caller's own RLS, so an item is visible only when its parent
-- template is visible to that caller.

drop policy if exists template_items_select on public.first_aid_kit_template_items;
create policy template_items_select on public.first_aid_kit_template_items
  for select to authenticated
  using (
    (select public.active_role()) = 'admin'
    or ((select public.active_role()) = 'first_aider'
        and is_active
        and exists (
              select 1
                from public.first_aid_kit_templates t
               where t.id = template_id
            ))
  );

drop policy if exists template_items_insert_admin on public.first_aid_kit_template_items;
create policy template_items_insert_admin on public.first_aid_kit_template_items
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists template_items_update_admin on public.first_aid_kit_template_items;
create policy template_items_update_admin on public.first_aid_kit_template_items
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists template_items_delete_admin on public.first_aid_kit_template_items;
create policy template_items_delete_admin on public.first_aid_kit_template_items
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- box_items ------------------------------------------------------------------
-- admin manages all. First aiders read ACTIVE items of assigned boxes (this is
-- the inspection checklist). State updates after an inspection are written by
-- the server (service role), never by the first aider directly.

drop policy if exists box_items_select on public.box_items;
create policy box_items_select on public.box_items
  for select to authenticated
  using (
    (select public.active_role()) = 'admin'
    or ((select public.active_role()) = 'first_aider'
        and is_active
        and public.is_assigned_to_box(box_id))
  );

drop policy if exists box_items_insert_admin on public.box_items;
create policy box_items_insert_admin on public.box_items
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists box_items_update_admin on public.box_items;
create policy box_items_update_admin on public.box_items
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists box_items_delete_admin on public.box_items;
create policy box_items_delete_admin on public.box_items
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- inspections ------------------------------------------------------------------
-- Read: admin + viewer see all; first aiders see ONLY their own submissions.
-- Insert: active first aiders, as themselves, for an active box they are
-- assigned to. No UPDATE policy for anyone: inspections are immutable audit
-- records (corrections = admin deletes the bad record, aider re-submits).

drop policy if exists inspections_select on public.inspections;
create policy inspections_select on public.inspections
  for select to authenticated
  using (
    (select public.active_role()) in ('admin', 'viewer')
    or ((select public.active_role()) = 'first_aider'
        and inspector_id = (select auth.uid()))
  );

drop policy if exists inspections_insert_first_aider on public.inspections;
create policy inspections_insert_first_aider on public.inspections
  for insert to authenticated
  with check (
    -- To also let admins submit inspections, change the next line to:
    --   (select public.active_role()) in ('first_aider', 'admin')
    (select public.active_role()) = 'first_aider'
    and inspector_id = (select auth.uid())
    and exists (
          select 1
            from public.boxes b
           where b.id = box_id
             and b.is_active
             and public.is_assigned_to_box(b.id)
        )
  );

drop policy if exists inspections_delete_admin on public.inspections;
create policy inspections_delete_admin on public.inspections
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- inspection_items ----------------------------------------------------------
-- Lines follow their parent inspection: readable when the parent is readable,
-- insertable only into the caller's own inspection, and only referencing a
-- box_item that belongs to the same box (blocks cross-box data injection).
-- Deletion happens only via the parent's ON DELETE CASCADE.

drop policy if exists inspection_items_select on public.inspection_items;
create policy inspection_items_select on public.inspection_items
  for select to authenticated
  using (
    (select public.active_role()) in ('admin', 'viewer')
    or ((select public.active_role()) = 'first_aider'
        and exists (
              select 1
                from public.inspections i
               where i.id = inspection_id
                 and i.inspector_id = (select auth.uid())
            ))
  );

drop policy if exists inspection_items_insert_first_aider on public.inspection_items;
create policy inspection_items_insert_first_aider on public.inspection_items
  for insert to authenticated
  with check (
    (select public.active_role()) = 'first_aider'
    and exists (
          select 1
            from public.inspections i
           where i.id = inspection_id
             and i.inspector_id = (select auth.uid())
        )
    and (
      box_item_id is null
      or exists (
           select 1
             from public.box_items bi
             join public.inspections i2 on i2.id = inspection_id
            where bi.id = box_item_id
              and bi.box_id = i2.box_id
         )
    )
  );

-- ---- topup_requests -------------------------------------------------------------
-- Created by the server (service role) during inspection submission; admin can
-- also create/update/delete manually. Viewers read all; first aiders read
-- requests for their assigned boxes.

drop policy if exists topups_select on public.topup_requests;
create policy topups_select on public.topup_requests
  for select to authenticated
  using (
    (select public.active_role()) in ('admin', 'viewer')
    or ((select public.active_role()) = 'first_aider'
        and public.is_assigned_to_box(box_id))
  );

drop policy if exists topups_insert_admin on public.topup_requests;
create policy topups_insert_admin on public.topup_requests
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists topups_update_admin on public.topup_requests;
create policy topups_update_admin on public.topup_requests
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists topups_delete_admin on public.topup_requests;
create policy topups_delete_admin on public.topup_requests
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- expiry_audit_logs --------------------------------------------------------
-- Admins can view and write explicit admin corrections. Inspection/replacement
-- audit rows are written by the server service-role after validating the reason.

drop policy if exists expiry_audit_select_admin on public.expiry_audit_logs;
create policy expiry_audit_select_admin on public.expiry_audit_logs
  for select to authenticated
  using ((select public.active_role()) = 'admin');

drop policy if exists expiry_audit_insert_admin on public.expiry_audit_logs;
create policy expiry_audit_insert_admin on public.expiry_audit_logs
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

-- ---- first_aid_usage_logs -------------------------------------------------------
-- NO insert policy on purpose: public/staff submissions go exclusively through
-- the server endpoint (service role) which validates, rate-limits and inserts.
-- Neither anon nor authenticated can write this table directly, and submitters
-- can never read it back. Read: admin + viewer only.

drop policy if exists usage_logs_select on public.first_aid_usage_logs;
create policy usage_logs_select on public.first_aid_usage_logs
  for select to authenticated
  using ((select public.active_role()) in ('admin', 'viewer'));

drop policy if exists usage_logs_delete_admin on public.first_aid_usage_logs;
create policy usage_logs_delete_admin on public.first_aid_usage_logs
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- ---- reminder_logs ---------------------------------------------------------------
-- Written only by the cron job (service role bypasses RLS - no policy needed).
-- Read: admin only.

drop policy if exists reminder_logs_select_admin on public.reminder_logs;
create policy reminder_logs_select_admin on public.reminder_logs
  for select to authenticated
  using ((select public.active_role()) = 'admin');


-- =============================================================================
-- 4. PRIVILEGE HARDENING (defense in depth on top of RLS)
-- =============================================================================
-- anon gets NOTHING at the grant level - even a future policy mistake cannot
-- expose data to the public internet. authenticated keeps only the privileges
-- some policy can actually allow.

revoke all on table
  public.profiles,
  public.first_aid_kit_templates,
  public.first_aid_kit_template_items,
  public.boxes,
  public.box_assignments,
  public.box_items,
  public.inspections,
  public.inspection_items,
  public.topup_requests,
  public.expiry_audit_logs,
  public.first_aid_usage_logs,
  public.reminder_logs,
  public.box_items_effective
from anon;

revoke all on table
  public.profiles,
  public.first_aid_kit_templates,
  public.first_aid_kit_template_items,
  public.boxes,
  public.box_assignments,
  public.box_items,
  public.inspections,
  public.inspection_items,
  public.topup_requests,
  public.expiry_audit_logs,
  public.first_aid_usage_logs,
  public.reminder_logs,
  public.box_items_effective
from authenticated;

grant select, update                  on table public.profiles                     to authenticated;
grant select, insert, update, delete  on table public.first_aid_kit_templates      to authenticated;
grant select, insert, update, delete  on table public.first_aid_kit_template_items to authenticated;
grant select, insert, update, delete  on table public.boxes                        to authenticated;
grant select, insert, update, delete  on table public.box_assignments              to authenticated;
grant select, insert, update, delete  on table public.box_items                    to authenticated;
grant select, insert, delete          on table public.inspections                  to authenticated;
grant select, insert                  on table public.inspection_items             to authenticated;
grant select, insert, update, delete  on table public.topup_requests               to authenticated;
grant select, insert                  on table public.expiry_audit_logs            to authenticated;
grant select, delete                  on table public.first_aid_usage_logs         to authenticated;
grant select                          on table public.reminder_logs                to authenticated;
grant select                          on table public.box_items_effective          to authenticated;

-- Future tables created by this owner should not be auto-granted to anon.
alter default privileges in schema public revoke all on tables from anon;

-- Ask PostgREST to reload its schema cache (no-op outside Supabase).
notify pgrst, 'reload schema';
