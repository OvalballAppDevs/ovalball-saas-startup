-- FIX: `register_push_device_token` and `unregister_push_device_token` (20270706000000) checked only
-- `auth.uid() is null`, which is weaker than the canonical gate every other mutating SECURITY DEFINER
-- RPC uses. `auth.uid()` resolves from the JWT alone and says nothing about whether the SESSION behind
-- it is still live -- the exact "sign-out-everywhere landing mid-request" race
-- `supabase/tests/definer_rpc_session_contract.sql` (RPC-29) exists to close. Its permanent closure
-- check (RPC-30) caught these two functions never reaching `internal.require_live_session()` /
-- `internal.session_ok()` through the call graph, the same way it would catch any other mutation that
-- bypassed the gate -- there is no reason a device-registration write should be held to a lower bar
-- than every other one.
--
-- `require_live_session()` also means a device can no longer be registered against the person's
-- `auth.uid()` from a bare, valid-looking JWT whose underlying session has already been revoked.

create or replace function public.register_push_device_token(p_token text, p_platform text, p_app_variant text)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  if coalesce(trim(p_token), '') = '' then
    raise exception 'A device token is required.' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Unrecognised platform.' using errcode = '22023';
  end if;
  if p_app_variant not in ('development', 'staging', 'production') then
    raise exception 'Unrecognised app variant.' using errcode = '22023';
  end if;

  insert into public.push_device_tokens (user_id, token, platform, app_variant, last_seen_at)
  values (auth.uid(), p_token, p_platform, p_app_variant, now())
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_variant = excluded.app_variant,
    last_seen_at = now();
end;
$function$;

create or replace function public.unregister_push_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  perform internal.require_live_session();
  delete from public.push_device_tokens where token = p_token and user_id = auth.uid();
end;
$function$;
