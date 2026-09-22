-- TEAM FIXTURE OPERATIONS -- THE TWO ANSWERS A TEAM NEEDS, FROM THE AUTHORITIES THAT ALREADY EXIST.
--
-- The correction this migration serves has two halves the product could not previously answer, and in
-- both cases the authority already existed and only the READER was missing. Nothing here invents a
-- rule; each function delegates to the one that already decides.
--
-- ONE. "WHICH OF THEIR TEAMS COULD WE ACTUALLY PLAY?"
--
-- internal.teams_can_play_fixture is the canonical compatibility rule and it is enforced on
-- public.fixtures, inside accept_fixture_request, and now on fixture_requests. But it takes two team
-- IDs, so it can only ever answer "is THIS pairing legal" -- and the request flow needs the other
-- question: "which pairings ARE legal", before anybody has chosen one. Without it the flow let a
-- requester name any youth age grade from the full list, so an under-12 side could address a request
-- to an under-16 identity and discover it was never legal only when it was refused.
--
-- Rather than write a second rule that answers the second question, the rule is lifted one level: it
-- has always been a judgement about two IDENTITIES -- code, category, age grade, gender -- that
-- happened to be read from two rows. internal.identities_can_play_fixture is that judgement, and
-- teams_can_play_fixture becomes the lookup in front of it. Same answer, same regulation, one
-- implementation, and the guard below fails if teams_can_play_fixture ever stops delegating.
--
-- No new regulation is introduced. Girls youth sides remain matched to girls youth sides across age
-- grades, everything else youth is matched on an exact internal.age_fixture_band, senior sides on
-- gender, and a team whose code is unknown is not judged -- exactly as before.
--
-- TWO. "MAY THIS PERSON RUN FIXTURES FOR THIS TEAM?"
--
-- set_capability_override has always accepted p_scope_type = 'team', and internal.capability_decision
-- has always resolved a team-scoped decision. The club's permissions screen could not ASK the question
-- though: club_member_capabilities answers only at club scope, so the only decision a Club Admin could
-- record was club-wide. A Club Admin who wanted to let one coach run Under 12 Boys' fixtures had to
-- give them the same authority over every team at the club.
--
-- club_team_capabilities is the team-scope twin, with the same authority check, the same decision
-- function and the same editability rule. It differs in two deliberate ways: it answers for the people
-- who actually hold a role on that team, because a team decision about somebody with no relationship
-- to the team is not a decision anybody needs to make; and it offers only capabilities that are valid
-- at team scope, which is what keeps Planner, import, bulk edit and delete out of a team grant -- they
-- are club-level capabilities and cannot be named here at all.

begin;

-- -----------------------------------------------------------------------------------------------------
-- 1. THE COMPATIBILITY RULE, AT THE LEVEL IT WAS ALWAYS ABOUT.
-- -----------------------------------------------------------------------------------------------------

create or replace function internal.identities_can_play_fixture(
  p_a_code text, p_a_category text, p_a_age_group text, p_a_gender text,
  p_b_code text, p_b_category text, p_b_age_group text, p_b_gender text
) returns boolean language plpgsql immutable as $$
begin
  -- An identity Ovalball does not know the code of is not judged. This is the pre-existing behaviour
  -- for a team row with a null rugby_code, kept: refusing here would block legitimate fixtures against
  -- records that predate the canonical directory.
  if p_a_code is null or p_b_code is null then
    return true;
  end if;
  if p_a_code <> p_b_code or p_a_category <> p_b_category then
    return false;
  end if;
  if p_a_category <> 'youth' then
    return p_a_gender is null or p_b_gender is null or p_a_gender = p_b_gender;
  end if;
  if p_a_gender = 'girls' and p_b_gender = 'girls' then
    return true;
  end if;
  return internal.age_fixture_band(p_a_age_group) is not null
     and internal.age_fixture_band(p_a_age_group) = internal.age_fixture_band(p_b_age_group);
end $$;

comment on function internal.identities_can_play_fixture(text, text, text, text, text, text, text, text) is
  'The one fixture compatibility rule, stated about two canonical team identities. '
  'internal.teams_can_play_fixture is the lookup in front of it; the opponent readers ask it directly '
  'so that "which opponents are legal" and "is this opponent legal" can never answer differently.';

create or replace function internal.teams_can_play_fixture(p_team_a uuid, p_team_b uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  a record;
  b record;
begin
  select rugby_code, category, age_group, gender into a from public.teams where id = p_team_a;
  select rugby_code, category, age_group, gender into b from public.teams where id = p_team_b;
  return internal.identities_can_play_fixture(
    a.rugby_code, a.category, a.age_group, a.gender,
    b.rugby_code, b.category, b.age_group, b.gender);
end $$;

comment on function internal.teams_can_play_fixture(uuid, uuid) is
  'Whether two Ovalball teams may legally play each other. Reads both canonical identities and defers '
  'the whole judgement to internal.identities_can_play_fixture -- it holds no rule of its own.';

-- -----------------------------------------------------------------------------------------------------
-- 2. WHICH OF THEIR TEAMS -- the real ones.
-- -----------------------------------------------------------------------------------------------------

create or replace function public.compatible_opponent_teams(p_team_id uuid, p_opponent_club_id uuid)
returns table(team_id uuid, display_name text, age_group text, gender text)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    return;
  end if;
  -- SECURITY DEFINER reads another club's teams, so the authority to ask is checked first and it is the
  -- authority the ACTION needs: somebody who may request or arrange a fixture for this team. This is
  -- not a general team-enumeration reader, and it answers about one named club at a time.
  if not (internal.can('fixture.request.create', 'team', v_club, p_team_id, null)
       or internal.can('fixture.fixture.create', 'team', v_club, p_team_id, null)) then
    raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
  end if;

  return query
  select o.id, o.display_name, o.age_group, o.gender
  from public.teams o
  join public.teams me on me.id = p_team_id
  where o.club_id = p_opponent_club_id
    and o.id <> p_team_id
    -- A folded or archived side is not somebody you can arrange a fixture with.
    and coalesce(o.active, true) and o.folded_at is null and o.archived_at is null
    and internal.identities_can_play_fixture(
      me.rugby_code, me.category, me.age_group, me.gender,
      o.rugby_code, o.category, o.age_group, o.gender)
  order by o.display_name;
end $$;

comment on function public.compatible_opponent_teams(uuid, uuid) is
  'The opponent club''s teams that this team may legally play, by the one canonical compatibility rule. '
  'Requires fixture request or create authority at TEAM scope for the asking team.';

-- -----------------------------------------------------------------------------------------------------
-- 3. WHICH OF THEIR TEAMS -- the ones they have not created yet.
-- -----------------------------------------------------------------------------------------------------
-- A request may legitimately name an identity a club does not run yet, so that they can create it when
-- they answer. That path offered every youth age grade in the product. These are the identities that
-- would be legal, from the canonical catalogue, filtered by the same rule -- so the offer and the
-- enforcement cannot disagree.

create or replace function public.compatible_opponent_identities(p_team_id uuid)
returns table(age_group text, gender text, label text)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    return;
  end if;
  if not (internal.can('fixture.request.create', 'team', v_club, p_team_id, null)
       or internal.can('fixture.fixture.create', 'team', v_club, p_team_id, null)) then
    raise exception 'You do not have permission to arrange fixtures for this team.' using errcode = '42501';
  end if;

  return query
  select c.age_group, c.gender, c.label
  from public.teams me
  join public.canonical_team_types_by_code c
    on c.rugby_code = me.rugby_code and c.is_offered and c.is_active
  where me.id = p_team_id
    and internal.identities_can_play_fixture(
      me.rugby_code, me.category, me.age_group, me.gender,
      c.rugby_code, c.category, c.age_group, c.gender)
  order by c.sort_order;
end $$;

comment on function public.compatible_opponent_identities(uuid) is
  'The canonical team identities this team may legally be matched against, for a request addressed to a '
  'club that does not run the team yet. Scoped to the asking team''s own rugby code -- union and league '
  'catalogues are never mixed -- and filtered by internal.identities_can_play_fixture.';

-- -----------------------------------------------------------------------------------------------------
-- 4. THE PERMISSIONS SCREEN'S TEAM-SCOPE QUESTION.
-- -----------------------------------------------------------------------------------------------------

create or replace function public.club_team_capabilities(
  p_club_id uuid, p_team_id uuid, p_capability_keys text[] default null
) returns table(user_id uuid, capability_key text, effective boolean, source text,
                override_id uuid, decisive_rule text, reason_code text, override_level text, editable boolean)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_site_view boolean := internal.has_site_capability('site.users.view');
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    raise exception 'That team does not belong to this club.' using errcode = '22023';
  end if;
  if not (v_site_view or internal.can('people.capability.manage', 'club', p_club_id, null, null)) then
    raise exception 'You do not have permission to view this club''s capabilities.' using errcode = '42501';
  end if;

  return query
  with keys as (
    -- 'team' = any(valid_scopes) is what keeps a team grant small: fixture.fixture.delete,
    -- .bulk_edit, fixture.import.run and fixture.planner.use are club-scope capabilities and cannot
    -- appear in this list, so a team grant cannot reach the Planner, an import or a bulk edit.
    select c.key,
           internal.override_authority_level(c.key, 'team', p_club_id, p_team_id, 'CLUB') as club_level,
           internal.override_authority_level(c.key, 'team', p_club_id, p_team_id, 'SITE') as site_level
    from public.capabilities c
    where c.status = 'ACTIVE' and 'team' = any (c.valid_scopes) and c.delegable and c.grant_level in ('C', 'T')
      and not c.safeguarding_sensitive
      and (p_capability_keys is null or c.key = any (
        select coalesce((select m.capability_key from public.capability_key_map m
                          where m.legacy_key = k and m.legacy_scope = 'team'), k)
        from unnest(p_capability_keys) k))
  ),
  -- THE PEOPLE THIS DECISION IS ABOUT. A team-scoped decision about somebody with no role on the team
  -- adjusts nothing, so the screen does not offer it; set_capability_override would still require an
  -- active club membership, which these people have by definition.
  staff as (
    select distinct ra.user_id
    from public.role_assignments ra
    join public.club_memberships cm on cm.user_id = ra.user_id and cm.club_id = p_club_id and cm.state = 'ACTIVE'
    where ra.team_id = p_team_id and ra.state = 'ACTIVE'
  )
  select s.user_id, k.key, d.allowed,
    case d.reason_code
      when 'ROLE_BUNDLE' then 'role'
      when 'EXPLICIT_ALLOW' then 'granted'
      when 'EXPLICIT_DENY' then case when d.decisive_source ->> 'level' = 'SITE' then 'restricted' else 'denied' end
      else 'none' end,
    o.id, d.decisive_rule, d.reason_code, o.granted_level,
    (s.user_id <> internal.actor()
      and case when o.granted_level = 'SITE' then k.site_level is not null
               else coalesce(k.club_level, k.site_level) is not null end)
  from staff s
  cross join keys k
  cross join lateral internal.capability_decision(s.user_id, k.key, 'team', p_club_id, p_team_id, null, false, false) d
  left join public.capability_overrides o
    on o.user_id = s.user_id and o.capability_key = k.key and o.scope_type = 'team'
   and o.club_id = p_club_id and o.team_id = p_team_id and o.status = 'active';
end $$;

comment on function public.club_team_capabilities(uuid, uuid, text[]) is
  'What each member of this team''s staff may do FOR THIS TEAM, from internal.capability_decision at '
  'team scope. The team-scope twin of club_member_capabilities, so the club permissions screen can ask '
  'the question set_capability_override has always been able to answer.';

grant execute on function public.compatible_opponent_teams(uuid, uuid) to authenticated;
grant execute on function public.compatible_opponent_identities(uuid) to authenticated;
grant execute on function public.club_team_capabilities(uuid, uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- SELF-CHECK.
-- -----------------------------------------------------------------------------------------------------
do $guard$
declare
  v_def text;
  v_n int;
begin
  -- ONE RULE. teams_can_play_fixture must delegate, and must not carry the regulation itself.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'internal' and p.proname = 'teams_can_play_fixture';
  v_def := regexp_replace(v_def, '--[^\n]*', '', 'g');
  if v_def !~ 'identities_can_play_fixture' then
    raise exception 'teams_can_play_fixture no longer delegates to the one compatibility rule';
  end if;
  if v_def ~ 'age_fixture_band\(' or v_def ~ '''girls''' then
    raise exception 'teams_can_play_fixture restates the compatibility rule instead of delegating it';
  end if;

  -- The readers must ask the same rule rather than filter on their own.
  for v_def in
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('compatible_opponent_teams', 'compatible_opponent_identities')
  loop
    if v_def !~ 'identities_can_play_fixture' then
      raise exception 'an opponent reader does not use the canonical compatibility rule';
    end if;
    if v_def ~ 'age_group\s*=\s*''' or v_def ~ 'ilike' then
      raise exception 'an opponent reader matches age grades itself instead of delegating';
    end if;
  end loop;

  -- A TEAM GRANT STAYS SMALL. The club-wide fixture powers must not be nameable at team scope -- which
  -- is a property of the capability catalogue, not of the reader, so it is asserted against the source.
  select count(*) into v_n from public.capabilities
   where key in ('fixture.planner.use', 'fixture.import.run', 'fixture.fixture.bulk_edit', 'fixture.fixture.delete')
     and 'team' = any (valid_scopes);
  if v_n > 0 then
    raise exception 'a club-wide fixture power became grantable at team scope (% of them)', v_n;
  end if;

  -- And the capabilities the team screen exists to hand out are still team-scoped and delegable.
  select count(*) into v_n from public.capabilities
   where key in ('fixture.fixture.create', 'fixture.fixture.edit', 'fixture.fixture.cancel', 'fixture.request.create')
     and 'team' = any (valid_scopes) and delegable and grant_level in ('C', 'T');
  if v_n <> 4 then
    raise exception 'the team fixture capabilities are not all delegable at team scope (% of 4)', v_n;
  end if;

  raise notice 'Team fixture operations: one compatibility rule with two readers, and a team-scope permissions reader.';
end $guard$;

commit;
