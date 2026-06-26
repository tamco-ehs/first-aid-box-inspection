-- =============================================================================
-- First Aid Readiness - REVAMP migration (quick inspection + unified ESH actions)
-- Run AFTER schema.sql, rls_policies.sql (needs active_role() / is_assigned_to_box).
-- Additive and idempotent: it does NOT drop the Phase 1 tables, so the existing
-- RLS smoke test keeps passing. The app uses the new structures below.
--
-- What it adds:
--   * inspections: 4 quick-check answers + item_check_performed; readiness-style
--     overall_status values ('Ready' / 'Action Required').
--   * inspection_items: allow the simplified 'Low Qty' status.
--   * actions: ONE table for every ESH action (box-level quick-check issues AND
--     item top-up / replacement), with a human code FA-ACT-YYYY-NNNN, an
--     Open/Closed lifecycle, and bulk-close fields. (Supersedes topup_requests,
--     which is left in place but unused.)
-- =============================================================================


-- ---- inspections: quick-check answers ---------------------------------------
alter table public.inspections add column if not exists box_accessible       boolean;
alter table public.inspections add column if not exists box_clean            boolean;
alter table public.inspections add column if not exists seal_intact          boolean;
alter table public.inspections add column if not exists contact_visible      boolean;
alter table public.inspections add column if not exists item_check_performed boolean not null default false;

comment on column public.inspections.seal_intact is
  'Quick-check answer. When false the box may have been used/opened, so the item checklist is required and item_check_performed becomes true.';

-- Readiness vocabulary alongside the legacy values (keeps old tests valid).
alter table public.inspections drop constraint if exists inspections_overall_status_check;
alter table public.inspections add constraint inspections_overall_status_check
  check (overall_status in ('Pass', 'Fail', 'Needs Restock', 'Ready', 'Action Required'));


-- ---- inspection_items: simplified item statuses -----------------------------
alter table public.inspection_items drop constraint if exists inspection_items_item_status_check;
alter table public.inspection_items add constraint inspection_items_item_status_check
  check (item_status is null or item_status in
         ('OK', 'Low Stock', 'Low Qty', 'Missing', 'Expired', 'Expiring Soon', 'Damaged', 'Not Applicable'))
  not valid;


-- =============================================================================
-- ACTIONS - unified ESH action / top-up / replacement record
-- =============================================================================
create sequence if not exists public.action_code_seq;

create table if not exists public.actions (
  id                 uuid primary key default gen_random_uuid(),
  action_code        text unique,
  box_id             uuid not null references public.boxes (id),
  inspection_id      uuid references public.inspections (id) on delete set null,
  action_type        text not null
                     check (action_type in (
                       'Box Accessibility Issue', 'Box Condition Issue',
                       'Emergency Contact Not Visible', 'Item Low Qty',
                       'Item Missing', 'Item Expired')),
  category           text not null check (category in ('quick_check', 'item')),
  box_item_id        uuid references public.box_items (id) on delete set null,
  item_name          text check (item_name is null or char_length(item_name) <= 150),
  required_quantity  numeric check (required_quantity is null or required_quantity >= 0),
  observed_quantity  numeric check (observed_quantity is null or observed_quantity >= 0),
  new_quantity       numeric check (new_quantity is null or new_quantity >= 0),
  expiry_date        date,
  new_expiry_date    date,
  priority           text check (priority is null or priority in ('Low', 'Medium', 'High')),
  status             text not null default 'Open'
                     check (status in ('Open', 'In Progress', 'Closed', 'Rejected')),
  details            text check (details is null or char_length(details) <= 1000),
  closure_note       text check (closure_note is null or char_length(closure_note) <= 1000),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  closed_by          uuid references public.profiles (id) on delete set null,
  closed_at          timestamptz,

  constraint actions_closed_after_created check (closed_at is null or closed_at >= created_at)
);

comment on table public.actions is
  'Every ESH action: box-level quick-check issues (accessibility/condition/contact) and item issues (low qty/missing/expired). Created by the server (service role) on inspection submit; closed by ESH/admin. A box is "Action Required" while it has any Open action.';

create index if not exists idx_actions_box_status on public.actions (box_id, status);
create index if not exists idx_actions_status     on public.actions (status, created_at desc);
create index if not exists idx_actions_created     on public.actions (created_at desc);
create index if not exists idx_actions_inspection  on public.actions (inspection_id);

-- Human-friendly code: FA-ACT-2026-0007
create or replace function public.set_action_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_code is null then
    new.action_code := 'FA-ACT-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('public.action_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_actions_set_code on public.actions;
create trigger trg_actions_set_code
  before insert on public.actions
  for each row execute function public.set_action_code();

revoke execute on function public.set_action_code() from public, anon, authenticated;


-- =============================================================================
-- ACTIONS - RLS (mirrors the topup_requests model)
-- =============================================================================
alter table public.actions enable row level security;

drop policy if exists actions_select on public.actions;
create policy actions_select on public.actions
  for select to authenticated
  using (
    (select public.active_role()) in ('admin', 'viewer')
    or ((select public.active_role()) = 'first_aider' and public.is_assigned_to_box(box_id))
  );

drop policy if exists actions_insert_admin on public.actions;
create policy actions_insert_admin on public.actions
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

drop policy if exists actions_update_admin on public.actions;
create policy actions_update_admin on public.actions
  for update to authenticated
  using      ((select public.active_role()) = 'admin')
  with check ((select public.active_role()) = 'admin');

drop policy if exists actions_delete_admin on public.actions;
create policy actions_delete_admin on public.actions
  for delete to authenticated
  using ((select public.active_role()) = 'admin');

-- anon: nothing. authenticated: only what a policy can allow. Server writes use
-- the service role (creating actions during inspection submit), bypassing RLS.
revoke all on table public.actions from anon;
revoke all on table public.actions from authenticated;
grant select, insert, update, delete on table public.actions to authenticated;

notify pgrst, 'reload schema';
