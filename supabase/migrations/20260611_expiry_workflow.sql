-- Expiry workflow migration: move monthly inspection away from repeated date entry.
-- Run once in Supabase SQL Editor before deploying the matching app code.

alter table public.box_items
  add column if not exists expiry_status text not null default 'No expiry date recorded'
    check (expiry_status in ('Valid', 'Expiring soon', 'Expired', 'No expiry date recorded', 'Expiry label mismatch')),
  add column if not exists last_verified_date timestamptz,
  add column if not exists last_verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists last_replaced_date date,
  add column if not exists last_replaced_by uuid references public.profiles (id) on delete set null,
  add column if not exists remarks text check (remarks is null or char_length(remarks) <= 1000),
  add column if not exists replacement_photo_url text
    check (replacement_photo_url is null or (replacement_photo_url like 'https://res.cloudinary.com/%' and char_length(replacement_photo_url) <= 500)),
  add column if not exists replacement_photo_cloudinary_public_id text
    check (replacement_photo_cloudinary_public_id is null or char_length(replacement_photo_cloudinary_public_id) <= 200);

alter table public.inspection_items
  add column if not exists system_expiry_date date,
  add column if not exists expiry_validation_status text
    check (expiry_validation_status is null or expiry_validation_status in
           ('matches_label', 'different_date', 'no_label', 'expired', 'replaced_now', 'missing_not_replaced')),
  add column if not exists expiry_label_mismatch boolean not null default false,
  add column if not exists no_expiry_date_recorded boolean not null default false;

alter table public.inspection_items
  drop constraint if exists inspection_items_item_status_check;

alter table public.inspection_items
  add constraint inspection_items_item_status_check
  check (item_status is null or item_status in
         ('OK', 'Low Stock', 'Missing', 'Expired', 'Expiring Soon',
          'No Expiry Date', 'Expiry Label Mismatch', 'Damaged', 'Not Applicable'));

create table if not exists public.expiry_audit_logs (
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

create index if not exists idx_box_items_expiry
  on public.box_items (expiry_status, expiry_date) where is_active and has_expiry;
create index if not exists idx_expiry_audit_box_item
  on public.expiry_audit_logs (box_item_id, changed_at desc);
create index if not exists idx_expiry_audit_box
  on public.expiry_audit_logs (box_id, changed_at desc);

update public.box_items
   set expiry_status = case
         when not has_expiry then 'Valid'
         when expiry_date is null then 'No expiry date recorded'
         when expiry_date < current_date then 'Expired'
         when expiry_date <= current_date + 60 then 'Expiring soon'
         else 'Valid'
       end;

alter table public.expiry_audit_logs enable row level security;

drop policy if exists expiry_audit_select_admin on public.expiry_audit_logs;
create policy expiry_audit_select_admin on public.expiry_audit_logs
  for select to authenticated
  using ((select public.active_role()) = 'admin');

drop policy if exists expiry_audit_insert_admin on public.expiry_audit_logs;
create policy expiry_audit_insert_admin on public.expiry_audit_logs
  for insert to authenticated
  with check ((select public.active_role()) = 'admin');

revoke all on table public.expiry_audit_logs from anon;
revoke all on table public.expiry_audit_logs from authenticated;
grant select, insert on table public.expiry_audit_logs to authenticated;

-- Recreate (not "create or replace"): the new expiry columns are inserted in the
-- middle of the column list, and Postgres forbids reordering existing view columns
-- via CREATE OR REPLACE VIEW (error 42P16). Dropping first yields a view identical
-- to schema.sql. Safe: box_items_effective is a leaf view with no dependents, and
-- the drop+create is atomic inside this migration (no read gap for the live app).
drop view if exists public.box_items_effective;

create view public.box_items_effective
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
  coalesce(bi.item_photo_url, ti.item_photo_url)                                  as effective_item_photo_url,
  coalesce(bi.item_photo_cloudinary_public_id, ti.item_photo_cloudinary_public_id) as effective_item_photo_public_id,
  ti.item_code,
  ti.display_order,
  ti.is_critical,
  ti.expiry_warning_days,
  ti.restock_threshold_type,
  ti.restock_threshold_quantity
from public.box_items bi
left join public.first_aid_kit_template_items ti on ti.id = bi.template_item_id;

grant select on table public.box_items_effective to authenticated;

notify pgrst, 'reload schema';
