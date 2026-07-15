-- Keep existing box item rows aligned with their linked checklist template item.
--
-- Box-level stock state remains per box:
--   current quantity, required quantity, expiry date, and present/volume status.
-- Shared item metadata comes from the checklist:
--   name, unit, measurement type, expiry flag, active status, photo, warning days.

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
         )
     and not exists (
           select 1
             from public.box_items bi
            where bi.box_id = b.id
              and bi.is_active
              and lower(bi.item_name) = lower(ti.item_name)
         );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.apply_template_to_box(uuid) from public, anon;
grant  execute on function public.apply_template_to_box(uuid) to authenticated;

create or replace view public.box_items_effective
with (security_invoker = true)
as
select
  bi.id,
  bi.box_id,
  bi.template_item_id,
  coalesce(ti.item_name, bi.item_name) as item_name,
  bi.required_quantity,
  case when ti.id is null then bi.unit else ti.unit end as unit,
  case when ti.id is null then bi.measurement_type else ti.measurement_type end as measurement_type,
  case when ti.id is null then bi.has_expiry else ti.has_expiry end as has_expiry,
  bi.expiry_date,
  bi.current_quantity,
  bi.current_volume_level,
  bi.current_present_status,
  bi.is_active,
  bi.updated_at,
  ti.item_photo_url as effective_item_photo_url,
  ti.item_photo_cloudinary_public_id as effective_item_photo_public_id,
  ti.item_code,
  ti.display_order,
  ti.is_critical,
  ti.expiry_warning_days,
  ti.restock_threshold_type,
  ti.restock_threshold_quantity
from public.box_items bi
left join public.first_aid_kit_template_items ti on ti.id = bi.template_item_id;

comment on view public.box_items_effective is
  'Checklist cards for the inspection page and Box Items admin: shared item metadata and reference photos come from the checklist template item; per-box quantity and expiry state stay on box_items. Respects the caller''s RLS (security_invoker).';

grant select on table public.box_items_effective to authenticated;

update public.box_items bi
   set item_name = ti.item_name,
       unit = ti.unit,
       measurement_type = ti.measurement_type,
       has_expiry = ti.has_expiry,
       is_active = ti.is_active,
       updated_at = now()
  from public.first_aid_kit_template_items ti
 where bi.template_item_id = ti.id
   and (
     bi.item_name is distinct from ti.item_name
     or bi.unit is distinct from ti.unit
     or bi.measurement_type is distinct from ti.measurement_type
     or bi.has_expiry is distinct from ti.has_expiry
     or bi.is_active is distinct from ti.is_active
   )
   and (
     not ti.is_active
     or not exists (
       select 1
         from public.box_items other
        where other.box_id = bi.box_id
          and other.id <> bi.id
          and other.is_active
          and lower(other.item_name) = lower(ti.item_name)
     )
   );

do $$
declare
  r record;
begin
  for r in
    select id from public.boxes where is_active and template_id is not null
  loop
    perform public.apply_template_to_box(r.id);
  end loop;
end
$$;
