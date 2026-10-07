-- =====================================================================================================
-- A CLUB CONNECTS GOCARDLESS FROM THE APP
--
-- Until now the phone opened the website's /api/gocardless/oauth/start in the system browser. That route
-- needs a WEBSITE session, which the browser on a phone usually does not have, so the person met a web
-- sign-in; and the callback finished on the website's settings page, so nothing ever came back to the app.
--
-- The app now starts the connection itself, over its own bearer token, and the website carries it through
-- GoCardless and hands the result back. The difficulty is that three requests in that journey carry no
-- Ovalball session at all -- the browser opening the link, GoCardless sending it back, and the redirect
-- into the app -- and the obvious way to bridge them (a link that says "connect club X") is a link that
-- can be forwarded. A Club Admin who starts a connection, keeps the link and forwards it to the GoCardless
-- admin of another organisation would have THAT organisation's consent attach ITS account to the sender's
-- club. So the journey is held together by one server-side record, an INTENT, and every hop is bound to it:
--
--   start     a signed-in person holding finance.gocardless.connect at a club that has agreed Ovalball's
--             Club Memberships terms creates the intent. Its club is fixed here, from that check, and never
--             taken from a later request. It answers with a one-time BEGIN TOKEN, stored only as its SHA-256.
--   begin     the browser presents the token (no session): single use, three minutes. It learns the
--             intent's STATE, which the website puts in an httpOnly cookie and sends to GoCardless.
--   callback  GoCardless sends the browser back with a code and the state. The code is attached to the
--             intent only when the browser's cookie IS that state, so a code cannot be injected into
--             somebody else's journey; and the code never leaves the server. The browser is sent on into
--             the app with the intent's id and a one-time RETURN HANDOFF, stored only as its SHA-256.
--   claim     the app, with its bearer token AND the handoff, claims the code. Only the person who started
--             the intent may; anyone else is refused and the intent voided. Only the device whose browser
--             completed GoCardless was handed the handoff -- so a link forwarded to another organisation
--             ends with the handoff on THEIR device, and the sender can never claim what their consent
--             produced. A missing handoff waits (nothing changes); a wrong one voids the intent.
--             GoCardless's own rule applies too: a code is exchanged within five minutes or not at all.
--   finish    the exchange and store_gocardless_connection run as that same person, whose authority is
--             asked again there; the intent records how it ended.
--
-- WHY NOT THE BEGIN ADDRESS. The first version of this bound the begin link to the address that asked for
-- it. The authentication session is Safari, and iCloud Private Relay (on by default for iCloud+) relays
-- Safari's traffic but not the app's own -- so the begin request left from an Apple relay address and every
-- such person was refused; an IPv4/IPv6 split does the same, and the iPhone simulator showed it on the first
-- run. The address is still recorded, and whether the two matched is kept as a diagnostic, but it refuses
-- nothing: the return handoff is what binds the journey to the device that finished it.
--
-- The table lives in `internal` with no grants: every read and write is one of the functions below.
-- The functions that serve the session-less hops are executable by the service role only.
-- =====================================================================================================

create table if not exists internal.gocardless_connect_intents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sent to GoCardless and back, and held by the browser in an httpOnly cookie. 192 random bits.
  state text not null unique,
  -- The begin token itself is never stored: only its SHA-256, so a read of this table cannot open a door.
  begin_token_hash bytea not null unique,
  begin_expires_at timestamptz not null,
  begin_used_at timestamptz,
  -- The address that asked for the intent, normalised by internal.gocardless_connect_ip; NULL when the
  -- request carried none. A diagnostic, never a refusal (see the header).
  requester_ip text,
  -- Whether the begin request came from that same address: NULL when either side was unknown.
  begin_same_address boolean,
  -- Where the browser is sent at the end: an address in the Ovalball app, never a website.
  return_url text not null,
  -- GoCardless's authorisation code. A secret for its short life: erased when it is claimed, when it
  -- expires, or when the intent is voided.
  code text,
  code_received_at timestamptz,
  -- The SHA-256 of the one-time handoff the browser was sent into the app with. Erased with the code.
  return_handoff_hash bytea,
  claimed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint gocardless_connect_intents_one_ending check (completed_at is null or failed_at is null),
  constraint gocardless_connect_intents_reason_with_failure check (failure_reason is null or failed_at is not null)
);

-- The same columns for a database that met the first version of this migration.
alter table internal.gocardless_connect_intents add column if not exists begin_same_address boolean;
alter table internal.gocardless_connect_intents add column if not exists return_handoff_hash bytea;

create index if not exists gocardless_connect_intents_by_user on internal.gocardless_connect_intents (user_id, created_at desc);
create index if not exists gocardless_connect_intents_live_codes on internal.gocardless_connect_intents (code_received_at) where code is not null;

revoke all on table internal.gocardless_connect_intents from public, anon, authenticated, service_role;

comment on table internal.gocardless_connect_intents is
  'One mobile "Connect with GoCardless" journey (20270750000000). Binds the begin link, the browser''s state '
  'cookie, GoCardless''s code, the return handoff and the person who started it to one club. No API role holds '
  'any privilege; every access is a SECURITY DEFINER function in this migration.';

-- -----------------------------------------------------------------------------------------------------
-- THE ONE ANSWER TO "IS THIS THE SAME ADDRESS" -- for the diagnostic only.
--
-- An address arrives in more than one spelling: an IPv4 address as an IPv4-mapped IPv6 address, with a
-- port, in brackets, with a different IPv6 compression. Each is reduced to the address itself and
-- compared as an inet. Anything that does not parse is NULL.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.gocardless_connect_ip(p_ip text)
 returns inet
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v text := lower(btrim(coalesce(p_ip, '')));
begin
  if v = '' or length(v) > 100 then
    return null;
  end if;
  if v ~ '^\[[0-9a-f:.]+\](:[0-9]{1,5})?$' then
    v := substring(v from '^\[([0-9a-f:.]+)\]');
  elsif v ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]{1,5}$' then
    v := split_part(v, ':', 1);
  end if;
  if v ~ '^::ffff:[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
    v := substr(v, 8);
  end if;
  return pg_catalog.host(v::inet)::inet;
exception when others then
  return null;
end;
$function$;
revoke all on function internal.gocardless_connect_ip(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- START -- a signed-in person, for a club they may connect, which has agreed the terms.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.start_gocardless_connect_intent(p_club_id uuid, p_return_url text, p_requester_ip text default null)
 returns table(intent_id uuid, begin_token text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_url text := btrim(coalesce(p_return_url, ''));
  v_scheme text;
  v_token text;
  v_id uuid;
begin
  perform internal.require_live_session();
  if p_club_id is null or not internal.can('finance.gocardless.connect', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to connect GoCardless for this club.' using errcode = '42501';
  end if;

  -- TERMS FIRST (20270748000000). A club agrees how Club Memberships work, and what Ovalball's fee is,
  -- before any GoCardless account is attached to it. The hint lets a caller tell this refusal from the
  -- return-address one without reading the sentence.
  if not internal.club_membership_terms_accepted(p_club_id) then
    raise exception 'Agree to Ovalball''s terms for Club Memberships before connecting GoCardless.'
      using errcode = '22023', hint = 'membership_terms';
  end if;

  -- Back into the Ovalball app and nowhere else: its own three schemes, and Expo Go's while it is being
  -- built. Never http or https, so the end of this journey cannot be pointed at a website.
  v_scheme := lower(substring(v_url from '^([A-Za-z][A-Za-z0-9+.-]*)://'));
  if v_scheme is null
     or v_scheme not in ('ovalball', 'ovalball-dev', 'ovalball-staging', 'exp', 'exps')
     or length(v_url) > 512
     or v_url ~ '[[:space:][:cntrl:]#]' then
    raise exception 'That return address is not one the Ovalball app uses.' using errcode = '22023', hint = 'return_address';
  end if;

  -- An authorisation code nobody claimed is dead at GoCardless after five minutes; it is not kept here.
  update internal.gocardless_connect_intents i
     set code = null, return_handoff_hash = null
   where i.code is not null and i.code_received_at < now() - interval '10 minutes';

  -- 256 bits, base64url: the same idiom as the invitation and onboarding credentials.
  v_token := rtrim(replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=');

  insert into internal.gocardless_connect_intents
    (club_id, user_id, state, begin_token_hash, begin_expires_at, requester_ip, return_url)
  values
    (p_club_id, auth.uid(), encode(extensions.gen_random_bytes(24), 'hex'), extensions.digest(v_token, 'sha256'),
     now() + interval '3 minutes', pg_catalog.host(internal.gocardless_connect_ip(p_requester_ip)), v_url)
  returning id into v_id;

  return query select v_id, v_token;
end;
$function$;

comment on function public.start_gocardless_connect_intent(uuid, text, text) is
  'Mobile GoCardless connect, step 1 (20270750000000). Needs a live session, finance.gocardless.connect at the '
  'club and the club''s agreement to the Club Memberships terms; the return address must be in the Ovalball '
  'app. Returns the intent and its one-time begin token, which is stored only as a hash and never returned again.';

-- -----------------------------------------------------------------------------------------------------
-- BEGIN -- the browser, with no session. Service role only.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.consume_gocardless_connect_begin(p_token text, p_requester_ip text default null)
 returns table(outcome text, state text, club_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v internal.gocardless_connect_intents;
  v_here inet := internal.gocardless_connect_ip(p_requester_ip);
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,128}$' then
    return query select 'not_found'::text, null::text, null::uuid;
    return;
  end if;

  select * into v
    from internal.gocardless_connect_intents i
   where i.begin_token_hash = extensions.digest(p_token, 'sha256')
   for update;
  if v.id is null then
    return query select 'not_found'::text, null::text, null::uuid;
    return;
  end if;

  -- A second presentation learns nothing and changes nothing: the first one already holds the journey.
  if v.begin_used_at is not null then
    return query select 'used'::text, null::text, null::uuid;
    return;
  end if;

  -- From here the token is spent, whatever the answer. A begin link is good for one attempt. Whether it was
  -- opened from the address that asked for it is recorded for diagnosis, and decides nothing.
  update internal.gocardless_connect_intents i
     set begin_used_at = now(),
         begin_same_address = case when v.requester_ip is null or v_here is null then null
                                   else v_here = internal.gocardless_connect_ip(v.requester_ip) end
   where i.id = v.id;

  if v.completed_at is not null or v.failed_at is not null or v.claimed_at is not null then
    return query select 'closed'::text, null::text, null::uuid;
    return;
  end if;

  if v.begin_expires_at <= now() then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'begin_expired'
     where i.id = v.id;
    return query select 'expired'::text, null::text, null::uuid;
    return;
  end if;

  return query select 'ok'::text, v.state, v.club_id;
end;
$function$;

comment on function public.consume_gocardless_connect_begin(text, text) is
  'Mobile GoCardless connect, step 2 (20270750000000). Service role only: the begin route has no session and '
  'is authorised by the token alone -- single use and three minutes. The address is recorded, never refused.';

-- -----------------------------------------------------------------------------------------------------
-- CALLBACK -- GoCardless's code, attached to the intent whose state the browser's cookie named, and the
-- one-time handoff the browser carries back into the app. Service role only. The route has already
-- required cookie = returned state; this requires the intent to be open and begun, and refuses a second
-- code. Its answer gained a column, so it is replaced rather than redefined.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.attach_gocardless_connect_code(text, text);

create or replace function public.attach_gocardless_connect_code(p_state text, p_code text)
 returns table(outcome text, intent_id uuid, return_url text, handoff text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v internal.gocardless_connect_intents;
  v_handoff text;
begin
  if p_state is null or p_state !~ '^[0-9a-f]{48}$' then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v from internal.gocardless_connect_intents i where i.state = p_state for update;
  if v.id is null then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v.begin_used_at is null or v.code is not null or v.code_received_at is not null
     or v.claimed_at is not null or v.completed_at is not null or v.failed_at is not null then
    return query select 'closed'::text, v.id, v.return_url, null::text;
    return;
  end if;

  if p_code is null or btrim(p_code) = '' or length(p_code) > 512 then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'no_code'
     where i.id = v.id;
    return query select 'closed'::text, v.id, v.return_url, null::text;
    return;
  end if;

  -- The browser's cookie lives ten minutes; an intent is not held open longer than that and some.
  if v.begin_used_at < now() - interval '20 minutes' then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'returned_too_late'
     where i.id = v.id;
    return query select 'closed'::text, v.id, v.return_url, null::text;
    return;
  end if;

  -- 256 bits, base64url, handed to this browser alone and kept here only as its SHA-256.
  v_handoff := rtrim(replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=');
  update internal.gocardless_connect_intents i
     set code = p_code, code_received_at = now(), return_handoff_hash = extensions.digest(v_handoff, 'sha256')
   where i.id = v.id;
  return query select 'attached'::text, v.id, v.return_url, v_handoff;
end;
$function$;

comment on function public.attach_gocardless_connect_code(text, text) is
  'Mobile GoCardless connect, step 3 (20270750000000). Service role only. Attaches GoCardless''s code to the '
  'open intent with this state, once, and mints the one-time return handoff the browser carries into the app. '
  'Returns the intent id, its return address and that handoff -- never the code.';

-- -----------------------------------------------------------------------------------------------------
-- CALLBACK, REFUSED -- GoCardless said no, sent no code, or the website could not continue. The intent
-- with this state is closed so nothing can finish it. Service role only.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.fail_gocardless_connect_intent(p_state text, p_reason text)
 returns table(intent_id uuid, return_url text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v internal.gocardless_connect_intents;
  v_reason text := case when coalesce(p_reason, '') ~ '^[a-z_]{1,64}$' then p_reason else 'provider_error' end;
begin
  if p_state is null or p_state !~ '^[0-9a-f]{48}$' then
    return;
  end if;
  select * into v from internal.gocardless_connect_intents i where i.state = p_state for update;
  if v.id is null then
    return;
  end if;
  if v.completed_at is null and v.failed_at is null and v.claimed_at is null then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = v_reason, code = null, return_handoff_hash = null
     where i.id = v.id;
  end if;
  return query select v.id, v.return_url;
end;
$function$;

comment on function public.fail_gocardless_connect_intent(text, text) is
  'Mobile GoCardless connect (20270750000000). Service role only. Closes the open intent with this state, '
  'with a short reason, so that nothing can finish it; returns where to send the browser.';

-- -----------------------------------------------------------------------------------------------------
-- CLAIM -- the person who started it, holding the handoff the return carried, and nobody else.
--
-- Refusals RETURN rather than raise. Two of them change something -- a stranger presenting the intent, and
-- a wrong handoff, both void it -- and a raised exception would roll that change back with it. An unknown
-- id and somebody else's id get the same answer, so the answer says nothing about which. A MISSING
-- handoff changes nothing at all: on Android the return can reach the app's router a moment after the
-- browser reports itself closed, and that return must still be able to finish within GoCardless's five
-- minutes. The signature gained the handoff, so the old one is removed.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.claim_gocardless_connect_code(uuid);

create or replace function public.claim_gocardless_connect_code(p_intent_id uuid, p_handoff text default null)
 returns table(outcome text, code text, club_id uuid, reason text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v internal.gocardless_connect_intents;
  v_handoff text := nullif(btrim(coalesce(p_handoff, '')), '');
begin
  perform internal.require_live_session();

  select * into v from internal.gocardless_connect_intents i where i.id = p_intent_id for update;
  if v.id is null then
    return query select 'refused'::text, null::text, null::uuid, null::text;
    return;
  end if;

  if v.user_id is distinct from auth.uid() then
    if v.completed_at is null and v.failed_at is null then
      update internal.gocardless_connect_intents i
         set failed_at = now(), failure_reason = 'claimed_by_another_account', code = null, return_handoff_hash = null
       where i.id = v.id;
    end if;
    return query select 'refused'::text, null::text, null::uuid, null::text;
    return;
  end if;

  if v.completed_at is not null or v.failed_at is not null or v.claimed_at is not null then
    return query select 'closed'::text, null::text, null::uuid,
      coalesce(v.failure_reason, case when v.completed_at is not null then 'completed' else 'claimed' end);
    return;
  end if;

  -- Nothing came back from GoCardless: the person closed the browser, or never got that far.
  if v.code is null then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'not_returned'
     where i.id = v.id;
    return query select 'not_returned'::text, null::text, null::uuid, 'not_returned'::text;
    return;
  end if;

  -- GoCardless: "Exchange the code within 5 minutes."
  if v.code_received_at < now() - interval '5 minutes' then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'code_expired', code = null, return_handoff_hash = null
     where i.id = v.id;
    return query select 'expired'::text, null::text, null::uuid, 'code_expired'::text;
    return;
  end if;

  -- THE RETURN MUST HAVE REACHED THIS PHONE. Without the handoff, wait: nothing changes.
  if v_handoff is null then
    return query select 'awaiting_return'::text, null::text, null::uuid, 'awaiting_return'::text;
    return;
  end if;

  -- A wrong one is not a typo -- the app copies it, it never types it -- so the intent is voided.
  if v.return_handoff_hash is null or extensions.digest(v_handoff, 'sha256') is distinct from v.return_handoff_hash then
    update internal.gocardless_connect_intents i
       set failed_at = now(), failure_reason = 'handoff_mismatch', code = null, return_handoff_hash = null
     where i.id = v.id;
    return query select 'closed'::text, null::text, null::uuid, 'handoff_mismatch'::text;
    return;
  end if;

  update internal.gocardless_connect_intents i
     set claimed_at = now(), code = null, return_handoff_hash = null
   where i.id = v.id;
  return query select 'claimed'::text, v.code, v.club_id, null::text;
end;
$function$;

comment on function public.claim_gocardless_connect_code(uuid, text) is
  'Mobile GoCardless connect, step 4 (20270750000000). Hands the code to the person who started the intent, '
  'holding the one-time handoff its return carried, once, within five minutes of its arrival, and erases it. '
  'No handoff: wait, nothing changes. A wrong handoff, or anybody else: refused, and the intent voided.';

-- -----------------------------------------------------------------------------------------------------
-- FINISH -- how the person's own, claimed intent ended.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.finish_gocardless_connect_intent(p_intent_id uuid, p_ok boolean, p_reason text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v internal.gocardless_connect_intents;
  v_reason text := case when coalesce(p_reason, '') ~ '^[a-z_]{1,64}$' then p_reason else 'failed' end;
begin
  perform internal.require_live_session();

  select * into v from internal.gocardless_connect_intents i where i.id = p_intent_id for update;
  if v.id is null or v.user_id is distinct from auth.uid() then
    raise exception 'This GoCardless connection is not yours to finish.' using errcode = '42501';
  end if;
  if v.claimed_at is null or v.completed_at is not null or v.failed_at is not null then
    raise exception 'This GoCardless connection has already finished.' using errcode = '55000';
  end if;

  if coalesce(p_ok, false) then
    update internal.gocardless_connect_intents i set completed_at = now() where i.id = v.id;
  else
    update internal.gocardless_connect_intents i set failed_at = now(), failure_reason = v_reason where i.id = v.id;
  end if;
end;
$function$;

comment on function public.finish_gocardless_connect_intent(uuid, boolean, text) is
  'Mobile GoCardless connect, step 5 (20270750000000). Records whether the person''s own claimed intent ended '
  'in a stored connection. It grants nothing: the connection itself is store_gocardless_connection''s.';

-- -----------------------------------------------------------------------------------------------------
-- Who may call what.
-- -----------------------------------------------------------------------------------------------------
revoke all on function public.start_gocardless_connect_intent(uuid, text, text) from public, anon;
revoke all on function public.claim_gocardless_connect_code(uuid, text) from public, anon;
revoke all on function public.finish_gocardless_connect_intent(uuid, boolean, text) from public, anon;
grant execute on function public.start_gocardless_connect_intent(uuid, text, text) to authenticated;
grant execute on function public.claim_gocardless_connect_code(uuid, text) to authenticated;
grant execute on function public.finish_gocardless_connect_intent(uuid, boolean, text) to authenticated;

revoke all on function public.consume_gocardless_connect_begin(text, text) from public, anon, authenticated;
revoke all on function public.attach_gocardless_connect_code(text, text) from public, anon, authenticated;
revoke all on function public.fail_gocardless_connect_intent(text, text) from public, anon, authenticated;
grant execute on function public.consume_gocardless_connect_begin(text, text) to service_role;
grant execute on function public.attach_gocardless_connect_code(text, text) to service_role;
grant execute on function public.fail_gocardless_connect_intent(text, text) to service_role;

-- -----------------------------------------------------------------------------------------------------
-- THE MIGRATION CHECKS ITSELF.
-- -----------------------------------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- One claim, and it is the one that asks for the handoff; one attach, and it hands one back.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'claim_gocardless_connect_code') <> 1
     or to_regprocedure('public.claim_gocardless_connect_code(uuid, text)') is null then
    raise exception '20270750000000: claim_gocardless_connect_code must exist exactly once, as (uuid, text)';
  end if;
  if pg_get_function_result('public.attach_gocardless_connect_code(text, text)'::regprocedure) not like '%handoff text%' then
    raise exception '20270750000000: attach_gocardless_connect_code does not hand back the return handoff';
  end if;

  -- The person-facing three: definer, owned by postgres, signed-in only, behind the session gate.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('start_gocardless_connect_intent', 'claim_gocardless_connect_code', 'finish_gocardless_connect_intent')
     and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres'
          or not has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or p.prosrc !~ 'internal\.require_live_session\s*\(');
  if v_bad <> '' then
    raise exception '20270750000000: a person-facing connect function is mis-granted or ungated: %', v_bad;
  end if;

  -- The session-less three: the service role, and no browser role.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('consume_gocardless_connect_begin', 'attach_gocardless_connect_code', 'fail_gocardless_connect_intent')
     and (not p.prosecdef
          or not has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'));
  if v_bad <> '' then
    raise exception '20270750000000: a server-only connect function is reachable by a browser role: %', v_bad;
  end if;

  -- The intents themselves: no API role holds anything on them.
  if has_table_privilege('anon', 'internal.gocardless_connect_intents', 'select')
     or has_table_privilege('authenticated', 'internal.gocardless_connect_intents', 'select')
     or has_table_privilege('service_role', 'internal.gocardless_connect_intents', 'select') then
    raise exception '20270750000000: an API role can read the connect intents directly';
  end if;
end $$;
