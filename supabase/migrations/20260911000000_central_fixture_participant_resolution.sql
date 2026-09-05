-- Central Fixture Participant Resolution (superseding reconciliation
-- instruction, 2026-09-02). The backend pieces already existed
-- (20260903400000_controlled_missing_team.sql's internal.resolve_incoming_
-- request_target / public.create_missing_target_team,
-- 20260902140000_team_lifecycle.sql's public.reactivate_team) but were
-- wired into ZERO UI surfaces, split team-creation from fixture-acceptance
-- into two separate round-trips (not atomic), had no reactivation path at
-- all, and authorized team creation via ordinary fixture authority
-- (can_manage_club_fixtures, which includes Fixtures Secretary) rather than
-- the club-STRUCTURAL authority the new instruction explicitly requires
-- (Club Admin only). This migration fixes all four, without touching the
-- read-only resolution logic itself, which was already correct.

-- ============================================================
-- 1. create_missing_target_team: narrow authorization from ordinary
--    fixture authority to club-structural authority. Creating a team is
--    the same authority class as public.teams' own teams_insert_admin RLS
--    policy (internal.is_site_admin() or internal.is_club_admin(club_id))
--    -- a Fixtures Secretary can see and act on ordinary fixture requests
--    via can_manage_club_fixtures, but must not be able to unilaterally
--    change club structure. Body otherwise unchanged from 20260903400000.
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

  if not (internal.is_site_admin() or (v_group.opponent_club_id is not null and internal.is_club_admin(v_group.opponent_club_id))) then
    raise exception 'Creating a team is a club-structural action -- Club Admin approval is required to activate this team.' using errcode = '42501';
  end if;
  if v_req.status <> 'sent' then
    raise exception 'This request is no longer awaiting a response (status: %).', v_req.status;
  end if;

  select resolution into v_resolution from internal.resolve_incoming_request_target(p_request_id);
  if v_resolution <> 'genuinely_missing' then
    raise exception 'This team can no longer be created automatically (%). Review the matching state and act on it directly.', v_resolution using errcode = 'P0001';
  end if;

  select rugby_code into v_rugby_code from public.teams where id = v_req.requesting_team_id;
  -- coalesce(...,'') then nullif(...,'A') does NOT normalize a genuinely
  -- NULL squad to NULL -- nullif('','A') returns '' unchanged (since
  -- ''<>'A'), which then violates teams_active_squad_designation_valid
  -- (only null/B/C are valid for an active youth team). Defaulting the
  -- coalesce fallback to 'A' itself, so a null input takes the exact same
  -- path as an explicit 'A' input, fixes this -- found live (never
  -- exercised by the pre-existing regression tests, which only ever
  -- passed 'A' or 'B'/'C' explicitly, never a genuinely null squad).
  v_squad_designation := nullif(upper(coalesce(v_req.target_team_squad_designation, 'A')), 'A');
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
      'event', 'TEAM_CREATED_FROM_FIXTURE_REQUEST', 'fixture_request_id', p_request_id));

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

comment on function public.create_missing_target_team is
  'Club-structural authority only (Site Admin or the recipient club''s Club Admin) -- ordinary fixture authority (Fixtures Secretary via can_manage_club_fixtures) is deliberately not enough, per the two-authority model: fixture authority and team-structure authority are separate. Re-runs the resolution server-side before creating anything -- never trusts a stale client read.';

-- ============================================================
-- 2. reactivate_missing_target_team: the missing B/"exists_folded" path --
--    reuses public.reactivate_team (team_lifecycle.sql) rather than
--    reimplementing fold/reactivate lifecycle logic. Same club-structural
--    authority as team creation (reactivating is also a structural action).
-- ============================================================

create or replace function public.reactivate_missing_target_team(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_resolution text;
  v_existing_team_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if not (internal.is_site_admin() or (v_group.opponent_club_id is not null and internal.is_club_admin(v_group.opponent_club_id))) then
    raise exception 'Reactivating a team is a club-structural action -- Club Admin approval is required to activate this team.' using errcode = '42501';
  end if;
  if v_req.status <> 'sent' then
    raise exception 'This request is no longer awaiting a response (status: %).', v_req.status;
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_team_id from internal.resolve_incoming_request_target(p_request_id);
  if v_resolution <> 'exists_folded' then
    raise exception 'This team is no longer in a reactivatable state (%). Review the matching state and act on it directly.', v_resolution using errcode = 'P0001';
  end if;

  -- reactivate_team performs its own authority re-check and does the
  -- actual fold-lifecycle work (restoring visibility in Teams/Calendar
  -- without resurrecting old cancelled fixtures) -- never duplicated here.
  perform public.reactivate_team(v_existing_team_id);

  update public.fixture_requests set target_team_id = v_existing_team_id where id = p_request_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_existing_team_id, 'update', auth.uid(),
    jsonb_build_object('event', 'TEAM_REACTIVATED_FROM_FIXTURE_REQUEST', 'fixture_request_id', p_request_id));

  return v_existing_team_id;
end;
$$;

revoke execute on function public.reactivate_missing_target_team(uuid) from public;
grant execute on function public.reactivate_missing_target_team(uuid) to authenticated;

comment on function public.reactivate_missing_target_team is
  'The reactivation counterpart to create_missing_target_team -- same club-structural authority, same re-resolution-before-acting discipline. Reuses public.reactivate_team rather than reimplementing fold lifecycle.';

-- ============================================================
-- 3. accept_fixture_request_with_team_action: the ONE atomic entry point
--    a client should call for an incoming request that named a structured
--    (possibly-missing) team identity. Re-resolves state FRESH inside this
--    same transaction (never trusts p_consent_team_action as a command --
--    it is consent that a team action may be needed, not an instruction to
--    perform one unconditionally) so concurrent requests for the same
--    missing team naturally converge on one team (section 54/55 of the
--    instruction): if another request already created/reactivated the
--    team by the time this one is accepted, this call simply uses it.
--    A single plpgsql function body is one transaction with no internal
--    COMMIT, so any exception raised by the nested calls below rolls back
--    everything already done in this call -- never a team created with no
--    accepted fixture, or vice versa.
-- ============================================================

create or replace function public.accept_fixture_request_with_team_action(
  p_request_id uuid,
  p_consent_team_action boolean default false,
  p_target_team_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_resolution text;
  v_existing_team_id uuid;
  v_resolved_team_id uuid;
  v_fixture_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;

  -- Only relevant for a request that named a structured identity with no
  -- real team yet -- an ordinary request (real target_team_id, or a
  -- shared-calendar request) skips straight to accept_fixture_request,
  -- which already handles those cases correctly on its own.
  if v_req.target_team_id is not null or v_req.target_team_age_group is null then
    return public.accept_fixture_request(p_request_id, p_target_team_id);
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_team_id
  from internal.resolve_incoming_request_target(p_request_id);

  if v_resolution = 'exists_active' or v_resolution = 'has_target_team' then
    -- Already real (possibly created/reactivated by a concurrent request
    -- for the same identity) -- no team action needed regardless of
    -- consent, ordinary accept authority is sufficient.
    v_resolved_team_id := v_existing_team_id;
  elsif v_resolution = 'genuinely_missing' then
    if not p_consent_team_action then
      raise exception 'This team does not exist yet -- accepting requires creating it.' using errcode = 'P0001';
    end if;
    v_resolved_team_id := public.create_missing_target_team(p_request_id);
  elsif v_resolution = 'exists_folded' then
    if not p_consent_team_action then
      raise exception 'This team exists but is inactive -- accepting requires reactivating it.' using errcode = 'P0001';
    end if;
    v_resolved_team_id := public.reactivate_missing_target_team(p_request_id);
  else
    -- ambiguous_squad / pending_rollover / pending_structural / no_target_club /
    -- not_found / no_structured_identity: never guess, never proceed silently.
    raise exception 'This request cannot be accepted automatically yet (%). Review the matching state first.', v_resolution using errcode = 'P0001';
  end if;

  v_fixture_id := public.accept_fixture_request(p_request_id, v_resolved_team_id);

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('fixture_requests', p_request_id, 'update', auth.uid(),
    jsonb_build_object('event', 'FIXTURE_REQUEST_ACCEPTED', 'fixture_id', v_fixture_id, 'target_team_id', v_resolved_team_id));

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request_with_team_action(uuid, boolean, uuid) from public;
grant execute on function public.accept_fixture_request_with_team_action(uuid, boolean, uuid) to authenticated;

comment on function public.accept_fixture_request_with_team_action is
  'The one atomic "Accept Fixture & Create/Reactivate Team" entry point. p_consent_team_action is CONSENT that a team action may be performed if the fresh, re-resolved state still needs one -- never a command to unconditionally create/reactivate. Because resolution is re-run fresh inside this same transaction, two concurrent requests for the same missing identity naturally converge on one team: whichever is accepted second simply finds exists_active and skips straight to accepting. One plpgsql call = one transaction = full rollback on any failure (never a created team with an unaccepted request, or an accepted request with no valid team). Records a distinct TEAM_CREATED_FROM_FIXTURE_REQUEST/TEAM_REACTIVATED_FROM_FIXTURE_REQUEST audit event (from the nested call) plus its own FIXTURE_REQUEST_ACCEPTED event, both correlated by fixture_request_id/changed_by/changed_at.';

-- ============================================================
-- 4. admin_fixture_overview: expose whether home_club_name/away_club_name
--    is a REAL resolved club or a fallback to raw_opposition_text, so the
--    UI can render an unresolved legacy opponent distinctly instead of
--    presenting free text as if it were a canonical club/team identity
--    (the "Persistent Test Fixture" bug -- a real regression-test fixture
--    whose raw_opposition_text was rendered indistinguishably from a real
--    club name). Full column list otherwise identical to
--    20260910100000_admin_fixture_overview_mirror_id.sql.
-- ============================================================

create or replace view public.admin_fixture_overview
  with (security_invoker = true) as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.status,
  f.game_type,
  f.source,
  f.import_batch_id,
  f.replaces_fixture_id,
  f.raw_opposition_text,
  f.opponent_directory_id,
  f.opponent_team_id,
  f.season_label,
  f.notes,
  f.cancelled_at,
  f.cancellation_reason,
  f.created_at,
  f.updated_at,
  t.id as owning_team_id,
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  opp_cd.name as opponent_club_name,
  opp_t.display_name as opponent_team_name,
  comp.name as competition_name,
  v.name as venue_name,
  (select count(*) from public.fixture_messages fm where fm.fixture_id = f.id) as message_count,
  c.logo_storage_path as owning_club_logo_path,
  opp_c.id as opponent_club_id,
  opp_c.logo_storage_path as opponent_club_logo_path,
  f.pitch_allocation,
  f.home_score,
  f.away_score,
  f.result_status,
  f.result_submitted_at,
  f.result_confirmed_at,
  f.result_amendment_proposed_home_score,
  f.result_amendment_proposed_away_score,
  f.competition_edition_id,
  f.pitch_id,
  f.season_id,
  case when f.home_away = 'Away' then coalesce(opp_cd.name, f.raw_opposition_text) else cd.name end as home_club_name,
  case when f.home_away = 'Away' then opp_t.display_name else t.display_name end as home_team_name,
  case when f.home_away = 'Away' then cd.name else coalesce(opp_cd.name, f.raw_opposition_text) end as away_club_name,
  case when f.home_away = 'Away' then t.display_name else opp_t.display_name end as away_team_name,
  case when f.home_away = 'Away' then opp_t.category else t.category end as home_team_category,
  case when f.home_away = 'Away' then opp_t.age_group else t.age_group end as home_team_age_group,
  case when f.home_away = 'Away' then opp_t.gender else t.gender end as home_team_gender,
  case when f.home_away = 'Away' then opp_t.squad_designation else t.squad_designation end as home_team_squad_designation,
  case when f.home_away = 'Away' then t.category else opp_t.category end as away_team_category,
  case when f.home_away = 'Away' then t.age_group else opp_t.age_group end as away_team_age_group,
  case when f.home_away = 'Away' then t.gender else opp_t.gender end as away_team_gender,
  case when f.home_away = 'Away' then t.squad_designation else opp_t.squad_designation end as away_team_squad_designation,
  opp_t.category as opponent_team_category,
  opp_t.age_group as opponent_team_age_group,
  opp_t.gender as opponent_team_gender,
  opp_t.squad_designation as opponent_team_squad_designation,
  opp_t.rugby_code as opponent_team_rugby_code,
  f.home_team_id,
  f.away_team_id,
  case when f.home_away = 'Away' then f.opponent_directory_id else cd.id end as home_club_directory_id,
  case when f.home_away = 'Away' then cd.id else f.opponent_directory_id end as away_club_directory_id,
  s.name as season_canonical_name,
  cp.display_name as pitch_name,
  f.mirror_fixture_id,
  (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id) as is_primary_mirror,
  case when f.home_away = 'Away' then (opp_cd.id is not null) else true end as home_club_resolved,
  case when f.home_away = 'Away' then true else (opp_cd.id is not null) end as away_club_resolved
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.venues v on v.id = f.venue_id
left join public.seasons s on s.id = f.season_id
left join public.club_pitches cp on cp.id = f.pitch_id;

comment on view public.admin_fixture_overview is
  'The Master Fixture Registry''s Site Admin read model -- ONE row per real fixture. home_club_resolved/away_club_resolved (Central Fixture Participant Resolution) distinguish a genuinely resolved canonical club (or the owning side, always resolved) from a fallback to raw_opposition_text -- the UI must render an unresolved side distinctly (e.g. "Unresolved opponent:"), never as if it were a real club name. home_club_name/home_team_name/away_club_name/away_team_name are a display fallback for unresolved opponents; home_team_category/age_group/gender/squad_designation (and the away_ equivalents) are the structured fields the app runs through fullTeamLabel (lib/teams/compact-label.ts) to render the true canonical name whenever a real team is resolved -- never the raw, sometimes-stale teams.display_name. season_canonical_name/pitch_name are the human-readable companions to season_id/pitch_id for CSV export; home_team_id/away_team_id/home_club_directory_id/away_club_directory_id are the stable ids the same export round-trips on. mirror_fixture_id/is_primary_mirror are set only on legacy pre-consolidation mirror-pair fixtures.';
