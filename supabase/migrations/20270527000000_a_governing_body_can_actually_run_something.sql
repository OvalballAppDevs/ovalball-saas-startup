-- =====================================================================================================
-- CONVERGENCE STEP 15 -- GOVERNING BODY PRODUCT
--
-- Step 14 built the model and could not use it. A body could be RECORDED as organising a competition
-- and had no power over it; a body admin could grant a role and could not see who held one; a body
-- had no way to start the thing a county union mostly exists to run.
--
-- This step adds NO TABLE. It adds one disjunct to one authority predicate, two readers, and three
-- writes, all over the relationship Step 14 already established.
--
-- WHAT IT DELIBERATELY DOES NOT DO, with reasons recorded in
-- docs/product/CONVERGENCE_STEP_15_ARCHAEOLOGY.md:
--
--   * It does not touch `internal.capability_decision`. Every question here is answerable by the three
--     dedicated Step 14 predicates. A sixth capability scope remains hardening debt, not a sprint call.
--   * It does not touch the dispensation chain. That stage's `governing_body` approval is the CLUB
--     recording a certificate it holds off-platform -- `decide_player_dispensation` says so and the UI
--     says so -- and re-pointing it at a body officer would change what existing records MEAN.
--   * It reads no date of birth, no medical field, no guardian record and no case note. Affiliation is
--     not access to a child's file.
--   * It adds no invitation kind. `access_invitations.kind` is a closed constraint with no body shape,
--     and reaching around it with a token of our own is exactly the defect §12 forbids.
--   * It makes affiliation no more writable than it was. A nullable FK with no dates and no history
--     cannot be honestly presented as a membership lifecycle.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. A BODY THAT ORGANISES A COMPETITION CAN ORGANISE IT
--
-- THE ONE RED CHANGE IN THIS STEP, and the narrowest form it can take.
--
-- `internal.can_organise_competition` is the single chokepoint for every competition mutation:
--
--     10 RPCs -> internal.require_edition_organiser -> can_organise_edition -> THIS
--
-- No RLS policy references the chain. The two existing disjuncts are byte-for-byte unchanged, so a
-- Site Admin with `site.competitions.manage` and a club organiser keep exactly what they had. The new
-- disjunct can only ever match a competition whose `organiser_constituent_body_id` is a body at which
-- this person holds BODY_ADMIN or BODY_COMPETITIONS.
--
-- It grants NOTHING over any club's own fixtures. Organising a competition has never meant that, and
-- the competition-controlled fixture fields are still guarded by
-- `internal.guard_competition_controlled_fixture_fields`.
--
-- THREE-VALUED SAFETY (§27), because this predicate is a denial: `is_account_active` is
-- `p_user_id is not null and exists(...)`; `exists` is never null; `can_manage_body_competitions`
-- coalesces. The whole expression answers true or false for everybody, including a signed-out caller.
-- The guard at the bottom of this file proves it rather than asserting it.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.can_organise_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.competitions c
    where c.id = p_competition_id
      and (
        internal.has_site_capability('site.competitions.manage')
        or (c.organiser_club_id is not null
            and internal.can('competition.edition.manage', 'club', c.organiser_club_id, null, null))
        -- CONVERGENCE STEP 15: the governing body that organises it.
        or (c.organiser_constituent_body_id is not null
            and internal.can_manage_body_competitions(c.organiser_constituent_body_id))
      )
  );
$$;

comment on function internal.can_organise_competition(uuid) is
  'The one authority for organising a competition: a Site Admin holding site.competitions.manage, the '
  'organiser club''s fixture administration, or the governing body recorded as organising it. Every '
  'competition mutation reaches this through internal.require_edition_organiser. Organising a '
  'competition confers nothing over any club''s own fixtures.';

-- -----------------------------------------------------------------------------------------------------
-- 2. WHO HAS ACCESS TO THIS ORGANISATION
--
-- Step 14 could grant a role and had no way to show one, which makes access management guesswork.
--
-- WHAT THIS DOES NOT DO IS AS IMPORTANT: it is not a people search. It returns the people who already
-- hold a role at ONE body the caller can already see. `site_search_users` is deliberately not reused --
-- a body admin must not acquire a platform-wide directory of everybody on Ovalball.
--
-- The email address is returned only to somebody who can already manage access here, because that is
-- the only reason to need it: two people called Sarah Jones need telling apart before you revoke one.
-- A viewer sees names and roles.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.governing_body_people(p_body_id uuid)
returns table(
  user_id uuid, full_name text, email text, role_key text, state text,
  granted_at timestamptz, granted_by_name text, is_me boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_manage boolean;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  v_manage := internal.can_manage_body(p_body_id) or internal.has_site_capability('site.memberships.manage');

  return query
  select r.user_id,
         nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
         -- auth.users.email is `character varying`; the cast is what makes the declared `text` column
         -- honest rather than a runtime type mismatch on every call.
         case when v_manage then u.email::text else null end,
         r.role_key,
         r.state,
         r.granted_at,
         nullif(btrim(concat_ws(' ', g.first_name, g.surname)), ''),
         r.user_id = internal.effective_person()
    from public.constituent_body_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = r.user_id
    left join public.profiles g on g.id = r.granted_by
   where r.constituent_body_id = p_body_id
     -- A revoked role is history, not access. It is not shown as somebody who has access.
     and r.state <> 'REVOKED'
   order by (r.role_key = 'BODY_ADMIN') desc, 2 nulls last;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 3. GIVING ACCESS TO SOMEBODY WHO IS ALREADY ON OVALBALL
--
-- The email is resolved INSIDE this function on purpose: there is then no lookup surface at all, and
-- the caller never receives a user id they did not already have. You must know the address already;
-- you cannot go fishing for one.
--
-- WHERE NO ACCOUNT EXISTS this returns NO_ACCOUNT rather than raising, because "this person is not on
-- Ovalball yet" is an ordinary product answer and not an error. Inviting somebody who has no account
-- needs the CANONICAL invitation system, whose `kind` constraint has no body shape yet -- that is
-- Step 16's, and bolting a private token onto this function instead is the defect §12 names.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.grant_governing_body_role_by_email(
  p_body_id uuid, p_email text, p_role_key text, p_reason text default null)
returns table(outcome text, user_id uuid)
language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_user uuid; v_email text;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.can_manage_body(p_body_id) or internal.has_site_capability('site.memberships.manage')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if p_role_key not in ('BODY_ADMIN', 'BODY_COMPETITIONS', 'BODY_VIEWER') then
    raise exception 'Unknown role.' using errcode = 'P0002';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or v_email not like '%@%' then
    raise exception 'Enter the email address of the person''s Ovalball account.';
  end if;

  select u.id into v_user from auth.users u where lower(btrim(u.email)) = v_email limit 1;
  if v_user is null then
    return query select 'NO_ACCOUNT'::text, null::uuid;
    return;
  end if;

  -- The canonical grant, reused rather than reimplemented: one place decides what a grant means.
  perform public.set_governing_body_role(p_body_id, v_user, p_role_key, p_reason);
  return query select 'GRANTED'::text, v_user;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 4. TAKING ACCESS AWAY
--
-- Revocation is a state change and a record, never a delete: who removed whom from a governing body,
-- and when, is exactly the kind of fact somebody later needs.
--
-- A body admin cannot revoke themselves. Not paternalism -- a body whose last admin removed their own
-- access has nobody who can restore it, and the only route back would be a Site Admin repair.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.revoke_governing_body_role(
  p_body_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid; v_n int;
begin
  v_actor := internal.actor();
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.can_manage_body(p_body_id) or internal.has_site_capability('site.memberships.manage')) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if p_user_id = internal.effective_person() then
    raise exception 'You cannot remove your own access to this organisation. Ask another administrator here to do it.'
      using errcode = '42501';
  end if;

  update public.constituent_body_roles
     set state = 'REVOKED', revoked_by = v_actor, revoked_at = now(),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason),
         updated_at = now()
   where constituent_body_id = p_body_id and user_id = p_user_id and state <> 'REVOKED';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That person does not currently have access to this organisation.' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 5. WHAT THIS ORGANISATION RUNS
--
-- The count Step 14 returned cannot be acted on. This returns the competitions themselves, each with
-- its CURRENT edition so the workspace can hand straight over to the existing Competition Creator
-- rather than growing a second one.
--
-- `can_organise` is per row and comes from the same predicate the mutations use, so a BODY_VIEWER is
-- told the truth about every competition rather than shown a control that will refuse them.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.governing_body_competitions(p_body_id uuid)
returns table(
  competition_id uuid, name text, slug text, rugby_code text, format text, active boolean,
  edition_id uuid, season_id uuid, season_name text,
  entered_count int, match_count int, result_count int, can_organise boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;

  return query
  with latest as (
    -- The edition a person means when they say "this season's cup": the active one in the latest
    -- season the canonical register knows about, never a date computed here.
    select e.competition_id, e.id as edition_id, e.season_id,
           row_number() over (partition by e.competition_id order by s.starts_on desc nulls last, e.created_at desc) as rn
      from public.competition_editions e
      join public.seasons s on s.id = e.season_id
     where e.active
  )
  select c.id, c.name, c.slug, c.rugby_code, c.format, c.active,
         l.edition_id, l.season_id, s.name,
         coalesce((select count(*)::int from public.competition_participants cp
                    where cp.edition_id = l.edition_id and cp.status = 'entered'), 0),
         coalesce((select count(*)::int from public.competition_matches cm
                    where cm.edition_id = l.edition_id), 0),
         coalesce((select count(*)::int from public.competition_matches cm
                    where cm.edition_id = l.edition_id and cm.home_score is not null), 0),
         internal.can_organise_competition(c.id)
    from public.competitions c
    left join latest l on l.competition_id = c.id and l.rn = 1
    left join public.seasons s on s.id = l.season_id
   where c.organiser_constituent_body_id = p_body_id
   order by c.active desc, c.name;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 6. STARTING A COMPETITION AS A GOVERNING BODY
--
-- Modelled on `public.create_club_competition`, deliberately line for line: the same season resolution
-- from the CANONICAL register, the same competition + edition in one call, the same NEEDS_ATTENTION
-- answer when no season is registered rather than a computed fallback date, and the same rugby-code
-- isolation -- a Rugby Union body cannot organise a Rugby League competition.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.create_governing_body_competition(
  p_name text, p_body_id uuid, p_season_id uuid default null)
returns table(competition_id uuid, edition_id uuid, season_id uuid, season_name text, needs_attention text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_code text; v_competition uuid; v_season uuid; v_edition uuid; v_slug text; v_normalized text;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_manage_body_competitions(p_body_id) then
    raise exception 'Only this organisation''s administrator or competitions officer may create a competition for it.'
      using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A competition name is required.';
  end if;

  -- THE BODY'S OWN CODE, never a choice. Union and League are strictly isolated, and a body organises
  -- in the code it belongs to.
  select b.rugby_code into v_code from public.constituent_bodies b where b.id = p_body_id;
  if v_code is null then
    raise exception 'Governing body not found.' using errcode = 'P0002';
  end if;

  v_season := internal.competition_season_for(v_code, p_season_id);

  v_normalized := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || v_code;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || v_code;
  begin
    insert into public.competitions
      (name, slug, normalized_key, rugby_code, is_national, active, organiser_constituent_body_id, created_by, updated_by)
    values (btrim(p_name), v_slug, v_normalized, v_code, false, true, p_body_id, internal.actor(), internal.actor())
    returning id into v_competition;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', initcap(v_code), btrim(p_name) using errcode = 'P0001';
  end;

  -- NO SEASON IS A NEEDS_ATTENTION, NOT A GUESS. The canonical register is the only answer to which
  -- season this is, and a competition with no edition is a legible state.
  if v_season is null then
    return query select v_competition, null::uuid, null::uuid, null::text,
      format('No current or upcoming %s season is registered, so this competition has no season yet.', initcap(v_code));
    return;
  end if;

  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_competition, v_season, v_code, true, internal.actor(), internal.actor())
  returning id into v_edition;

  return query select v_competition, v_edition, v_season,
                      (select s.name from public.seasons s where s.id = v_season), null::text;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 6b. THE AFFILIATED CLUBS, USEFULLY
--
-- Step 14's reader answered "which clubs" and nothing a person could act on. A county officer looking
-- at their club list wants to reach the club, and Ovalball already has the right destination: the
-- club's own PUBLIC home at /club/{slug}. So the slug is returned, along with the reference facts the
-- directory already holds.
--
-- ADDITIVE ONLY, AND STILL NOT CLUB ADMINISTRATION. Ground, website, town and county are the directory's
-- own public identity fields -- the same ones the public Club Directory prints. Affiliation is not
-- authority over a club's people, players, fixtures or settings, and this returns none of them.
-- -----------------------------------------------------------------------------------------------------
-- The return type gains columns, so the old signature is dropped first. Same name, same argument, same
-- meaning -- there is still exactly one answer to "which clubs are affiliated to this body".
drop function if exists public.governing_body_clubs(uuid);
create or replace function public.governing_body_clubs(p_body_id uuid)
returns table(
  directory_id uuid, name text, town text, county text, is_on_ovalball boolean,
  club_slug text, home_ground text, website text, rugby_code text
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_view_body(p_body_id) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  return query
  select d.id, d.name, d.town, d.county,
         exists (select 1 from public.clubs c where c.directory_id = d.id),
         (select c.slug from public.clubs c where c.directory_id = d.id limit 1),
         d.home_ground, d.website, d.rugby_code
    from public.club_directory d
   where d.constituent_body_id = p_body_id and d.active
   order by d.name;
end;
$$;

revoke all on function public.governing_body_clubs(uuid) from public;
grant execute on function public.governing_body_clubs(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 7. GRANTS
-- -----------------------------------------------------------------------------------------------------
revoke all on function public.governing_body_people(uuid)                                     from public;
revoke all on function public.governing_body_competitions(uuid)                               from public;
revoke all on function public.grant_governing_body_role_by_email(uuid, text, text, text)      from public;
revoke all on function public.revoke_governing_body_role(uuid, uuid, text)                    from public;
revoke all on function public.create_governing_body_competition(text, uuid, uuid)             from public;

grant execute on function public.governing_body_people(uuid)                                  to authenticated;
grant execute on function public.governing_body_competitions(uuid)                            to authenticated;
grant execute on function public.grant_governing_body_role_by_email(uuid, text, text, text)   to authenticated;
grant execute on function public.revoke_governing_body_role(uuid, uuid, text)                 to authenticated;
grant execute on function public.create_governing_body_competition(text, uuid, uuid)          to authenticated;

comment on function public.governing_body_people(uuid) is
  'Who holds access to ONE governing body the caller can already see. Not a people search: it returns '
  'only existing role holders, and the email address only to somebody who can already manage access.';
comment on function public.governing_body_competitions(uuid) is
  'The competitions a governing body organises, each with its current edition from the canonical season '
  'register, so the workspace hands over to the existing Competition Creator instead of growing one.';
comment on function public.create_governing_body_competition(text, uuid, uuid) is
  'Creates a competition organised by a governing body, in the body''s own rugby code, with its edition '
  'in the canonical current season. Mirrors public.create_club_competition exactly.';

-- =====================================================================================================
-- THE MIGRATION CHECKS ITSELF
-- =====================================================================================================
do $guard$
declare v_def text; v_bad text; v_n int;
begin
  -- ---------------------------------------------------------------------------------------------
  -- THE EXISTING ORGANISERS SURVIVED. The point of the change is that it is ADDITIVE.
  -- ---------------------------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'can_organise_competition';
  if v_def !~ 'site\.competitions\.manage' then
    raise exception 'Step 15: the Site Admin competition organiser was removed';
  end if;
  if v_def !~ 'organiser_club_id' or v_def !~ 'competition\.edition\.manage' then
    raise exception 'Step 15: the club competition organiser was removed';
  end if;
  if v_def !~ 'can_manage_body_competitions' then
    raise exception 'Step 15: the governing body organiser was not added';
  end if;
  -- The body disjunct must be gated on the column, so a null organiser can never match.
  if v_def !~ 'organiser_constituent_body_id is not null' then
    raise exception 'Step 15: the body organiser disjunct is not gated on the organiser column';
  end if;

  -- The chokepoint is still the chokepoint: every competition mutation must still arrive here.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'require_edition_organiser';
  if v_n < 10 then
    raise exception 'Step 15: only % competition RPCs still route through require_edition_organiser', v_n;
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- FAIL CLOSED, PROVEN. Every Step 15 authority predicate answers a DEFINITE boolean for somebody
  -- with no relationship and no session -- the three-valued fail-open this programme keeps meeting.
  -- ---------------------------------------------------------------------------------------------
  if internal.can_organise_competition(gen_random_uuid()) is null then
    raise exception 'Step 15: can_organise_competition answers null -- `if not (...)` would allow the write';
  end if;
  if internal.can_organise_competition(gen_random_uuid()) then
    raise exception 'Step 15: can_organise_competition allows a competition that does not exist';
  end if;
  if (select internal.can_manage_body_competitions(b.id) from public.constituent_bodies b limit 1) is not false then
    raise exception 'Step 15: can_manage_body_competitions does not refuse a caller with no relationship';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- NO SECOND ENGINE, NO SECOND HIERARCHY, NO SECOND CMS.
  -- ---------------------------------------------------------------------------------------------
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public'
     and (table_name ~ 'governing_bod|organisation|organization'
          or table_name ~ '^body_'
          or table_name ~ 'competition.*(v2|_body)|body.*competition')
     and table_name <> 'constituent_bodies';
  if v_n > 0 then
    raise exception 'Step 15: a second organisation or competition model appeared';
  end if;

  -- The engine still has five scopes. A body scope is a hardening decision.
  if (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'capability_decision') ~ 'p_body' then
    raise exception 'Step 15: capability_decision grew a body scope';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- THE DISPENSATION CHAIN IS UNTOUCHED. Its governing-body stage is the CLUB recording an
  -- off-platform certificate, and Step 15 must not quietly change what an existing record means.
  -- ---------------------------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'decide_player_dispensation';
  if v_def ~ 'constituent_body|can_manage_body' then
    raise exception 'Step 15: the dispensation governing-body stage was re-pointed at a body officer';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- A BODY RELATIONSHIP REACHES NO PROTECTED PERSON DATA.
  -- ---------------------------------------------------------------------------------------------
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname ~ 'governing_body|_body_role|can_manage_body|can_view_body'
     and p.prosrc ~* 'date_of_birth|medical|safeguard|guardians|player_team_dispensation';
  if v_bad is not null then
    raise exception 'Step 15: a governing body function reaches protected person data: %', v_bad;
  end if;

  -- Affiliation stayed a read. Nothing here writes which body a club belongs to.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname ~ '^(governing_body|create_governing|grant_governing|revoke_governing)'
     and p.prosrc ~* 'update\s+public\.club_directory|insert\s+into\s+public\.club_directory';
  if v_bad is not null then
    raise exception 'Step 15: a Step 15 function writes club affiliation, which has no lifecycle yet: %', v_bad;
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- ANON REACHES NONE OF IT.
  -- ---------------------------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.governing_body_people(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.governing_body_competitions(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_governing_body_competition(text, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_governing_body_role(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.grant_governing_body_role_by_email(uuid, text, text, text)', 'EXECUTE') then
    raise exception 'Step 15: anon can reach a governing body function';
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- SEASONS COME FROM THE REGISTER. No month cutoff, no extract(year), no second answer.
  -- ---------------------------------------------------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_governing_body_competition';
  if v_def !~ 'competition_season_for' then
    raise exception 'Step 15: competition creation does not resolve its season from the canonical register';
  end if;
  if v_def ~* 'extract\s*\(\s*year|interval\s+''1 year''|''08-01''|''09-01''' then
    raise exception 'Step 15: competition creation computes a season instead of reading the register';
  end if;
end;
$guard$;
