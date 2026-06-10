-- =============================================================================
-- LOCAL TEST SHIM - stand-in for the Supabase environment.
--
-- *** NEVER run this against a real Supabase project. ***
-- It fabricates the auth schema and API roles that Supabase already provides.
-- It exists only so schema.sql / rls_policies.sql / seed.sql can be executed
-- and verified against a throwaway local Postgres (see run-tests.mjs).
-- =============================================================================

-- Supabase API roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- Minimal auth schema (Supabase manages the real one)
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- auth.uid() reads the JWT subject; locally we feed it via a session setting.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on table auth.users to service_role;

-- Mirror Supabase's default privileges: objects created later in public are
-- auto-granted to the API roles. rls_policies.sql then revokes and narrows
-- these, exactly as it does on a real project.
alter default privileges in schema public grant all     on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
