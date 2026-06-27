-- =============================================================================
-- REVAMP SMOKE TEST - actions table RLS + action_code trigger.
-- *** LOCAL ONLY. *** Runs after smoke_test.sql, reusing its users/boxes:
--   0001 superadmin, 0002 user (assigned to WH box 1111...), 0003 admin.
--   Box 1111... (WH) has first aiders; box 2222... (PR) has none active.
-- =============================================================================

-- ---- service role creates actions (as the inspection-submit server would) ---
set role service_role;

insert into public.actions (box_id, action_type, category, item_name, priority, created_by)
values ('11111111-1111-4111-8111-111111111111', 'Item Low Qty', 'item', 'Handyplast', 'Medium',
        '00000000-0000-4000-8000-000000000002');
insert into public.actions (box_id, action_type, category)
values ('22222222-2222-4222-8222-222222222222', 'Box Accessibility Issue', 'quick_check');

do $$
begin
  if exists (select 1 from public.actions where action_code is null) then
    raise exception 'FAIL: action_code was not auto-generated';
  end if;
  if exists (select 1 from public.actions where action_code !~ '^FA-ACT-[0-9]{4}-[0-9]{4}$') then
    raise exception 'FAIL: action_code format is wrong';
  end if;
end
$$;

reset role;

-- ---- anon: zero access ------------------------------------------------------
set role anon;
do $$
begin
  begin
    perform 1 from public.actions limit 1;
    raise exception 'FAIL: anon can read actions';
  exception when insufficient_privilege then null;  -- expected
  end;
end
$$;
reset role;

-- ---- admin: reads all + can close ------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$
declare n integer;
begin
  if (select count(*) from public.actions) <> 2 then
    raise exception 'FAIL: admin should see all actions';
  end if;
  update public.actions
     set status = 'Closed', closed_by = (select auth.uid()), closed_at = now(), closure_note = 'restocked'
   where action_type = 'Item Low Qty';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not close an action'; end if;
end
$$;

-- ---- first aider (assigned to WH only): scoped read, no writes --------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$
declare n integer;
begin
  if (select count(*) from public.actions) <> 1 then
    raise exception 'FAIL: first aider should see only their assigned box actions';
  end if;
  if exists (select 1 from public.actions where box_id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: first aider can see an unassigned box action';
  end if;

  begin
    insert into public.actions (box_id, action_type, category)
    values ('11111111-1111-4111-8111-111111111111', 'Item Missing', 'item');
    raise exception 'FAIL: first aider inserted an action';
  exception when insufficient_privilege then null;  -- expected
  end;

  update public.actions set status = 'Closed' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: first aider closed an action'; end if;
end
$$;

-- ---- admin: reads all -------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$
begin
  if (select count(*) from public.actions) <> 2 then
    raise exception 'FAIL: admin should read all actions';
  end if;
end
$$;
reset role;

select 'ACTIONS REVAMP TESTS PASSED' as result;
