-- =====================================================================================================
-- SLICE 6 (3/n) -- the AAL seam stops being a stub (Phase 2 D, F, H, AG)
--
-- Slice 3 left this behind deliberately:
--
--     internal.session_aal_ok() -> select true;  -- AAL2 not yet enforced (Slice 6 replaces this body)
--
-- It is already folded into session_live() -> session_ok() -> internal.can() and
-- internal.has_site_capability(), which is why Slice 5 could say invitation redemption "inherits the
-- AAL2 requirement without being changed here". Replacing this one body is how that promise is kept,
-- and it is the reason Slice 6 does not scatter MFA checks through the application.
--
-- THE ASSURANCE IS READ FROM THE SERVER, NOT FROM THE TOKEN (D-S6-AUTO-1). Phase 2 describes reading
-- auth.jwt()->>'aal'. That claim is minted at sign-in and travels in the client's hands, so a session
-- whose factors were deleted a moment ago still presents aal2 until its JWT expires, and "stale AAL
-- claim" is an attack this slice is required to defeat. auth.sessions.aal is GoTrue's own record of the
-- same fact, updated when a factor is verified, and it cannot be replayed by a holder of an old token.
-- Reading the row is strictly stronger and never weaker, so the row is the authority.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- What this session actually is, according to the server.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.current_session_aal()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session text := auth.jwt() ->> 'session_id';
begin
  if v_uid is null then return null; end if;
  -- A token minted outside GoTrue (the service key, and the test harness) carries no session id. It is
  -- not a browser session and is not what this gate is about.
  if v_session is null or v_session = '' or v_session !~ '^[0-9a-fA-F-]{36}$' then return 'service'; end if;
  return (select s.aal::text from auth.sessions s where s.id = v_session::uuid and s.user_id = v_uid);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- A session whose FIRST factor was a magic link or an email OTP.
--
-- Phase 2 AG.2 T6 makes these setup-restricted once magic-link login is retired for a group: they may
-- set a password and verify MFA and nothing else. Before T6 the flag is false everywhere and this
-- returns false, so today's users are untouched.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.session_first_factor()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_session text := auth.jwt() ->> 'session_id';
begin
  if v_session is null or v_session = '' or v_session !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return (select a.authentication_method from auth.mfa_amr_claims a
           where a.session_id = v_session::uuid
           order by a.created_at asc limit 1);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- THE SEAM.
--
-- Reads as: this session is good enough for ordinary authenticated work. It is false only when the
-- person's own group is being enforced and their session has not reached AAL2 -- so at T0, with every
-- group off, it is true for everybody and the release changes nobody's access.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.session_aal_ok()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_aal text;
  v_group text;
begin
  if v_uid is null then return false; end if;

  v_aal := internal.current_session_aal();
  -- No session row for a session id that claims to exist: revoked, expired, or never ours.
  -- session_live() checks that too; answering false here as well keeps this honest on its own.
  if v_aal is null then return false; end if;
  if v_aal = 'service' then return true; end if;
  if v_aal = 'aal2' then return true; end if;

  -- AAL1 from here. Whether that is acceptable is a question about this person's rollout group.
  select s.enforcement_group into v_group from public.account_security_state s where s.user_id = v_uid;
  v_group := coalesce(v_group, internal.derive_enforcement_group(v_uid));

  -- An explicit per-person override, for the person a rollout would otherwise strand.
  if exists (select 1 from public.account_security_state s
              where s.user_id = v_uid and s.enforcement_override = 'FORCE_NOW') then
    return false;
  end if;
  if exists (select 1 from public.account_security_state s
              where s.user_id = v_uid and s.enforcement_override = 'EXEMPT_UNTIL_DATE'
                and s.enforcement_override_until > now()) then
    return true;
  end if;

  return not internal.mfa_enforced_for_group(v_group);
end $$;

comment on function internal.session_aal_ok() is
  'Phase 2 F/AG. True unless this person''s enforcement group requires AAL2 and this session has not '
  'reached it. Reads auth.sessions.aal, never the JWT claim, so a stale token cannot assert AAL2.';

-- ---------------------------------------------------------------------------------------------------
-- R -- "recent AAL2", TOTP within the last N minutes (F).
--
-- Taken from this session's own amr entry for the totp method. A person who verified an authenticator
-- an hour ago holds AAL2 but not R, which is exactly the distinction the sensitive operations need.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.recent_aal2(p_minutes integer default 10)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_session text := auth.jwt() ->> 'session_id';
  v_when timestamptz;
begin
  if auth.uid() is null then return false; end if;
  -- The service key and the test harness are not a browser session, and R is a statement about one.
  if v_session is null or v_session = '' or v_session !~ '^[0-9a-fA-F-]{36}$' then return true; end if;

  select max(a.updated_at) into v_when
    from auth.mfa_amr_claims a
   where a.session_id = v_session::uuid and a.authentication_method = 'totp';

  return v_when is not null and v_when > now() - make_interval(mins => greatest(p_minutes, 1));
end $$;

comment on function internal.recent_aal2(integer) is
  'Phase 2 F. Did this session verify a TOTP code within the window? Holding AAL2 is not the same as '
  'having proved it recently, and the sensitive operations want the second thing.';

-- ---------------------------------------------------------------------------------------------------
-- Revocation (H). Deleting the auth.sessions row is what makes revocation real: session_ok checks the
-- row exists, so it takes effect on the NEXT database request rather than when a JWT happens to expire.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.revoke_session(p_session_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from auth.sessions where id = p_session_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function internal.revoke_all_sessions(p_user_id uuid, p_except_session_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from auth.sessions
   where user_id = p_user_id
     and (p_except_session_id is null or id <> p_except_session_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Service role only: these are reached through server code that has already decided the person may do
-- it, never called from a browser.
revoke all on function internal.revoke_session(uuid) from public, anon, authenticated;
revoke all on function internal.revoke_all_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function internal.revoke_session(uuid) to service_role;
grant execute on function internal.revoke_all_sessions(uuid, uuid) to service_role;

grant execute on function internal.session_aal_ok() to authenticated;
grant execute on function internal.recent_aal2(integer) to authenticated;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='internal' and p.proname='session_aal_ok') ~ 'select true;\s*--' then
    raise exception 'Slice 6: session_aal_ok is still the Slice 3 stub.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='internal' and p.proname='session_aal_ok') ~ 'auth\.jwt\(\)\s*->>\s*''aal''' then
    raise exception 'Slice 6: the AAL decision reads the JWT claim, which a stale token can assert.';
  end if;
  raise notice 'Slice 6: the AAL seam is live, and reads the server session, not the token';
end $$;
