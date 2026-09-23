-- Run once in the existing First Aid project's SQL editor. Safe to rerun.
-- Only hashes and request counters are stored, never email addresses or tokens.
begin;

create table if not exists public.password_reset_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  last_requested_at timestamptz not null,
  attempts integer not null check (attempts >= 0)
);
alter table public.password_reset_limits enable row level security;
revoke all on public.password_reset_limits from public, anon, authenticated;
grant all on public.password_reset_limits to service_role;

create or replace function public.claim_password_reset_request(p_email_hash text, p_ip_hash text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp timestamptz := clock_timestamp();
  keys text[] := array['email:' || p_email_hash, 'ip:' || p_ip_hash, 'global'];
  limits integer[] := array[5, 20, 100];
  bucket public.password_reset_limits%rowtype;
  retry_after integer := 0;
  i integer;
begin
  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$'
     or p_email_hash is null or p_ip_hash is null then
    raise exception 'Invalid rate limit key';
  end if;

  -- Serialize the three counters together across all serverless instances.
  perform pg_advisory_xact_lock(782164039);
  delete from public.password_reset_limits where last_requested_at < stamp - interval '1 day';
  for i in 1..3 loop
    select * into bucket from public.password_reset_limits where bucket_key = keys[i];
    if not found then continue; end if;
    if i = 1 and bucket.last_requested_at > stamp - interval '60 seconds' then
      retry_after := greatest(retry_after, ceil(extract(epoch from bucket.last_requested_at + interval '60 seconds' - stamp))::integer);
    end if;
    if bucket.window_started_at > stamp - interval '1 hour' and bucket.attempts >= limits[i] then
      retry_after := greatest(retry_after, ceil(extract(epoch from bucket.window_started_at + interval '1 hour' - stamp))::integer);
    end if;
  end loop;
  if retry_after > 0 then return retry_after; end if;

  -- Rejected requests must not create unbounded rows for random addresses/IPs.
  for i in 1..3 loop
    insert into public.password_reset_limits values (keys[i], stamp, stamp, 1)
    on conflict (bucket_key) do update
    set attempts = case when password_reset_limits.window_started_at <= stamp - interval '1 hour' then 1 else password_reset_limits.attempts + 1 end,
        window_started_at = case when password_reset_limits.window_started_at <= stamp - interval '1 hour' then stamp else password_reset_limits.window_started_at end,
        last_requested_at = stamp;
  end loop;
  return 0;
end;
$$;
revoke all on function public.claim_password_reset_request(text, text) from public, anon, authenticated;
grant execute on function public.claim_password_reset_request(text, text) to service_role;

commit;
