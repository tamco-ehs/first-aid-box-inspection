-- Replace the original demo first aid boxes with TAMCO's actual first aid box
-- register. The first two UUIDs are intentionally reused after purging the
-- demo rows so existing app/test assumptions around deterministic IDs remain
-- stable while visible box codes/names become real.

begin;

create temporary table _actual_first_aid_boxes (
  id uuid primary key,
  box_code text not null,
  box_name text not null,
  location_description text not null,
  area text not null
) on commit drop;

insert into _actual_first_aid_boxes (id, box_code, box_name, location_description, area)
values
  ('11111111-1111-4111-8111-111111111111', 'REC-01', 'REC-01 First Aid Box', 'Reception', 'Office'),
  ('22222222-2222-4222-8222-222222222222', 'OFF-01', 'OFF-01 First Aid Box', 'Office 1st Floor, Near Lift', 'Office'),
  ('b0000000-0000-4000-8000-000000000003', 'OFF-02', 'OFF-02 First Aid Box', 'Office 1st Floor, Purchasing', 'Office'),
  ('b0000000-0000-4000-8000-000000000004', 'OFF-03', 'OFF-03 First Aid Box', 'Office 2nd Floor, Lift', 'Office'),
  ('b0000000-0000-4000-8000-000000000005', 'OFF-04', 'OFF-04 First Aid Box', 'Office 2nd Floor, AE', 'Office'),
  ('b0000000-0000-4000-8000-000000000006', 'PRO-01', 'PRO-01 First Aid Box', 'Production Office', 'Office'),
  ('b0000000-0000-4000-8000-000000000007', 'LOA-01', 'LOA-01 First Aid Box', 'Loading Area', 'Production'),
  ('b0000000-0000-4000-8000-000000000008', 'VCB-01', 'VCB-01 First Aid Box', 'VCB Entrance', 'Production'),
  ('b0000000-0000-4000-8000-000000000009', 'RND-01', 'RND-01 First Aid Box', 'R&D Entrance', 'Production'),
  ('b0000000-0000-4000-8000-000000000010', 'RMU-01', 'RMU-01 First Aid Box', 'RMU, Inside', 'Production'),
  ('b0000000-0000-4000-8000-000000000011', 'GIS-01', 'GIS-01 First Aid Box', 'GIS Walkway', 'Production'),
  ('b0000000-0000-4000-8000-000000000012', 'WIR-01', 'WIR-01 First Aid Box', 'Wire Harness Area', 'Production'),
  ('b0000000-0000-4000-8000-000000000013', 'WIR-02', 'WIR-02 First Aid Box', 'Wire Assembly', 'Production'),
  ('b0000000-0000-4000-8000-000000000014', 'STO-01', 'STO-01 First Aid Box', 'Store', 'Production'),
  ('b0000000-0000-4000-8000-000000000015', 'STO-02', 'STO-02 First Aid Box', 'Store Office', 'Production'),
  ('b0000000-0000-4000-8000-000000000016', 'TES-01', 'TES-01 First Aid Box', 'Testing Area', 'Production'),
  ('b0000000-0000-4000-8000-000000000017', 'AIS-01', 'AIS-01 First Aid Box', 'New AIS Assembly', 'Production'),
  ('b0000000-0000-4000-8000-000000000018', 'AIS-02', 'AIS-02 First Aid Box', 'AIS Testing', 'Production'),
  ('b0000000-0000-4000-8000-000000000019', 'FAB-01', 'FAB-01 First Aid Box', 'Fabrication Area', 'Production'),
  ('b0000000-0000-4000-8000-000000000020', 'GUA-01', 'GUA-01 First Aid Box', 'Guard Post 2', 'External'),
  ('b0000000-0000-4000-8000-000000000021', 'GUA-02', 'GUA-02 First Aid Box', 'Guard Post 1', 'External'),
  ('b0000000-0000-4000-8000-000000000022', 'GIS-02', 'GIS-02 First Aid Box', 'GIS, Inside', 'Production'),
  ('b0000000-0000-4000-8000-000000000023', 'PAI-01', 'PAI-01 First Aid Box', 'Paintshop', 'Production');

create temporary table _dummy_first_aid_boxes as
select id
  from public.boxes
 where box_code in ('FAB-WH-001', 'FAB-PR-001')
    or (id = '11111111-1111-4111-8111-111111111111' and box_code = 'FAB-WH-001')
    or (id = '22222222-2222-4222-8222-222222222222' and box_code = 'FAB-PR-001');

delete from public.topup_requests
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.inspection_items ii
 using public.inspections i
 where ii.inspection_id = i.id
   and i.box_id in (select id from _dummy_first_aid_boxes);

delete from public.inspections
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.expiry_audit_logs
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.first_aid_usage_logs
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.reminder_logs
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.box_assignments
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.box_items
 where box_id in (select id from _dummy_first_aid_boxes);

delete from public.boxes
 where id in (select id from _dummy_first_aid_boxes);

insert into public.boxes
  (id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active)
select
  b.id,
  b.box_code,
  b.box_name,
  b.location_description,
  b.area,
  'a0000000-0000-4000-8000-000000000001'::uuid,
  30,
  true
from _actual_first_aid_boxes b
on conflict (id) do update
   set box_code = excluded.box_code,
       box_name = excluded.box_name,
       location_description = excluded.location_description,
       area = excluded.area,
       template_id = excluded.template_id,
       inspection_frequency_days = excluded.inspection_frequency_days,
       is_active = true,
       updated_at = now();

select public.apply_template_to_box(id) as items_created
  from _actual_first_aid_boxes
 order by box_code;

commit;
