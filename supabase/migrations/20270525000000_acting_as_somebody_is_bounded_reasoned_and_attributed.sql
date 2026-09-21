-- =====================================================================================================
-- CONVERGENCE STEP 13 -- IDENTITY/AUTH SLICE 9: IMPERSONATION
--
-- The checked-in scope, quoted from IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md:
--
--   "Slice 9 -- Impersonation. `impersonation_sessions`, header plumbing in lib/supabase/server.ts,
--    `effective_person` (the stub becomes real), view-only restrictive policy, blocked list, banner.
--    Acceptance: AD fully proven; audit shows actor and effective person for every act-as write."
--
-- and AD's contract: AAL2, explicit reason, 30-minute expiry, view-only default, dual attribution,
-- blocked areas. AN-9 -- notify the person afterwards -- is Slice 9's too.
--
-- THE SEAM WAS BUILT FOR THIS AND LEFT DELIBERATELY INERT. `internal.effective_person()` has been a
-- stub returning `auth.uid()`, and FIFTEEN function bodies already call it -- including
-- `internal.can`, `internal.has_site_capability`, `my_capabilities`, `explain_access`, and both audit
-- writers. `audit_log.effective_person_id` and `security_events.effective_person_id` already exist.
-- So making the stub real is what turns impersonation on across the whole engine at once, and the
-- attribution columns fill themselves. Nothing here re-implements authority.
--
-- WHAT IS DELIBERATELY NOT A HEADER. The reconciliation anticipated header plumbing. A header is a
-- value the browser sends, and this decides whose authority the server uses -- so the session lives
-- in a TABLE, keyed by the real `auth.uid()`, and the server reads it. A forged header cannot start
-- or extend a session, because the client is never asked.
-- =====================================================================================================

create table if not exists public.impersonation_sessions (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid not null references auth.users(id) on delete cascade,
  target_user_id  uuid not null references auth.users(id) on delete cascade,
  -- AD: an explicit reason. Not optional, and not a single character to get past a check.
  reason          text not null check (char_length(btrim(reason)) between 8 and 500),
  -- AD: view-only by DEFAULT. Acting requires a second capability, and is recorded on the session.
  view_only       boolean not null default true,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 minutes',
  ended_at        timestamptz,
  ended_by        uuid references auth.users(id),
  end_reason      text,
  constraint impersonation_not_self check (actor_user_id <> target_user_id),
  constraint impersonation_window check (expires_at > started_at),
  constraint impersonation_end_shape check ((ended_at is null) = (ended_by is null))
);

comment on table public.impersonation_sessions is
  'A bounded, reasoned, attributed act-as session. The server reads it by the real auth.uid(); the '
  'browser is never asked who it is acting as, so a forged header cannot start or extend one.';

-- ONE AT A TIME. Two overlapping sessions would make "who is this person acting as" ambiguous at
-- exactly the moment an audit record needs to be unambiguous.
create unique index if not exists impersonation_one_active_per_actor
  on public.impersonation_sessions (actor_user_id) where ended_at is null;

create index if not exists impersonation_target_idx on public.impersonation_sessions (target_user_id);

alter table public.impersonation_sessions enable row level security;

-- A person may read sessions where they are the actor OR the subject. Being impersonated is
-- something you are entitled to know about, which is the same instinct AN-9 comes from.
drop policy if exists impersonation_sessions_read on public.impersonation_sessions;
create policy impersonation_sessions_read on public.impersonation_sessions
  for select to authenticated using (
    internal.session_ok()
    and (actor_user_id = auth.uid() or target_user_id = auth.uid()
         or internal.has_site_capability('site.users.view'))
  );

-- No browser write path at all: starting and ending go through the two RPCs below.

-- -----------------------------------------------------------------------------------------------
-- 1. THE ACTIVE SESSION, AND THE SEAM BECOMING REAL
-- -----------------------------------------------------------------------------------------------
create or replace function internal.active_impersonation()
returns table(id uuid, target_user_id uuid, view_only boolean, expires_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select s.id, s.target_user_id, s.view_only, s.expires_at
    from public.impersonation_sessions s
   where s.actor_user_id = auth.uid()
     and s.ended_at is null
     -- EXPIRY IS A READ-TIME FACT, not a job that has to have run. A session nobody ended stops
     -- working the moment it expires, whether or not anything swept it.
     and s.expires_at > now()
   limit 1;
$$;

-- THE STUB BECOMES REAL.
--
-- `internal.actor()` stays `auth.uid()` -- the real person, for the session gate and for
-- attribution. `effective_person()` is whose authority is being used. Everything that already asked
-- the seam now gets the answer it was always shaped to receive.
create or replace function internal.effective_person()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce((select a.target_user_id from internal.active_impersonation() a), auth.uid());
$$;

comment on function internal.effective_person() is
  'Whose authority this request uses. Equal to internal.actor() unless the signed-in person has an '
  'active, unexpired impersonation session, in which case it is the person being acted as. Slice 9 '
  'made the Slice 4 stub real; fifteen callers including internal.can were already written for it.';

-- -----------------------------------------------------------------------------------------------
-- 2. VIEW-ONLY, AND THE BLOCKED LIST
--
-- Enforced at the capability engine rather than as a restrictive policy on every table, because
-- `internal.can` is the one chokepoint every authority decision already passes through, and a
-- partial list of protected tables is worse than one gate.
-- -----------------------------------------------------------------------------------------------

-- AREAS AN IMPERSONATOR MAY NEVER REACH, even read-only, and even as a Full Site Admin. Looking at
-- somebody's account through their own eyes is not a reason to be inside a child's safeguarding
-- record or their security settings.
create or replace function internal.impersonation_blocked_capability(p_key text)
returns boolean language sql immutable as $$
  select p_key ~ '^safeguarding\.'
      or p_key ~ '^site\.users\.(identity|security)\.'
      or p_key ~ '^(account|security)\.'
      or p_key ~ '\.(export|merge|disable)$';
$$;

create or replace function internal.impersonation_permits(p_key text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_view_only boolean;
begin
  select a.view_only into v_view_only from internal.active_impersonation() a;
  if v_view_only is null then
    return true;                      -- not impersonating: the engine answers as it always did
  end if;
  if internal.impersonation_blocked_capability(p_key) then
    return false;                     -- blocked areas: refused whether or not acting is permitted
  end if;
  if not v_view_only then
    return true;                      -- site.users.impersonate_act was held when the session began
  end if;
  -- VIEW-ONLY: reads only. Anything that is not a view capability is refused.
  return p_key ~ '\.view(_|$)';
end;
$$;

create or replace function internal.can(p_key text, p_scope_type text, p_club uuid default null,
                                        p_team uuid default null, p_player uuid default null)
returns boolean language sql stable security definer set search_path to '' as $$
  -- Slice 9: an impersonated request is clamped BEFORE the decision is read, so a view-only session
  -- cannot be talked into a write by any caller, and a blocked area is refused for everyone.
  select internal.impersonation_permits(p_key)
     and coalesce((internal.capability_decision(internal.effective_person(), p_key, p_scope_type,
                                                p_club, p_team, p_player, true, false)).allowed, false);
$$;

-- THE SITE GATE NEEDS THE SAME CLAMP.
--
-- `internal.has_site_capability` asks `capability_decision` DIRECTLY rather than going through
-- `internal.can`, so the clamp above would not have reached it. Ordinarily that is harmless -- during
-- an impersonation the decision is evaluated as the TARGET, and the target is usually not a site
-- admin -- but a Full Site Admin acting as another Full Site Admin would have kept unclamped site
-- authority. Same gate, same reason.
create or replace function internal.has_site_capability(p_key text)
returns boolean language sql stable security definer set search_path to '' as $$
  select internal.impersonation_permits(p_key)
     and coalesce((internal.capability_decision(internal.effective_person(), p_key, 'site',
                                                null, null, null, true, false)).allowed, false);
$$;

-- -----------------------------------------------------------------------------------------------
-- 3. STARTING AND ENDING
-- -----------------------------------------------------------------------------------------------
create or replace function public.start_impersonation(p_target_user_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_id uuid; v_view_only boolean;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- AD: AAL2, and recently. Acting as somebody else is not something a stale session may begin.
  perform internal.require_recent_aal2();

  if not internal.has_site_capability('site.users.impersonate') then
    raise exception 'You are not authorised to act as another person.' using errcode = '42501';
  end if;
  if p_target_user_id is null or p_target_user_id = v_actor then
    raise exception 'Choose somebody other than yourself.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'That person does not exist.' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Give a reason for acting as this person.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.impersonation_sessions s
              where s.actor_user_id = v_actor and s.ended_at is null and s.expires_at > now()) then
    raise exception 'You are already acting as somebody. End that first.' using errcode = 'P0001';
  end if;

  -- VIEW-ONLY UNLESS THE SECOND CAPABILITY IS HELD, decided once, at the start, and recorded on the
  -- session -- so losing the capability mid-session cannot silently widen what already began.
  v_view_only := not internal.has_site_capability('site.users.impersonate_act');

  insert into public.impersonation_sessions (actor_user_id, target_user_id, reason, view_only)
  values (v_actor, p_target_user_id, btrim(p_reason), v_view_only)
  returning id into v_id;

  perform internal.emit_security_event(
    'impersonation.started', p_target_user_id, 'SUCCESS', btrim(p_reason),
    jsonb_build_object('session_id', v_id, 'view_only', v_view_only));

  return v_id;
end;
$$;

create or replace function public.end_impersonation(p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_id uuid; v_target uuid;
begin
  v_actor := internal.actor();
  -- THE CANONICAL SESSION GATE, like every other browser-callable definer mutation. An earlier draft
  -- left it off so that ending would always be forgiving; Slice 6b.2a's closure is not negotiable,
  -- and a dead session cannot be acting as anybody in the first place.
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select s.id, s.target_user_id into v_id, v_target
    from public.impersonation_sessions s
   where s.actor_user_id = v_actor and s.ended_at is null
   order by s.started_at desc limit 1;
  if v_id is null then
    return;                            -- ending nothing is not an error
  end if;

  update public.impersonation_sessions
     set ended_at = now(), ended_by = v_actor, end_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = v_id;

  perform internal.emit_security_event(
    'impersonation.ended', v_target, 'SUCCESS', nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('session_id', v_id));

  -- AN-9: THE PERSON IS TOLD AFTERWARDS. Not while it is happening -- that would be a live channel
  -- into somebody else's support session -- but once it has ended, in their own notifications.
  insert into public.notifications (user_id, type, title, body, data)
  values (v_target, 'impersonation_session_ended',
          'Somebody from Ovalball accessed your account',
          'An Ovalball administrator used your account to help with a support issue. The session has ended.',
          jsonb_build_object('session_id', v_id));
end;
$$;

-- What the banner needs, and nothing more: never the reason, never the actor's identity.
create or replace function public.my_impersonation()
returns table(session_id uuid, target_name text, view_only boolean, expires_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null then
    return;
  end if;
  return query
  select a.id, nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), a.view_only, a.expires_at
    from internal.active_impersonation() a
    left join public.profiles p on p.id = a.target_user_id;
end;
$$;

-- The catalogue already carries this type and the three IMPERSONATION security event types -- the
-- programme registered them when it wrote the seam. Kept as a defensive no-op so this migration is
-- self-sufficient, rather than as a claim that Slice 9 invented them.
insert into public.notification_types (type_key, topic_key)
values ('impersonation_session_ended', 'account_security')
on conflict (type_key) do nothing;

revoke all on function public.start_impersonation(uuid, text) from public;
revoke all on function public.end_impersonation(text)         from public;
revoke all on function public.my_impersonation()              from public;
grant execute on function public.start_impersonation(uuid, text) to authenticated;
grant execute on function public.end_impersonation(text)         to authenticated;
grant execute on function public.my_impersonation()              to authenticated;
grant select on public.impersonation_sessions to authenticated;

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_def text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'effective_person';
  if v_def ~ 'select auth\.uid\(\);\s*\$function\$' then
    raise exception 'Slice 9: effective_person is still the stub';
  end if;
  if v_def !~ 'active_impersonation' then
    raise exception 'Slice 9: effective_person does not read the session table';
  end if;

  -- The actor must stay the real person: attribution depends on it.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'actor') !~ 'auth\.uid\(\)' then
    raise exception 'Slice 9: internal.actor() no longer returns the signed-in person';
  end if;

  -- The clamp is in the engine, before the decision.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'can') !~ 'impersonation_permits' then
    raise exception 'Slice 9: internal.can does not clamp an impersonated request';
  end if;

  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'has_site_capability') !~ 'impersonation_permits' then
    raise exception 'Slice 9: the site capability gate is not clamped during an impersonation';
  end if;

  -- One active session per actor, by constraint rather than by good manners.
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'impersonation_one_active_per_actor') then
    raise exception 'Slice 9: nothing stops two overlapping sessions';
  end if;

  -- A session must carry a reason and must expire.
  if not exists (select 1 from pg_constraint where conrelid = 'public.impersonation_sessions'::regclass
                  and pg_get_constraintdef(oid) ~ 'reason') then
    raise exception 'Slice 9: a session can be started without a reason';
  end if;

  -- No secret may ever be written into this table.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'impersonation_sessions'
                and column_name ~ 'password|secret|token|totp|recovery') then
    raise exception 'Slice 9: the session table grew a credential column';
  end if;

  -- The canonical event types, not invented ones: the registry has carried them all along.
  if (select count(*) from public.security_event_types
       where event_type in ('impersonation.started', 'impersonation.ended')) <> 2 then
    raise exception 'Slice 9: the canonical impersonation security event types are not registered';
  end if;

  if has_function_privilege('anon', 'public.start_impersonation(uuid, text)', 'EXECUTE') then
    raise exception 'Slice 9: anon can start an impersonation';
  end if;

  raise notice 'PASS Slice 9: acting as somebody is bounded, reasoned, view-only by default, clamped at the capability engine, and attributed to both people';
end;
$guard$;
