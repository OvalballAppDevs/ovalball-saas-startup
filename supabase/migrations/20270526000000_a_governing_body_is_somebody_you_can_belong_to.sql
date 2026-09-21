-- =====================================================================================================
-- CONVERGENCE STEP 14 -- GOVERNING BODY FOUNDATION
--
-- The archaeology found most of this already built: `public.constituent_bodies` holds 35 verified
-- rugby organisations -- county unions, armed-forces unions, schools, universities, referees -- each
-- with `rugby_code`, `nation`, `body_type` and a source URL checked on a date; and
-- `club_directory.constituent_body_id` already affiliates a club to one. Step 14 adds NO second
-- organisation table and NO second affiliation.
--
-- WHAT WAS GENUINELY MISSING is a person. Nothing anywhere linked somebody to a body, no capability
-- named the domain, and a body could not organise a competition.
--
-- WHY A NEW RELATIONSHIP TABLE RATHER THAN role_assignments: `role_assignments.club_id` and
-- `.membership_id` are both NOT NULL, so every role there hangs off a CLUB membership. A county
-- union's officer is deliberately not a member of a club, and loosening those columns to make room
-- would weaken the club model for every other role in the platform.
--
-- WHY NO NEW CAPABILITY SCOPE: a sixth scope means changing `internal.capability_decision`'s
-- signature -- the function every authority decision in the platform calls. Authority here resolves
-- through one dedicated function over the canonical relationship, the same shape
-- `internal.is_active_safeguarding_officer` already uses. Promoting a `body` scope into the engine
-- is recorded as hardening debt, not decided in a sprint.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------
-- 1. NO CAPABILITY ROWS, DELIBERATELY
--
-- `public.capabilities` is the ENGINE'S registry, not a glossary: every row carries `valid_scopes`,
-- `grant_level`, `revoke_level`, `delegable`, `aal` and an `impersonation_blocked` flag, and the
-- engine resolves against them. There is no `body` scope for a governing-body capability to be valid
-- in, so a row inserted here would have to claim a scope that is not true -- catalogue debt dressed
-- up as vocabulary.
--
-- So Step 14 registers nothing there. Authority is a named relationship, resolved by the three
-- functions below, in the same shape `internal.is_active_safeguarding_officer` already uses. The
-- capability vocabulary (governing.body.view / .manage, governing.competition.manage) enters the
-- catalogue when the `body` scope is designed into `capability_decision` -- recorded as hardening.
-- -----------------------------------------------------------------------------------------------

-- -----------------------------------------------------------------------------------------------
-- 2. THE ONE NEW RELATIONSHIP
-- -----------------------------------------------------------------------------------------------
create table if not exists public.constituent_body_roles (
  id                  uuid primary key default gen_random_uuid(),
  constituent_body_id uuid not null references public.constituent_bodies(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  role_key            text not null check (role_key in ('BODY_ADMIN', 'BODY_COMPETITIONS', 'BODY_VIEWER')),
  -- The same state vocabulary the canonical role machine uses, so suspension and revocation read the
  -- same way here as everywhere else and a reader never has to learn a second one.
  state               text not null default 'ACTIVE' check (state in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  granted_by          uuid references auth.users(id),
  granted_at          timestamptz not null default now(),
  revoked_by          uuid references auth.users(id),
  revoked_at          timestamptz,
  reason              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint body_role_revocation_shape check ((state = 'REVOKED') = (revoked_at is not null))
);

-- One open role per person per body: two would make "what is this person to this body" ambiguous.
create unique index if not exists constituent_body_roles_one_open
  on public.constituent_body_roles (constituent_body_id, user_id) where state <> 'REVOKED';

create index if not exists constituent_body_roles_user_idx on public.constituent_body_roles (user_id) where state = 'ACTIVE';

comment on table public.constituent_body_roles is
  'What a person is to a governing body. Deliberately NOT role_assignments, which is club-bound: a '
  'county union officer is not a member of a club. Authority comes from an ACTIVE row here and from '
  'nothing else -- never from a job title, an email domain, a club role or a competition entry.';

alter table public.constituent_body_roles enable row level security;

-- -----------------------------------------------------------------------------------------------
-- 3. WHO MAY DO WHAT
-- -----------------------------------------------------------------------------------------------
create or replace function internal.body_role(p_body_id uuid, p_user uuid default null)
returns text language sql stable security definer set search_path to 'public' as $$
  select r.role_key
    from public.constituent_body_roles r
   where r.constituent_body_id = p_body_id
     and r.user_id = coalesce(p_user, internal.effective_person())
     and r.state = 'ACTIVE'
   limit 1;
$$;

create or replace function internal.can_view_body(p_body_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- Any ACTIVE role can see the body's own page; Site Admins can see it because clubs and
  -- competitions are already theirs to administer. Nothing else can.
  select coalesce(internal.body_role(p_body_id) is not null
                  or internal.has_site_capability('site.clubs.view'), false);
$$;

-- COALESCE IS NOT DECORATION HERE.
--
-- `body_role()` returns NULL for somebody with no relationship, so `NULL = 'BODY_ADMIN'` is NULL --
-- and a caller written as `if not (can_manage_body(x) or has_site_capability(y))` evaluates
-- `not (NULL or false)` = NULL, does not enter the branch, and ALLOWS THE WRITE. That is the
-- three-valued-logic fail-open this programme has met before, and the suite caught it here: an
-- officer of one body could grant a role in another. These predicates answer true or false, never
-- null.
create or replace function internal.can_manage_body(p_body_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(internal.body_role(p_body_id) = 'BODY_ADMIN', false);
$$;

create or replace function internal.can_manage_body_competitions(p_body_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(internal.body_role(p_body_id) in ('BODY_ADMIN', 'BODY_COMPETITIONS'), false);
$$;

drop policy if exists constituent_body_roles_read on public.constituent_body_roles;
create policy constituent_body_roles_read on public.constituent_body_roles
  for select to authenticated using (
    internal.session_ok()
    and (user_id = auth.uid() or internal.can_view_body(constituent_body_id))
  );
-- No browser write path: roles are granted through the RPC below.

-- -----------------------------------------------------------------------------------------------
-- 4. A BODY MAY ORGANISE A COMPETITION -- through the architecture that already exists
--
-- `competitions` already carries `organiser_name` and `organiser_club_id`. This is one more kind of
-- organiser beside the club, not a second competition engine, and nothing is made to require a body.
-- -----------------------------------------------------------------------------------------------
alter table public.competitions
  add column if not exists organiser_constituent_body_id uuid references public.constituent_bodies(id) on delete set null;

create index if not exists competitions_organiser_body_idx
  on public.competitions (organiser_constituent_body_id) where organiser_constituent_body_id is not null;

comment on column public.competitions.organiser_constituent_body_id is
  'The governing body organising this competition, where one does. Nullable and additive: a club '
  'organiser and a named external organiser remain exactly as legitimate as they were.';

-- -----------------------------------------------------------------------------------------------
-- 5. THE READ MODEL THE PRODUCT NEEDS
-- -----------------------------------------------------------------------------------------------
create or replace function public.get_governing_body(p_body_id uuid)
returns table(
  body_id uuid, canonical_name text, short_name text, body_type text, rugby_code text, nation text,
  active boolean, source_url text, source_checked_on date,
  my_role text, can_manage boolean, can_manage_competitions boolean,
  affiliated_club_count int, competition_count int
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  select b.id, b.canonical_name, b.short_name, b.body_type, b.rugby_code, b.nation,
         b.active, b.source_url, b.source_checked_on,
         internal.body_role(b.id),
         internal.can_manage_body(b.id),
         internal.can_manage_body_competitions(b.id),
         (select count(*)::int from public.club_directory d where d.constituent_body_id = b.id),
         (select count(*)::int from public.competitions c where c.organiser_constituent_body_id = b.id)
    from public.constituent_bodies b
   where b.id = p_body_id;
end;
$$;

create or replace function public.my_governing_bodies()
returns table(body_id uuid, canonical_name text, short_name text, body_type text, my_role text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_actor uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    return;
  end if;
  return query
  select b.id, b.canonical_name, b.short_name, b.body_type, r.role_key
    from public.constituent_body_roles r
    join public.constituent_bodies b on b.id = r.constituent_body_id
   where r.user_id = internal.effective_person() and r.state = 'ACTIVE'
   order by b.canonical_name;
end;
$$;

create or replace function public.governing_body_clubs(p_body_id uuid)
returns table(directory_id uuid, name text, town text, county text, is_on_ovalball boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  return query
  select d.id, d.name, d.town, d.county, exists (select 1 from public.clubs c where c.directory_id = d.id)
    from public.club_directory d
   where d.constituent_body_id = p_body_id and d.active
   order by d.name;
end;
$$;

-- -----------------------------------------------------------------------------------------------
-- 6. GRANTING A ROLE
-- -----------------------------------------------------------------------------------------------
create or replace function public.set_governing_body_role(
  p_body_id uuid, p_user_id uuid, p_role_key text, p_reason text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- A body's own admin, or a Site Admin holding the explicit site capability. Nobody inherits this
  -- from a club role, a competition entry or the name of their employer.
  if not (internal.can_manage_body(p_body_id) or internal.has_site_capability('site.memberships.manage')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if p_role_key not in ('BODY_ADMIN', 'BODY_COMPETITIONS', 'BODY_VIEWER') then
    raise exception 'Unknown role.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.constituent_bodies b where b.id = p_body_id) then
    raise exception 'Governing body not found.' using errcode = 'P0002';
  end if;

  insert into public.constituent_body_roles (constituent_body_id, user_id, role_key, granted_by, reason)
  values (p_body_id, p_user_id, p_role_key, v_actor, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (constituent_body_id, user_id) where state <> 'REVOKED'
  do update set role_key = excluded.role_key, state = 'ACTIVE', updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.get_governing_body(uuid)                                  from public;
revoke all on function public.my_governing_bodies()                                     from public;
revoke all on function public.governing_body_clubs(uuid)                                from public;
revoke all on function public.set_governing_body_role(uuid, uuid, text, text)           from public;
grant execute on function public.get_governing_body(uuid)                               to authenticated;
grant execute on function public.my_governing_bodies()                                  to authenticated;
grant execute on function public.governing_body_clubs(uuid)                             to authenticated;
grant execute on function public.set_governing_body_role(uuid, uuid, text, text)        to authenticated;
grant select on public.constituent_body_roles to authenticated;

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_n int; v_bad text;
begin
  -- No second organisation model, and no second affiliation.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name ~ 'governing_bod|organisation|organization'
     and table_name <> 'constituent_bodies';
  if v_n > 0 then
    raise exception 'Step 14: a second organisation table appeared';
  end if;

  -- Authority comes from the relationship, never from a name, a code or a title.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal'
     and p.proname in ('can_view_body', 'can_manage_body', 'can_manage_body_competitions')
     and (p.prosrc ~* 'canonical_name|short_name|email|rugby_code\s*=|nation\s*=');
  if v_bad is not null then
    raise exception 'Step 14: body authority is being inferred from a label: %', v_bad;
  end if;

  -- A body relationship must confer nothing safeguarding-shaped.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.prosrc ~ 'constituent_body_roles'
     and p.prosrc ~* 'safeguard|date_of_birth|medical|guardian';
  if v_bad is not null then
    raise exception 'Step 14: a governing body relationship reaches safeguarding data: %', v_bad;
  end if;

  -- The competition link is additive: the existing organisers stay.
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'competitions' and column_name = 'organiser_club_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'competitions' and column_name = 'organiser_constituent_body_id') then
    raise exception 'Step 14: the competition organiser model is no longer additive';
  end if;

  -- The engine was not given a sixth scope by the back door.
  if (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'p_body' then
    raise exception 'Step 14: capability_decision grew a body scope -- that is a hardening decision, not a sprint one';
  end if;

  -- FAIL CLOSED, PROVEN RATHER THAN INTENDED: every predicate answers a definite boolean for
  -- somebody with no relationship at all.
  if internal.can_manage_body(gen_random_uuid()) is not false
     or internal.can_manage_body_competitions(gen_random_uuid()) is not false
     or internal.can_view_body(gen_random_uuid()) is null then
    raise exception 'Step 14: a governing body predicate can answer null, which reads as permission';
  end if;

  if has_function_privilege('anon', 'public.get_governing_body(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_governing_body_role(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception 'Step 14: anon can reach the governing body surface';
  end if;

  raise notice 'PASS Step 14: one organisation model, reused; authority from an ACTIVE relationship and nothing else; competitions additive';
end;
$guard$;
