-- =============================================================================
-- First Aid Box Inspection System - Phase 1: Seed Data
-- Run AFTER schema.sql and rls_policies.sql (the SQL editor runs as postgres,
-- so RLS does not block seeding). Idempotent: safe to re-run.
--
-- Seeds:
--   1. The checklist baseline template ("Current First Aid Box Baseline")
--   2. Its 22 checklist items from the current EHS-maintained list
--   3. Two example boxes instantiated from the template
--   4. Placeholder profile promotions + assignment examples (edit the UUIDs)
--
-- Everything seeded here is plain data - admins can edit item names,
-- quantities, expiry rules, thresholds, photos, ordering, etc. later without
-- any code change.
-- =============================================================================


-- =============================================================================
-- 1. CHECKLIST TEMPLATE
-- =============================================================================
-- Wording is deliberate: this is the CURRENT site practice baseline, not a
-- verified legal standard. Admin should confirm against the latest DOSH
-- first aid guidance and update guideline_reference when done.
insert into public.first_aid_kit_templates (id, template_name, guideline_reference, description)
values (
  'a0000000-0000-4000-8000-000000000001',
  'Current First Aid Box Baseline',
  'Internal EHS baseline list. Pending admin verification against the latest DOSH first aid guidance - not a legal compliance claim.',
  'First aid box item list currently maintained by EHS based on existing site practice.'
)
on conflict (id) do nothing;


-- =============================================================================
-- 2. CHECKLIST ITEMS (22 items from the current maintained list)
-- =============================================================================
-- measurement_type:
--   quantity       - countable consumables (plasters, pins, swabs, ...)
--   volume_level   - bottles/tubes checked by fullness (lotion, Dettol, ...)
--   present_absent - tools checked by presence/condition (scissors, splints)
-- has_expiry = true for medical consumables; false for durable tools.
-- restock_threshold_type:
--   below_half     - restock when volume drops below half
--   fixed_quantity - restock when count drops below restock_threshold_quantity
--   any_missing    - restock when any unit is missing
--   expired_only   - restock only on expiry
-- item_photo_url is a nullable placeholder; admin uploads reference photos
-- later (Cloudinary) so first aiders can identify items during inspection.

insert into public.first_aid_kit_template_items
  (id, template_id, item_code, item_name, required_quantity, unit, measurement_type,
   has_expiry, expiry_warning_days, is_critical, restock_threshold_type,
   restock_threshold_quantity, item_photo_url, display_order)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'FA-001', 'Yellow lotion', 1, 'bottle', 'volume_level',
   true, 60, false, 'below_half', null, null, 10),

  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'FA-002', 'Counterpain', 1, 'tube', 'volume_level',
   true, 60, false, 'below_half', null, null, 20),

  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'FA-003', 'Burnal plast / Antiseptic cream', 1, 'tube', 'volume_level',
   true, 60, false, 'below_half', null, null, 30),

  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'FA-004', 'Handyplast', 30, 'pcs', 'quantity',
   true, 60, false, 'fixed_quantity', 15, null, 40),

  ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001',
   'FA-005', 'Cotton wool / cotton ball', 1, 'pack', 'quantity',
   true, 60, false, 'any_missing', null, null, 50),

  ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001',
   'FA-006', 'Surgical tape', 1, 'roll', 'quantity',
   true, 60, false, 'any_missing', null, null, 60),

  ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001',
   'FA-007', 'Surgical scissors', 1, 'pcs', 'present_absent',
   false, 60, false, 'any_missing', null, null, 70),

  ('c0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001',
   'FA-008', 'Safety pin', 10, 'pcs', 'quantity',
   false, 60, false, 'fixed_quantity', 5, null, 80),

  ('c0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001',
   'FA-009', 'Crepe bandage', 1, 'roll', 'quantity',
   true, 60, false, 'any_missing', null, null, 90),

  ('c0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001',
   'FA-010', 'Surgical gloves', 5, 'pair', 'quantity',
   true, 60, true, 'fixed_quantity', 2, null, 100),

  ('c0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001',
   'FA-011', 'Eye pad', 1, 'pcs', 'quantity',
   true, 60, false, 'any_missing', null, null, 110),

  ('c0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001',
   'FA-012', 'Gauze 7.5 cm x 7.5 cm', 1, 'pack', 'quantity',
   true, 60, false, 'any_missing', null, null, 120),

  ('c0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001',
   'FA-013', 'Gauze 10 cm x 10 cm', 1, 'pack', 'quantity',
   true, 60, false, 'any_missing', null, null, 130),

  ('c0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001',
   'FA-014', 'Optrex', 1, 'bottle', 'volume_level',
   true, 60, true, 'below_half', null, null, 140),

  ('c0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001',
   'FA-015', 'Padding splints', 1, 'set', 'present_absent',
   false, 60, false, 'any_missing', null, null, 150),

  ('c0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000001',
   'FA-016', 'Triangular bandage', 2, 'pcs', 'quantity',
   true, 60, false, 'fixed_quantity', 1, null, 160),

  ('c0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000001',
   'FA-017', 'Lint dressing 9', 1, 'pcs', 'quantity',
   true, 60, false, 'any_missing', null, null, 170),

  ('c0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000001',
   'FA-018', 'Lint dressing 7', 1, 'pcs', 'quantity',
   true, 60, false, 'any_missing', null, null, 180),

  ('c0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000001',
   'FA-019', 'Alcohol swab', 10, 'pcs', 'quantity',
   true, 60, false, 'fixed_quantity', 5, null, 190),

  ('c0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000001',
   'FA-020', 'Dettol', 1, 'bottle', 'volume_level',
   true, 60, false, 'below_half', null, null, 200),

  ('c0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000001',
   'FA-021', 'Cotton bud', 1, 'pack', 'quantity',
   true, 60, false, 'any_missing', null, null, 210),

  ('c0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000001',
   'FA-022', 'Wound dressing', 1, 'pcs', 'quantity',
   true, 60, true, 'any_missing', null, null, 220)
on conflict (id) do nothing;


-- =============================================================================
-- 3. ACTUAL FIRST AID BOX REGISTER (instantiated from the template)
-- =============================================================================
insert into public.boxes
  (id, box_code, box_name, location_description, area, template_id, inspection_frequency_days)
values
  ('11111111-1111-4111-8111-111111111111',
   'REC-01', 'REC-01 First Aid Box',
   'Reception', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('22222222-2222-4222-8222-222222222222',
   'OFF-01', 'OFF-01 First Aid Box',
   'Office 1st Floor, Near Lift', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000003',
   'OFF-02', 'OFF-02 First Aid Box',
   'Office 1st Floor, Purchasing', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000004',
   'OFF-03', 'OFF-03 First Aid Box',
   'Office 2nd Floor, Lift', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000005',
   'OFF-04', 'OFF-04 First Aid Box',
   'Office 2nd Floor, AE', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000006',
   'PRO-01', 'PRO-01 First Aid Box',
   'Production Office', 'Office',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000007',
   'LOA-01', 'LOA-01 First Aid Box',
   'Loading Area', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000008',
   'VCB-01', 'VCB-01 First Aid Box',
   'VCB Entrance', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000009',
   'RND-01', 'RND-01 First Aid Box',
   'R&D Entrance', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000010',
   'RMU-01', 'RMU-01 First Aid Box',
   'RMU, Inside', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000011',
   'GIS-01', 'GIS-01 First Aid Box',
   'GIS Walkway', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000012',
   'WIR-01', 'WIR-01 First Aid Box',
   'Wire Harness Area', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000013',
   'WIR-02', 'WIR-02 First Aid Box',
   'Wire Assembly', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000014',
   'STO-01', 'STO-01 First Aid Box',
   'Store', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000015',
   'STO-02', 'STO-02 First Aid Box',
   'Store Office', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000016',
   'TES-01', 'TES-01 First Aid Box',
   'Testing Area', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000017',
   'AIS-01', 'AIS-01 First Aid Box',
   'New AIS Assembly', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000018',
   'AIS-02', 'AIS-02 First Aid Box',
   'AIS Testing', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000019',
   'FAB-01', 'FAB-01 First Aid Box',
   'Fabrication Area', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000020',
   'GUA-01', 'GUA-01 First Aid Box',
   'Guard Post 2', 'External',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000021',
   'GUA-02', 'GUA-02 First Aid Box',
   'Guard Post 1', 'External',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000022',
   'GIS-02', 'GIS-02 First Aid Box',
   'GIS, Inside', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30),
  ('b0000000-0000-4000-8000-000000000023',
   'PAI-01', 'PAI-01 First Aid Box',
   'Paintshop', 'Production',
   'a0000000-0000-4000-8000-000000000001', 30)
on conflict (id) do nothing;

-- Copy the template's 22 items into each box (skips items already present).
select public.apply_template_to_box(id) as items_created
  from (values
    ('11111111-1111-4111-8111-111111111111'::uuid),
    ('22222222-2222-4222-8222-222222222222'::uuid),
    ('b0000000-0000-4000-8000-000000000003'::uuid),
    ('b0000000-0000-4000-8000-000000000004'::uuid),
    ('b0000000-0000-4000-8000-000000000005'::uuid),
    ('b0000000-0000-4000-8000-000000000006'::uuid),
    ('b0000000-0000-4000-8000-000000000007'::uuid),
    ('b0000000-0000-4000-8000-000000000008'::uuid),
    ('b0000000-0000-4000-8000-000000000009'::uuid),
    ('b0000000-0000-4000-8000-000000000010'::uuid),
    ('b0000000-0000-4000-8000-000000000011'::uuid),
    ('b0000000-0000-4000-8000-000000000012'::uuid),
    ('b0000000-0000-4000-8000-000000000013'::uuid),
    ('b0000000-0000-4000-8000-000000000014'::uuid),
    ('b0000000-0000-4000-8000-000000000015'::uuid),
    ('b0000000-0000-4000-8000-000000000016'::uuid),
    ('b0000000-0000-4000-8000-000000000017'::uuid),
    ('b0000000-0000-4000-8000-000000000018'::uuid),
    ('b0000000-0000-4000-8000-000000000019'::uuid),
    ('b0000000-0000-4000-8000-000000000020'::uuid),
    ('b0000000-0000-4000-8000-000000000021'::uuid),
    ('b0000000-0000-4000-8000-000000000022'::uuid),
    ('b0000000-0000-4000-8000-000000000023'::uuid)
  ) as box_ids(id);


-- =============================================================================
-- 4. USER PLACEHOLDERS - edit before running this section
-- =============================================================================
-- profiles.id must reference an existing auth.users row, so accounts are
-- created first and promoted here:
--
--   Step 1: Supabase Dashboard > Authentication > Users > "Add user"
--           (use "Auto Confirm User"). The on_auth_user_created trigger
--           instantly creates a profile with role 'viewer' and
--           is_active = false - deliberately useless until promoted.
--   Step 2: Copy each user's UUID from the dashboard.
--   Step 3: Replace the placeholder UUIDs below and run these statements.
--
-- The placeholder updates below match ZERO rows as-is, so running this file
-- unchanged is harmless.

-- ADMIN placeholder
update public.profiles
   set full_name   = 'Admin Name',
       employee_id = 'EMP-0001',
       department  = 'EHS',
       role        = 'admin',
       is_active   = true
 where id = '00000000-0000-0000-0000-000000000000';  -- <-- replace with the real auth user UUID

-- FIRST AIDER placeholder
update public.profiles
   set full_name   = 'First Aider Name',
       employee_id = 'EMP-0002',
       department  = 'Production',
       role        = 'first_aider',
       is_active   = true
 where id = '00000000-0000-0000-0000-000000000000';  -- <-- replace with the real auth user UUID

-- ASSIGNMENT examples (uncomment and replace UUIDs once the users above exist).
-- One first aider can be assigned to many boxes, and one box to many aiders.
--
-- insert into public.box_assignments (box_id, profile_id, is_primary_responsible, assigned_by)
-- values
--   ('11111111-1111-4111-8111-111111111111', '<first-aider-uuid>', true,  '<admin-uuid>'), -- REC-01
--   ('22222222-2222-4222-8222-222222222222', '<first-aider-uuid>', false, '<admin-uuid>'); -- OFF-01
