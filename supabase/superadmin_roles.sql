-- =============================================================================
-- Role migration: Superadmin / Admin / User
-- Run this once in Supabase SQL Editor after the existing schema/revamp scripts.
--
-- Existing data mapping:
--   admin       -> superadmin   (prevents losing access to user management)
--   first_aider -> user
--   viewer      -> user
-- =============================================================================

begin;

alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
   set role = case role
     when 'admin' then 'superadmin'
     when 'first_aider' then 'user'
     when 'viewer' then 'user'
     else role
   end;

alter table public.profiles alter column role set default 'user';
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'user'));

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
    'user',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Profiles: Superadmin only manages user IDs/roles.
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_select_superadmin on public.profiles
  for select to authenticated
  using ((select public.active_role()) = 'superadmin');

create policy profiles_update_superadmin on public.profiles
  for update to authenticated
  using      ((select public.active_role()) = 'superadmin')
  with check ((select public.active_role()) = 'superadmin');

-- Boxes.
drop policy if exists boxes_select on public.boxes;
create policy boxes_select on public.boxes
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
        and is_active
        and public.is_assigned_to_box(id))
  );

drop policy if exists boxes_insert_admin on public.boxes;
create policy boxes_insert_admin on public.boxes
  for insert to authenticated
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists boxes_update_admin on public.boxes;
create policy boxes_update_admin on public.boxes
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists boxes_delete_admin on public.boxes;
create policy boxes_delete_admin on public.boxes
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Assignments.
drop policy if exists box_assignments_select on public.box_assignments;
create policy box_assignments_select on public.box_assignments
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) is not null
        and profile_id = (select auth.uid())
        and is_active)
  );

drop policy if exists box_assignments_insert_admin on public.box_assignments;
create policy box_assignments_insert_admin on public.box_assignments
  for insert to authenticated
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists box_assignments_update_admin on public.box_assignments;
create policy box_assignments_update_admin on public.box_assignments
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists box_assignments_delete_admin on public.box_assignments;
create policy box_assignments_delete_admin on public.box_assignments
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Templates.
drop policy if exists templates_select on public.first_aid_kit_templates;
create policy templates_select on public.first_aid_kit_templates
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
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
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists templates_update_admin on public.first_aid_kit_templates;
create policy templates_update_admin on public.first_aid_kit_templates
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists templates_delete_admin on public.first_aid_kit_templates;
create policy templates_delete_admin on public.first_aid_kit_templates
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Template items.
drop policy if exists template_items_select on public.first_aid_kit_template_items;
create policy template_items_select on public.first_aid_kit_template_items
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
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
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists template_items_update_admin on public.first_aid_kit_template_items;
create policy template_items_update_admin on public.first_aid_kit_template_items
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists template_items_delete_admin on public.first_aid_kit_template_items;
create policy template_items_delete_admin on public.first_aid_kit_template_items
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Box items.
drop policy if exists box_items_select on public.box_items;
create policy box_items_select on public.box_items
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
        and is_active
        and public.is_assigned_to_box(box_id))
  );

drop policy if exists box_items_insert_admin on public.box_items;
create policy box_items_insert_admin on public.box_items
  for insert to authenticated
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists box_items_update_admin on public.box_items;
create policy box_items_update_admin on public.box_items
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists box_items_delete_admin on public.box_items;
create policy box_items_delete_admin on public.box_items
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Inspections and lines.
drop policy if exists inspections_select on public.inspections;
create policy inspections_select on public.inspections
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
        and inspector_id = (select auth.uid()))
  );

drop policy if exists inspections_insert_first_aider on public.inspections;
drop policy if exists inspections_insert_user on public.inspections;
create policy inspections_insert_user on public.inspections
  for insert to authenticated
  with check (
    (select public.active_role()) = 'user'
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
  using ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists inspection_items_select on public.inspection_items;
create policy inspection_items_select on public.inspection_items
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
        and exists (
              select 1
                from public.inspections i
               where i.id = inspection_id
                 and i.inspector_id = (select auth.uid())
            ))
  );

drop policy if exists inspection_items_insert_first_aider on public.inspection_items;
drop policy if exists inspection_items_insert_user on public.inspection_items;
create policy inspection_items_insert_user on public.inspection_items
  for insert to authenticated
  with check (
    (select public.active_role()) = 'user'
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

-- Topups.
drop policy if exists topups_select on public.topup_requests;
create policy topups_select on public.topup_requests
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user'
        and public.is_assigned_to_box(box_id))
  );

drop policy if exists topups_insert_admin on public.topup_requests;
create policy topups_insert_admin on public.topup_requests
  for insert to authenticated
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists topups_update_admin on public.topup_requests;
create policy topups_update_admin on public.topup_requests
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists topups_delete_admin on public.topup_requests;
create policy topups_delete_admin on public.topup_requests
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Usage logs and reminders.
drop policy if exists usage_logs_select on public.first_aid_usage_logs;
create policy usage_logs_select on public.first_aid_usage_logs
  for select to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists usage_logs_delete_admin on public.first_aid_usage_logs;
create policy usage_logs_delete_admin on public.first_aid_usage_logs
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists reminder_logs_select_admin on public.reminder_logs;
create policy reminder_logs_select_admin on public.reminder_logs
  for select to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

-- Revamp actions table.
drop policy if exists actions_select on public.actions;
create policy actions_select on public.actions
  for select to authenticated
  using (
    (select public.active_role()) in ('superadmin', 'admin')
    or ((select public.active_role()) = 'user' and public.is_assigned_to_box(box_id))
  );

drop policy if exists actions_insert_admin on public.actions;
create policy actions_insert_admin on public.actions
  for insert to authenticated
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists actions_update_admin on public.actions;
create policy actions_update_admin on public.actions
  for update to authenticated
  using      ((select public.active_role()) in ('superadmin', 'admin'))
  with check ((select public.active_role()) in ('superadmin', 'admin'));

drop policy if exists actions_delete_admin on public.actions;
create policy actions_delete_admin on public.actions
  for delete to authenticated
  using ((select public.active_role()) in ('superadmin', 'admin'));

notify pgrst, 'reload schema';

commit;
