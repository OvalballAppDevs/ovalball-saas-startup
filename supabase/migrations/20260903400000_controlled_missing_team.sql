-- Phase C: controlled automatic team creation from an incoming fixture
-- request. The request architecture has deliberately never fabricated a
-- team (see opponent-resolver.tsx's own "Never fabricates a team, and
-- never creates a clubs activation row" comment) -- that invariant is
-- preserved here too. What changes: a requester MAY now name a structured
-- target-team identity (age group + Boys/Girls + optional squad -- never
-- free text, never Mixed/Men's/Women's) when the opponent has no matching
-- team yet, and the RECIPIENT can then choose to create exactly that team
-- through one explicit, collision-checked action. Creating the team never
-- accepts the fixture -- the request stays 'sent' until a Club Admin
-- separately accepts or declines it, same as any other request.

alter table public.fixture_requests
  add column target_team_age_group text,
  add column target_team_gender text check (target_team_gender in ('boys', 'girls')),
  add column target_team_squad_designation text,
  add constraint fixture_requests_target_identity_pairing check (target_team_gender is null or target_team_age_group is not null);

comment on column public.fixture_requests.target_team_age_group is
  'Set only when the requester named a specific opponent team identity that did not resolve to a real teams.id at request time (target_team_id is null). Age-grade only (U6-U18) -- never used for a senior opponent.';

comment on column public.fixture_requests.target_team_gender is
  'boys or girls only -- deliberately excludes mixed/mens/womens. A structured missing-team identity is never allowed to describe an invalid team (mirrors the teams_gender_category_check boundary), so an invalid combination is rejected before it can ever reach team creation.';

-- ============================================================
-- internal.resolve_incoming_request_target: read-only. Given a pending
-- request that named a structured identity but has no real target_team_id
-- yet, decides what the recipient should be shown -- an existing active
-- team (reuse it, never duplicate), an existing folded team (offer
-- reactivation, never duplicate), a genuine ambiguity (squad unspecified
-- and more than one squad exists -- never guess), a pending rollover that
-- would already produce this exact team (route to Season Rollover, never
-- race it), a pending U11-Mixed structural Girls decision blocking this
-- exact identity (route to that decision, never bypass it), or genuinely
-- missing (safe to offer creation).
-- ============================================================

create or replace function internal.resolve_incoming_request_target(p_request_id uuid)
returns table(resolution text, existing_team_id uuid, message text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_club_id uuid;
  v_rugby_code text;
  v_active_match_id uuid;
  v_folded_match_id uuid;
  v_active_candidate_count integer;
  v_folded_candidate_count integer;
  v_pending_rollover_id uuid;
  v_pending_structural_id uuid;
  v_target_squad text;
begin
  select * into v_req from public.fixture_requests where id = p_request_id;
  if not found then
    return query select 'not_found', null::uuid, 'Fixture request not found.';
    return;
  end if;

  if v_req.target_team_id is not null then
    return query select 'has_target_team', v_req.target_team_id, 'This request already names a real team.';
    return;
  end if;

  if v_req.target_team_age_group is null then
    return query select 'no_structured_identity', null::uuid, 'No structured team identity was named on this request.';
    return;
  end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  v_target_club_id := v_group.opponent_club_id;
  if v_target_club_id is null then
    return query select 'no_target_club', null::uuid, 'This request has no activated opponent club to create a team on.';
    return;
  end if;

  select rugby_code into v_rugby_code from public.teams where id = v_req.requesting_team_id;

  -- A stored "A" always means the primary (unmarked) squad -- the same
  -- normalization the rest of the app applies -- so a request naming
  -- "A" must match the real, already-normalized primary team, never
  -- fall through to genuinely_missing because of a literal-string
  -- mismatch against a squad_designation that is really null.
  v_target_squad := nullif(upper(coalesce(v_req.target_team_squad_designation, '')), 'A');

  -- Squad EXPLICITLY named on the request: only an exact squad match
  -- counts (identity_key already makes at most one non-deleted row
  -- possible per club for that exact squad, so active/folded here are
  -- mutually exclusive).
  if v_req.target_team_squad_designation is not null then
    select id into v_active_match_id from public.teams
    where club_id = v_target_club_id and category = 'youth' and age_group = v_req.target_team_age_group
      and gender = v_req.target_team_gender and squad_designation is not distinct from v_target_squad and active
    limit 1;
    if v_active_match_id is not null then
      return query select 'exists_active', v_active_match_id, 'A matching team already exists.';
      return;
    end if;

    select id into v_folded_match_id from public.teams
    where club_id = v_target_club_id and category = 'youth' and age_group = v_req.target_team_age_group
      and gender = v_req.target_team_gender and squad_designation is not distinct from v_target_squad and not active
    limit 1;
    if v_folded_match_id is not null then
      return query select 'exists_folded', v_folded_match_id, 'A matching team exists but has folded.';
      return;
    end if;

  -- No squad named ("their U13 Boys team", not "their U13 Boys A team"):
  -- resolve against however many teams the club actually runs at this
  -- exact age/gender, REGARDLESS of what squad letter each of THOSE
  -- happens to carry -- exactly one is an unambiguous match, more than
  -- one is genuinely ambiguous (never guess), zero falls through to the
  -- folded check below.
  else
    select count(*), (array_agg(id))[1] into v_active_candidate_count, v_active_match_id from public.teams
    where club_id = v_target_club_id and category = 'youth' and age_group = v_req.target_team_age_group
      and gender = v_req.target_team_gender and active;
    if v_active_candidate_count > 1 then
      return query select 'ambiguous_squad', null::uuid, 'More than one squad already exists at this age group and classification -- the exact squad must be chosen manually.';
      return;
    elsif v_active_candidate_count = 1 then
      return query select 'exists_active', v_active_match_id, 'A matching team already exists.';
      return;
    end if;

    select count(*), (array_agg(id))[1] into v_folded_candidate_count, v_folded_match_id from public.teams
    where club_id = v_target_club_id and category = 'youth' and age_group = v_req.target_team_age_group
      and gender = v_req.target_team_gender and not active;
    if v_folded_candidate_count > 1 then
      return query select 'ambiguous_squad', null::uuid, 'More than one folded squad already exists at this age group and classification -- the exact squad must be chosen manually.';
      return;
    elsif v_folded_candidate_count = 1 then
      return query select 'exists_folded', v_folded_match_id, 'A matching team exists but has folded.';
      return;
    end if;
  end if;

  -- A pending (undecided) ordinary rollover proposal at this club would
  -- already produce a team at this exact age_group -- creating a second
  -- one here would race it into a duplicate the moment it's confirmed.
  select p.id into v_pending_rollover_id
  from public.age_grade_rollover_team_proposals p
  join public.age_grade_rollovers r on r.id = p.rollover_id
  where r.club_id = v_target_club_id and p.decision = 'pending' and not p.is_mixed_boundary
    and p.proposed_age_group = v_req.target_team_age_group
  limit 1;
  if v_pending_rollover_id is not null then
    return query select 'pending_rollover', null::uuid, 'A season rollover already proposes a team at this exact age group -- review Season Rollover instead of creating a new one here.';
    return;
  end if;

  -- A pending U11 Mixed -> U12 structural transition at this exact
  -- destination age group governs whether a Girls team should exist here
  -- -- the fixture-request path must never race or bypass that explicit
  -- Club Admin decision.
  if v_req.target_team_gender = 'girls' then
    select p.id into v_pending_structural_id
    from public.age_grade_rollover_team_proposals p
    join public.age_grade_rollovers r on r.id = p.rollover_id
    where r.club_id = v_target_club_id and p.decision = 'pending' and p.is_mixed_boundary
      and p.proposed_age_group = v_req.target_team_age_group
    limit 1;
    if v_pending_structural_id is not null then
      return query select 'pending_structural', null::uuid, 'A pending Season Rollover decision already governs whether a Girls team should exist at this age group -- review Season Rollover instead.';
      return;
    end if;
  end if;

  return query select 'genuinely_missing', null::uuid, 'No matching team exists yet -- safe to create.';
end;
$$;

grant execute on function internal.resolve_incoming_request_target(uuid) to authenticated;

create or replace function public.check_incoming_request_target(p_request_id uuid)
returns table(resolution text, existing_team_id uuid, message text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
begin
  select * into v_req from public.fixture_requests where id = p_request_id;
  if not found then raise exception 'Fixture request not found.'; end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  if not (internal.is_site_admin() or (v_group.opponent_club_id is not null and internal.can_manage_club_fixtures(v_group.opponent_club_id))) then
    raise exception 'Not authorized to review this fixture request.' using errcode = '42501';
  end if;
  return query select * from internal.resolve_incoming_request_target(p_request_id);
end;
$$;

revoke execute on function public.check_incoming_request_target(uuid) from public;
grant execute on function public.check_incoming_request_target(uuid) to authenticated;

-- ============================================================
-- public.create_missing_target_team: the ONE path that creates a team
-- from a fixture request. Re-runs the exact same resolution the UI used
-- to decide whether to show the button -- never trusts a stale client
-- read -- and refuses unless the outcome is still genuinely_missing.
-- Creating the team never changes fixture_requests.status: the request
-- stays 'sent', requiring a separate, deliberate Accept.
-- ============================================================

create or replace function public.create_missing_target_team(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_rugby_code text;
  v_resolution text;
  v_display_name text;
  v_slug text;
  v_gender_label text;
  v_new_team_id uuid;
  v_squad_designation text;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if not (internal.is_site_admin() or (v_group.opponent_club_id is not null and internal.can_manage_club_fixtures(v_group.opponent_club_id))) then
    raise exception 'Not authorized to create a team for this fixture request.' using errcode = '42501';
  end if;
  if v_req.status <> 'sent' then
    raise exception 'This request is no longer awaiting a response (status: %).', v_req.status;
  end if;

  select resolution into v_resolution from internal.resolve_incoming_request_target(p_request_id);
  if v_resolution <> 'genuinely_missing' then
    raise exception 'This team can no longer be created automatically (%). Review the matching state and act on it directly.', v_resolution using errcode = 'P0001';
  end if;

  select rugby_code into v_rugby_code from public.teams where id = v_req.requesting_team_id;
  -- A stored "A" always means the primary (unmarked) squad, same
  -- normalization the rest of the app applies -- this path must produce
  -- the identical closed-catalogue-valid identity a Club Admin creating
  -- the same team by hand would get, never a raw pass-through of
  -- whatever squad text the OTHER club's request happened to name.
  v_squad_designation := nullif(upper(coalesce(v_req.target_team_squad_designation, '')), 'A');
  -- Display-name philosophy: "Boys" is never spelled out (it is the
  -- unmarked default, same as the rest of the app's team naming) --
  -- "Girls" is the one identity-distinguishing case, and always comes
  -- first ("Girls U13", never "U13 Girls"). Squad designation, if any,
  -- comes last either way.
  v_gender_label := case when v_req.target_team_gender = 'girls' then 'Girls ' else '' end;
  v_display_name := v_gender_label || v_req.target_team_age_group ||
    case when v_squad_designation is null then '' else ' ' || v_squad_designation end;
  v_slug := trim(both '-' from regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g'));

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
  values (v_group.opponent_club_id, v_rugby_code, 'youth', v_req.target_team_age_group, v_req.target_team_gender, v_squad_designation, v_display_name, v_slug, auth.uid(), auth.uid())
  returning id into v_new_team_id;

  update public.fixture_requests set target_team_id = v_new_team_id where id = p_request_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_new_team_id, 'insert', auth.uid(),
    jsonb_build_object('display_name', v_display_name, 'age_group', v_req.target_team_age_group, 'gender', v_req.target_team_gender,
      'event', 'created_from_fixture_request', 'fixture_request_id', p_request_id));

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'team_created_from_fixture_request',
    format('%s was created', v_display_name),
    format('%s was created because a fixture request was received for this team. Review Team Settings.', v_display_name),
    jsonb_build_object('team_id', v_new_team_id, 'fixture_request_id', p_request_id)
  from public.club_memberships cm
  where cm.club_id = v_group.opponent_club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active';

  return v_new_team_id;
end;
$$;

revoke execute on function public.create_missing_target_team(uuid) from public;
grant execute on function public.create_missing_target_team(uuid) to authenticated;
