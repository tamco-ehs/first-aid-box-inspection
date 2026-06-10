-- =============================================================================
-- RLS SMOKE TEST - exercises every role against every table.
--
-- *** LOCAL ONLY. NEVER run against a real Supabase project. ***
-- (It inserts fake auth.users rows and test data.)
--
-- Prerequisites, in order: local_shim.sql, schema.sql, rls_policies.sql,
-- seed.sql. Runs in a single session and impersonates the Supabase API roles
-- with SET ROLE + the request.jwt.claim.sub session setting.
--
-- Every block raises an exception (failing the run) if an expectation is not
-- met. Output of the final statement confirms success.
-- =============================================================================

-- =============================================================================
-- 0. FIXTURES (as superuser)
-- =============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'alice.admin@example.com',  '{"full_name": "Alice Admin"}'),
  ('00000000-0000-4000-8000-000000000002', 'fred.aider@example.com',   '{"full_name": "Fred Aider"}'),
  ('00000000-0000-4000-8000-000000000003', 'vera.viewer@example.com',  '{"full_name": "Vera Viewer"}'),
  ('00000000-0000-4000-8000-000000000004', 'ina.inactive@example.com', '{"full_name": "Ina Inactive"}'),
  ('00000000-0000-4000-8000-000000000005', 'farid.multi@example.com',  '{"full_name": "Farid Multi"}');

-- The signup trigger must have created locked-down profiles for all of them.
do $$
begin
  if (select count(*) from public.profiles) <> 5 then
    raise exception 'FAIL: handle_new_user trigger did not create 5 profiles';
  end if;
  if exists (select 1 from public.profiles where role <> 'viewer' or is_active) then
    raise exception 'FAIL: new profiles must default to INACTIVE viewer';
  end if;
  if (select email from public.profiles where id = '00000000-0000-4000-8000-000000000001')
       <> 'alice.admin@example.com' then
    raise exception 'FAIL: trigger did not copy auth email into profile';
  end if;
  if (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000002')
       <> 'Fred Aider' then
    raise exception 'FAIL: trigger did not copy full_name from signup metadata';
  end if;
end
$$;

-- Promote test users (this is what an admin does after creating accounts).
update public.profiles set role = 'admin',       is_active = true, employee_id = 'EMP-0001', department = 'EHS'        where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'first_aider', is_active = true, employee_id = 'EMP-0002', department = 'Production' where id = '00000000-0000-4000-8000-000000000002';
update public.profiles set role = 'viewer',      is_active = true, employee_id = 'EMP-0003', department = 'HR'         where id = '00000000-0000-4000-8000-000000000003';
update public.profiles set role = 'first_aider', is_active = true, employee_id = 'EMP-0005', department = 'Warehouse'  where id = '00000000-0000-4000-8000-000000000005';
-- 0004 stays an inactive viewer on purpose.

-- IDs an attacker might guess; stored in a helper table so role-switched
-- blocks can reference them. Dropped at the end.
create table public.smoke_ids as
select
  (select id from public.box_items
    where box_id = '11111111-1111-4111-8111-111111111111' and item_name = 'Yellow lotion') as wh_yellow_lotion,
  (select id from public.box_items
    where box_id = '22222222-2222-4222-8222-222222222222' and item_name = 'Yellow lotion') as pr_yellow_lotion;

do $$
begin
  if (select wh_yellow_lotion from public.smoke_ids) is null
     or (select pr_yellow_lotion from public.smoke_ids) is null then
    raise exception 'FAIL: seed did not instantiate box items from the template';
  end if;
end
$$;

-- =============================================================================
-- 1. ANON (public internet): zero access to everything
-- =============================================================================
set role anon;

do $$
declare
  rel text;
begin
  foreach rel in array array[
    'profiles', 'first_aid_kit_templates', 'first_aid_kit_template_items',
    'boxes', 'box_assignments', 'box_items', 'inspections', 'inspection_items',
    'topup_requests', 'first_aid_usage_logs', 'reminder_logs', 'box_items_effective'
  ]
  loop
    begin
      execute format('select * from public.%I limit 1', rel);
      raise exception 'FAIL: anon can read %', rel;
    exception
      when insufficient_privilege then null;  -- expected
    end;
  end loop;

  begin
    insert into public.first_aid_usage_logs (box_id, user_name, department, usage_purpose)
    values ('11111111-1111-4111-8111-111111111111', 'Mallory', 'None', 'direct write attempt');
    raise exception 'FAIL: anon can write usage logs directly';
  exception
    when insufficient_privilege then null;  -- expected
  end;
end
$$;

reset role;

-- =============================================================================
-- 2. SERVICE ROLE: the server endpoints' writes work; CHECKs still apply
-- =============================================================================
set role service_role;

insert into public.first_aid_usage_logs
  (box_id, user_name, department, usage_purpose, items_taken, client_ip_hash)
values
  ('11111111-1111-4111-8111-111111111111', 'Walter Worker', 'Production',
   'Small cut on left finger', '["Handyplast"]', repeat('a', 64));

insert into public.reminder_logs (box_id, reminder_type, days_overdue, email_sent_to, status)
values ('11111111-1111-4111-8111-111111111111', 'overdue', 5, 'fred.aider@example.com', 'sent');

do $$
begin
  -- DB CHECK constraints are the backstop even for service-role writes
  begin
    insert into public.first_aid_usage_logs (box_id, user_name, department, usage_purpose)
    values ('11111111-1111-4111-8111-111111111111', 'X', 'QA', 'name too short');
    raise exception 'FAIL: check constraint did not reject 1-char user_name';
  exception
    when check_violation then null;  -- expected
  end;
end
$$;

reset role;

-- =============================================================================
-- 3. ADMIN: full master-data control, no inspection submission
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

do $$
begin
  if (select count(*) from public.profiles) <> 5 then raise exception 'FAIL: admin should see all 5 profiles'; end if;
  if (select count(*) from public.boxes) <> 2 then raise exception 'FAIL: admin should see both seeded boxes'; end if;
  if (select count(*) from public.first_aid_kit_templates) <> 1 then raise exception 'FAIL: admin template visibility'; end if;
  if (select count(*) from public.first_aid_kit_template_items) <> 22 then raise exception 'FAIL: expected 22 template items'; end if;
  if (select count(*) from public.box_items) <> 44 then raise exception 'FAIL: expected 22 box items in each of 2 boxes'; end if;
  if (select count(*) from public.first_aid_usage_logs) <> 1 then raise exception 'FAIL: admin should read usage logs'; end if;
  if (select count(*) from public.reminder_logs) <> 1 then raise exception 'FAIL: admin should read reminder logs'; end if;
end
$$;

-- Admin creates a third box and instantiates it from the template.
insert into public.boxes (id, box_code, box_name, location_description, area, template_id)
values ('44444444-4444-4444-8444-444444444444', 'FAB-OF-001', 'Office First Aid Box',
        'Office lobby, beside reception', 'Office', 'a0000000-0000-4000-8000-000000000001');

do $$
declare
  n integer;
begin
  n := public.apply_template_to_box('44444444-4444-4444-8444-444444444444');
  if n <> 22 then raise exception 'FAIL: apply_template_to_box created % items, expected 22', n; end if;
  n := public.apply_template_to_box('44444444-4444-4444-8444-444444444444');
  if n <> 0 then raise exception 'FAIL: apply_template_to_box is not idempotent (created % extra)', n; end if;
end
$$;

-- Admin uploads a reference photo on the template item (scissors) and a
-- box-specific override photo on one box item (warehouse yellow lotion).
update public.first_aid_kit_template_items
   set item_photo_url = 'https://res.cloudinary.com/demo/image/upload/scissors-ref.jpg',
       item_photo_cloudinary_public_id = 'scissors-ref'
 where item_code = 'FA-007';

update public.box_items
   set item_photo_url = 'https://res.cloudinary.com/demo/image/upload/wh-lotion-override.jpg',
       item_photo_cloudinary_public_id = 'wh-lotion-override'
 where id = (select wh_yellow_lotion from public.smoke_ids);

-- Admin assigns first aiders: Fred -> WH; Farid -> WH + PR.
-- (one box, many aiders / one aider, many boxes)
insert into public.box_assignments (box_id, profile_id, is_primary_responsible, assigned_by) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002', true,  '00000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000005', false, '00000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-000000000005', true,  '00000000-0000-4000-8000-000000000001');

do $$
begin
  -- duplicate ACTIVE assignment must be rejected
  begin
    insert into public.box_assignments (box_id, profile_id, assigned_by)
    values ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: duplicate active assignment was accepted';
  exception
    when unique_violation then null;  -- expected
  end;

  -- per spec, admins do not submit inspections (commented toggle in policies)
  begin
    insert into public.inspections (box_id, inspector_id, inspector_name, overall_status)
    values ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001',
            'Alice Admin', 'Pass');
    raise exception 'FAIL: admin could submit an inspection';
  exception
    when insufficient_privilege then null;  -- expected
  end;
end
$$;

-- =============================================================================
-- 4. FIRST AIDER (Fred, assigned to Warehouse box only)
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);

do $$
declare
  n integer;
begin
  if (select count(*) from public.boxes) <> 1 then
    raise exception 'FAIL: Fred should see exactly his 1 assigned box';
  end if;
  if exists (select 1 from public.boxes where id = '44444444-4444-4444-8444-444444444444') then
    raise exception 'FAIL: Fred can see an unassigned box';
  end if;
  if (select count(*) from public.first_aid_kit_templates) <> 1 then
    raise exception 'FAIL: Fred should read the template of his assigned box';
  end if;
  if (select count(*) from public.first_aid_kit_template_items) <> 22 then
    raise exception 'FAIL: Fred should read the 22 checklist master items';
  end if;
  if (select count(*) from public.box_items) <> 22 then
    raise exception 'FAIL: Fred should read only his box''s 22 items';
  end if;
  if (select count(*) from public.box_assignments) <> 1 then
    raise exception 'FAIL: Fred should see only his own assignment';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: Fred should see only his own profile';
  end if;

  -- checklist cards: template photo is the default, box photo overrides
  if (select effective_item_photo_url from public.box_items_effective
       where box_id = '11111111-1111-4111-8111-111111111111' and item_code = 'FA-007')
     <> 'https://res.cloudinary.com/demo/image/upload/scissors-ref.jpg' then
    raise exception 'FAIL: template reference photo did not flow through to the checklist card';
  end if;
  if (select effective_item_photo_url from public.box_items_effective
       where id = (select wh_yellow_lotion from public.smoke_ids))
     <> 'https://res.cloudinary.com/demo/image/upload/wh-lotion-override.jpg' then
    raise exception 'FAIL: box-level photo override did not win over the template photo';
  end if;

  -- privilege escalation attempts must silently match zero rows or be denied
  update public.profiles set role = 'admin' where id = (select auth.uid());
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a first aider changed his own role'; end if;

  begin
    insert into public.box_assignments (box_id, profile_id)
    values ('22222222-2222-4222-8222-222222222222', (select auth.uid()));
    raise exception 'FAIL: a first aider self-assigned to a box';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  begin
    insert into public.box_items (box_id, item_name, measurement_type)
    values ('11111111-1111-4111-8111-111111111111', 'Rogue item', 'quantity');
    raise exception 'FAIL: a first aider wrote box master data';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  begin
    insert into public.first_aid_kit_templates (template_name) values ('Rogue template');
    raise exception 'FAIL: a first aider created a template';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- apply_template_to_box is SECURITY INVOKER: under Fred's RLS it can see
  -- nothing to copy for an unassigned box, so it must be a harmless no-op.
  n := public.apply_template_to_box('44444444-4444-4444-8444-444444444444');
  if n <> 0 then raise exception 'FAIL: apply_template_to_box wrote rows for a first aider'; end if;
end
$$;

-- Fred submits a valid inspection. The spoofed name/department he sends must
-- be overwritten from his profile by the snapshot trigger.
insert into public.inspections
  (id, box_id, inspector_id, inspector_name, inspector_department,
   overall_status, notes, submitted_device)
values
  ('e0000000-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000002',
   'Spoofed Name', 'Spoofed Dept',
   'Needs Restock', 'Yellow lotion below half.', 'mobile-test');

do $$
begin
  if (select inspector_name from public.inspections
       where id = 'e0000000-0000-4000-8000-000000000001') <> 'Fred Aider' then
    raise exception 'FAIL: inspector snapshot trigger did not overwrite a spoofed name';
  end if;
  if (select inspector_department from public.inspections
       where id = 'e0000000-0000-4000-8000-000000000001') <> 'Production' then
    raise exception 'FAIL: inspector snapshot trigger did not overwrite a spoofed department';
  end if;
end
$$;

-- A line item for his own inspection, referencing an item of the same box.
do $$
declare
  v_item uuid;
begin
  select wh_yellow_lotion into v_item from public.smoke_ids;
  insert into public.inspection_items
    (inspection_id, box_item_id, item_name, required_quantity, unit, measurement_type,
     observed_volume_level, item_status, is_below_half, topup_required, remarks)
  values
    ('e0000000-0000-4000-8000-000000000001', v_item, 'Yellow lotion', 1, 'bottle',
     'volume_level', 'Below Half', 'Low Stock', true, true, 'Replace soon');
end
$$;

do $$
declare
  v_pr_item uuid;
  n integer;
begin
  select pr_yellow_lotion into v_pr_item from public.smoke_ids;

  -- cross-box injection: a line referencing ANOTHER box's item must be denied
  begin
    insert into public.inspection_items (inspection_id, box_item_id, item_name)
    values ('e0000000-0000-4000-8000-000000000001', v_pr_item, 'Yellow lotion');
    raise exception 'FAIL: inspection line accepted an item from a different box';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- inspecting an unassigned box must be denied
  begin
    insert into public.inspections (box_id, inspector_id, inspector_name, overall_status)
    values ('22222222-2222-4222-8222-222222222222', (select auth.uid()), 'Fred Aider', 'Pass');
    raise exception 'FAIL: a first aider inspected an unassigned box';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- submitting as someone else must be denied
  begin
    insert into public.inspections (box_id, inspector_id, inspector_name, overall_status)
    values ('11111111-1111-4111-8111-111111111111',
            '00000000-0000-4000-8000-000000000005', 'Farid Multi', 'Pass');
    raise exception 'FAIL: a first aider submitted an inspection as another user';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- invalid enum value is stopped by the CHECK constraint
  begin
    insert into public.inspections (box_id, inspector_id, inspector_name, overall_status)
    values ('11111111-1111-4111-8111-111111111111', (select auth.uid()), 'Fred Aider', 'Broken');
    raise exception 'FAIL: invalid overall_status was accepted';
  exception
    when check_violation then null;  -- expected
  end;

  -- usage logs: no read, no direct write for first aiders
  if (select count(*) from public.first_aid_usage_logs) <> 0 then
    raise exception 'FAIL: a first aider can read usage logs';
  end if;
  begin
    insert into public.first_aid_usage_logs (box_id, user_name, department, usage_purpose)
    values ('11111111-1111-4111-8111-111111111111', 'Fred Aider', 'Production', 'direct write');
    raise exception 'FAIL: a first aider wrote usage logs directly';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  if (select count(*) from public.reminder_logs) <> 0 then
    raise exception 'FAIL: a first aider can read reminder logs';
  end if;

  -- inspections are immutable: UPDATE is not even granted to authenticated
  -- (denied at the privilege level), and DELETE matches zero rows under RLS
  begin
    update public.inspections set notes = 'tampered'
     where id = 'e0000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: a first aider edited a submitted inspection'; end if;
  exception
    when insufficient_privilege then null;  -- expected (grant-level denial)
  end;

  delete from public.inspections where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a first aider deleted a submitted inspection'; end if;

  -- box master data is read-only for first aiders
  update public.box_items set current_quantity = 999
   where id = (select wh_yellow_lotion from public.smoke_ids);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a first aider updated box item state directly'; end if;
end
$$;

-- =============================================================================
-- 5. SECOND FIRST AIDER (Farid: WH + PR) - multi-box, own-records-only
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);

do $$
begin
  if (select count(*) from public.boxes) <> 2 then
    raise exception 'FAIL: Farid should see his 2 assigned boxes';
  end if;
  -- Fred's inspection is invisible to Farid (own submissions only)
  if (select count(*) from public.inspections) <> 0 then
    raise exception 'FAIL: a first aider can read another aider''s inspections';
  end if;
  if (select count(*) from public.inspection_items) <> 0 then
    raise exception 'FAIL: a first aider can read another aider''s inspection lines';
  end if;
end
$$;

-- =============================================================================
-- 6. SERVER-SIDE AUTOMATION (service role): top-up + box state after inspection
-- =============================================================================
reset role;
set role service_role;

do $$
declare
  v_line uuid;
begin
  select id into v_line from public.inspection_items
   where inspection_id = 'e0000000-0000-4000-8000-000000000001'
   limit 1;

  insert into public.topup_requests
    (box_id, inspection_id, inspection_item_id, item_name, reason,
     required_quantity, observed_volume_level, priority, requested_by)
  values
    ('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000001',
     v_line, 'Yellow lotion', 'Below half during inspection',
     1, 'Below Half', 'High', '00000000-0000-4000-8000-000000000002');

  update public.box_items
     set current_volume_level = 'Below Half'
   where box_id = '11111111-1111-4111-8111-111111111111'
     and item_name = 'Yellow lotion';
end
$$;

reset role;

-- =============================================================================
-- 7. VISIBILITY MATRIX: viewer, first aiders, inactive user
-- =============================================================================
set role authenticated;

-- Fred (assigned to WH) sees the WH top-up but cannot manage it
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$
declare
  n integer;
begin
  if (select count(*) from public.topup_requests) <> 1 then
    raise exception 'FAIL: Fred should see the top-up for his assigned box';
  end if;
  update public.topup_requests set status = 'Completed' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a first aider updated a top-up request'; end if;
end
$$;

-- Farid (also assigned to WH) sees it too
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);
do $$
begin
  if (select count(*) from public.topup_requests) <> 1 then
    raise exception 'FAIL: Farid should see the WH top-up (also assigned to that box)';
  end if;
end
$$;

-- Vera the viewer: read-only reports, no master data, no writes
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$
declare
  n integer;
begin
  if (select count(*) from public.boxes) <> 3 then raise exception 'FAIL: viewer should see all 3 active boxes'; end if;
  if (select count(*) from public.inspections) <> 1 then raise exception 'FAIL: viewer should see all inspections'; end if;
  if (select count(*) from public.inspection_items) <> 1 then raise exception 'FAIL: viewer should see all inspection lines'; end if;
  if (select count(*) from public.topup_requests) <> 1 then raise exception 'FAIL: viewer should see all top-ups'; end if;
  if (select count(*) from public.first_aid_usage_logs) <> 1 then raise exception 'FAIL: viewer should see usage logs'; end if;
  if (select count(*) from public.first_aid_kit_templates) <> 0 then raise exception 'FAIL: viewer should not see templates'; end if;
  if (select count(*) from public.first_aid_kit_template_items) <> 0 then raise exception 'FAIL: viewer should not see template items'; end if;
  if (select count(*) from public.box_items) <> 0 then raise exception 'FAIL: viewer should not see box items'; end if;
  if (select count(*) from public.reminder_logs) <> 0 then raise exception 'FAIL: viewer should not see reminder logs'; end if;

  begin
    insert into public.inspections (box_id, inspector_id, inspector_name, overall_status)
    values ('11111111-1111-4111-8111-111111111111', (select auth.uid()), 'Vera Viewer', 'Pass');
    raise exception 'FAIL: a viewer submitted an inspection';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  update public.boxes set box_name = 'tampered' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a viewer edited a box'; end if;

  update public.topup_requests set status = 'Completed' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a viewer updated a top-up request'; end if;
end
$$;

-- Ina (deactivated): own profile only, everything else gone
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: an inactive user should still see (only) their own profile';
  end if;
  if (select count(*) from public.boxes) <> 0
     or (select count(*) from public.inspections) <> 0
     or (select count(*) from public.topup_requests) <> 0
     or (select count(*) from public.first_aid_usage_logs) <> 0 then
    raise exception 'FAIL: an inactive user can still access data';
  end if;
end
$$;

-- =============================================================================
-- 8. ADMIN WRAP-UP: top-up lifecycle, deassignment, audit cleanup
-- =============================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

do $$
declare
  n integer;
begin
  -- admin completes the top-up
  update public.topup_requests
     set status = 'Completed',
         completed_by = (select auth.uid()),
         completed_at = now(),
         remarks = 'Restocked from store'
   where status = 'Open';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not complete the top-up request'; end if;

  -- admin revokes Farid's PR assignment; his box visibility must shrink
  update public.box_assignments
     set is_active = false
   where box_id = '22222222-2222-4222-8222-222222222222'
     and profile_id = '00000000-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not deactivate an assignment'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);
do $$
begin
  if (select count(*) from public.boxes) <> 1 then
    raise exception 'FAIL: revoking an assignment did not remove box access';
  end if;
end
$$;

-- admin deletes the test inspection: lines cascade, top-up survives unlinked
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$
declare
  n integer;
begin
  delete from public.inspections where id = 'e0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not delete an inspection'; end if;

  if (select count(*) from public.inspection_items) <> 0 then
    raise exception 'FAIL: inspection lines did not cascade on delete';
  end if;
  if (select count(*) from public.topup_requests
       where item_name = 'Yellow lotion' and inspection_id is null) <> 1 then
    raise exception 'FAIL: top-up should survive inspection deletion with inspection_id nulled';
  end if;
end
$$;

reset role;
drop table public.smoke_ids;

select 'ALL RLS SMOKE TESTS PASSED' as result;
