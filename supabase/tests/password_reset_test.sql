begin;
do $$
declare
  email_hash text := repeat('a', 64);
  ip_hash text := repeat('b', 64);
  wait_seconds integer;
begin
  if has_function_privilege('anon', 'public.claim_password_reset_request(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_password_reset_request(text,text)', 'execute') then
    raise exception 'Public roles must not call the reset limiter';
  end if;
  if has_table_privilege('anon', 'public.password_reset_limits', 'select')
     or has_table_privilege('authenticated', 'public.password_reset_limits', 'select') then
    raise exception 'Public roles must not read reset counters';
  end if;
  if not has_function_privilege('service_role', 'public.claim_password_reset_request(text,text)', 'execute') then
    raise exception 'Server must be able to claim a reset';
  end if;
  if public.claim_password_reset_request(email_hash, ip_hash) <> 0 then
    raise exception 'First request must be allowed';
  end if;
  wait_seconds := public.claim_password_reset_request(email_hash, ip_hash);
  if wait_seconds not between 59 and 60 then raise exception 'Repeat request must wait 60 seconds'; end if;
  if (select attempts from public.password_reset_limits where bucket_key = 'email:' || email_hash) <> 1 then
    raise exception 'Rejected request must not extend cooldown';
  end if;
  update public.password_reset_limits set last_requested_at = now() - interval '61 seconds';
  if public.claim_password_reset_request(email_hash, ip_hash) <> 0 then raise exception 'Cooldown must end'; end if;
  update public.password_reset_limits set attempts = 5, last_requested_at = now() - interval '61 seconds'
    where bucket_key = 'email:' || email_hash;
  if public.claim_password_reset_request(email_hash, ip_hash) < 3500 then raise exception 'Email hourly limit must apply'; end if;
  update public.password_reset_limits set window_started_at = now() - interval '61 minutes', last_requested_at = now() - interval '61 minutes';
  if public.claim_password_reset_request(email_hash, ip_hash) <> 0 then raise exception 'Hour rollover must reset'; end if;
  update public.password_reset_limits set attempts = 20 where bucket_key = 'ip:' || ip_hash;
  if public.claim_password_reset_request(repeat('c', 64), ip_hash) < 3500 then raise exception 'IP limit must apply to new addresses'; end if;
  update public.password_reset_limits set attempts = 100 where bucket_key = 'global';
  if public.claim_password_reset_request(repeat('d', 64), repeat('e', 64)) < 3500 then raise exception 'Global limit must apply'; end if;
  if exists (select 1 from public.password_reset_limits where bucket_key in ('email:' || repeat('d', 64), 'ip:' || repeat('e', 64))) then
    raise exception 'Rejected requests must not create unused counters';
  end if;
end;
$$;
rollback;
