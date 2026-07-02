-- Remove per-box item photo overrides.
--
-- Item reference photos are now managed in one place only:
-- public.first_aid_kit_template_items. Box Items reads the same template photo
-- through public.box_items_effective, so Checklist and Box Items stay aligned.

drop view if exists public.box_items_effective;

alter table public.box_items
  drop column if exists item_photo_url,
  drop column if exists item_photo_cloudinary_public_id;

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
  bi.current_quantity,
  bi.current_volume_level,
  bi.current_present_status,
  bi.is_active,
  bi.updated_at,
  ti.item_photo_url                  as effective_item_photo_url,
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
  'Checklist cards for the inspection page and Box Items admin: item reference photos come from the checklist template item. Respects the caller''s RLS (security_invoker).';

grant select on table public.box_items_effective to authenticated;
