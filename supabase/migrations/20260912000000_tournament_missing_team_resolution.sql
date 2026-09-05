-- Tournament participant resolution through the SAME central missing-team
-- mechanism ordinary fixture requests already use (Central Fixture
-- Participant Resolution, 20260911000000). invite_tournament_participant
-- already lets a host invite a claimed-but-missing/inactive team (records
-- canonical_team_type_id, leaves team_id null) -- what was missing is the
-- ACCEPT side: a way for the invited club to accept AND create/reactivate
-- the team in one atomic action, mirroring accept_fixture_request_with_
-- team_action exactly. tournament_participants.canonical_team_type_id
-- already fully disambiguates the identity (unlike fixture_requests' three
-- separate age/gender/squad text columns), so resolution here is simpler:
-- no squad-ambiguity case is possible, since the canonical type IS the
-- exact squad.

-- ============================================================
-- 1. internal.resolve_tournament_participant_target: read-only, mirrors
--    internal.resolve_incoming_request_target's contract (resolution,
--    existing_team_id, message) so client code and the accept RPC below
--    can treat both the same way.
-- ============================================================

create or replace function internal.resolve_tournament_participant_target(p_participant_id uuid)
returns table(resolution text, existing_team_id uuid, message text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_active_id uuid;
  v_folded_id uuid;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id;
  if not found then
    return query select 'not_found', null::uuid, 'Tournament participant not found.';
    return;
  end if;

  if v_p.team_id is not null then
    return query select 'has_target_team', v_p.team_id, 'This participant already has a real team.';
    return;
  end if;

  if v_p.club_id is null then
    return query select 'no_target_club', null::uuid, 'This club has no activated Ovalball account to create a team on.';
    return;
  end if;

  select id into v_active_id from public.teams
  where club_id = v_p.club_id and canonical_team_type_id = v_p.canonical_team_type_id and active
  limit 1;
  if v_active_id is not null then
    return query select 'exists_active', v_active_id, 'A matching team already exists.';
    return;
  end if;

  select id into v_folded_id from public.teams
  where club_id = v_p.club_id and canonical_team_type_id = v_p.canonical_team_type_id and not active
  limit 1;
  if v_folded_id is not null then
    return query select 'exists_folded', v_folded_id, 'A matching team exists but has folded.';
    return;
  end if;

  return query select 'genuinely_missing', null::uuid, 'No matching team exists yet -- safe to create.';
end;
$$;

grant execute on function internal.resolve_tournament_participant_target(uuid) to authenticated;

-- Public wrapper: internal.* is not PostgREST-exposed (client code can only
-- call public.* via supabase.rpc()), mirroring check_incoming_request_
-- target's exact pattern for the ordinary-fixture case -- same authority
-- check (Site Admin, or a real authority holder for this participant's
-- resolved club/team).
create or replace function public.check_tournament_participant_target(p_participant_id uuid)
returns table(resolution text, existing_team_id uuid, message text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_p public.tournament_participants;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id;
  if not found then raise exception 'Tournament participant not found.'; end if;
  if not (internal.is_site_admin()
          or (v_p.club_id is not null and internal.can_manage_club_fixtures(v_p.club_id))
          or (v_p.team_id is not null and internal.can_manage_team(v_p.team_id))) then
    raise exception 'Not authorized to review this tournament invitation.' using errcode = '42501';
  end if;
  return query select * from internal.resolve_tournament_participant_target(p_participant_id);
end;
$$;

revoke execute on function public.check_tournament_participant_target(uuid) from public;
grant execute on function public.check_tournament_participant_target(uuid) to authenticated;

comment on function internal.resolve_tournament_participant_target is
  'Tournament counterpart to internal.resolve_incoming_request_target. Simpler than the fixture_requests version: tournament_participants.canonical_team_type_id already fully disambiguates squad, so no ambiguous_squad/pending_rollover/pending_structural cases exist here -- those are fixture_requests-specific concerns (a request naming only age+gender with the squad unspecified, or racing an in-flight Season Rollover) that do not apply to a tournament invitation, which always names one exact canonical identity.';

-- ============================================================
-- 2. create_missing_tournament_team / reactivate_missing_tournament_team:
--    mirror create_missing_target_team / reactivate_missing_target_team
--    exactly, driven by canonical_team_types directly (already fully
--    structured) rather than reconstructing a display name from separate
--    age/gender/squad columns.
-- ============================================================

create or replace function public.create_missing_tournament_team(p_participant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_ct public.canonical_team_types;
  v_resolution text;
  v_display_name text;
  v_slug text;
  v_rugby_code text;
  v_new_team_id uuid;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;

  if not (internal.is_site_admin() or (v_p.club_id is not null and internal.is_club_admin(v_p.club_id))) then
    raise exception 'Creating a team is a club-structural action -- Club Admin approval is required to activate this team.' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'This invitation is no longer awaiting a response (status: %).', v_p.status;
  end if;

  select resolution into v_resolution from internal.resolve_tournament_participant_target(p_participant_id);
  if v_resolution <> 'genuinely_missing' then
    raise exception 'This team can no longer be created automatically (%). Review the matching state and act on it directly.', v_resolution using errcode = 'P0001';
  end if;

  select * into v_ct from public.canonical_team_types where id = v_p.canonical_team_type_id;
  select t.rugby_code into v_rugby_code from public.tournaments t where t.id = v_p.tournament_id;

  v_display_name := v_ct.label;
  v_slug := trim(both '-' from regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g'));

  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
  values (v_p.club_id, v_rugby_code, v_ct.category, v_ct.age_group, v_ct.gender, v_ct.fixed_squad_designation, v_display_name, v_slug, auth.uid(), auth.uid())
  returning id into v_new_team_id;

  update public.tournament_participants set team_id = v_new_team_id where id = p_participant_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_new_team_id, 'insert', auth.uid(),
    jsonb_build_object('display_name', v_display_name, 'event', 'TEAM_CREATED_FROM_TOURNAMENT_INVITATION', 'tournament_participant_id', p_participant_id));

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'team_created_from_tournament_invitation',
    format('%s was created', v_display_name),
    format('%s was created because a tournament invitation was accepted for this team. Review Team Settings.', v_display_name),
    jsonb_build_object('team_id', v_new_team_id, 'tournament_participant_id', p_participant_id)
  from public.club_memberships cm
  where cm.club_id = v_p.club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active';

  return v_new_team_id;
end;
$$;

revoke execute on function public.create_missing_tournament_team(uuid) from public;
grant execute on function public.create_missing_tournament_team(uuid) to authenticated;

create or replace function public.reactivate_missing_tournament_team(p_participant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_resolution text;
  v_existing_team_id uuid;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;

  if not (internal.is_site_admin() or (v_p.club_id is not null and internal.is_club_admin(v_p.club_id))) then
    raise exception 'Reactivating a team is a club-structural action -- Club Admin approval is required to activate this team.' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'This invitation is no longer awaiting a response (status: %).', v_p.status;
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_team_id from internal.resolve_tournament_participant_target(p_participant_id);
  if v_resolution <> 'exists_folded' then
    raise exception 'This team is no longer in a reactivatable state (%). Review the matching state and act on it directly.', v_resolution using errcode = 'P0001';
  end if;

  perform public.reactivate_team(v_existing_team_id);

  update public.tournament_participants set team_id = v_existing_team_id where id = p_participant_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_existing_team_id, 'update', auth.uid(),
    jsonb_build_object('event', 'TEAM_REACTIVATED_FROM_TOURNAMENT_INVITATION', 'tournament_participant_id', p_participant_id));

  return v_existing_team_id;
end;
$$;

revoke execute on function public.reactivate_missing_tournament_team(uuid) from public;
grant execute on function public.reactivate_missing_tournament_team(uuid) to authenticated;

-- ============================================================
-- 3. respond_tournament_invitation_with_team_action: the ONE atomic entry
--    point for an invited club to respond, mirroring accept_fixture_
--    request_with_team_action exactly -- re-resolves state fresh inside
--    the same transaction (never trusts a stale client read or treats
--    p_consent_team_action as a command), so concurrent tournament
--    invitations naming the same missing identity at the same club
--    naturally converge on one team.
-- ============================================================

create or replace function public.respond_tournament_invitation_with_team_action(
  p_participant_id uuid,
  p_accept boolean,
  p_consent_team_action boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_resolution text;
  v_existing_team_id uuid;
  v_resolved_team_id uuid;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;

  -- A decline never needs team resolution, and an already-resolved team
  -- (team_id already set) can go straight through the ordinary responder.
  if not p_accept or v_p.team_id is not null then
    perform public.respond_tournament_invitation(p_participant_id, p_accept);
    return;
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_team_id
  from internal.resolve_tournament_participant_target(p_participant_id);

  if v_resolution = 'exists_active' or v_resolution = 'has_target_team' then
    v_resolved_team_id := v_existing_team_id;
  elsif v_resolution = 'genuinely_missing' then
    if not p_consent_team_action then
      raise exception 'This team does not exist yet -- accepting requires creating it.' using errcode = 'P0001';
    end if;
    v_resolved_team_id := public.create_missing_tournament_team(p_participant_id);
  elsif v_resolution = 'exists_folded' then
    if not p_consent_team_action then
      raise exception 'This team exists but is inactive -- accepting requires reactivating it.' using errcode = 'P0001';
    end if;
    v_resolved_team_id := public.reactivate_missing_tournament_team(p_participant_id);
  else
    raise exception 'This invitation cannot be accepted automatically yet (%). Review the matching state first.', v_resolution using errcode = 'P0001';
  end if;

  -- team_id is now set (by the nested call above); respond_tournament_
  -- invitation re-reads the row fresh, so it sees the resolved team.
  perform public.respond_tournament_invitation(p_participant_id, true);
end;
$$;

revoke execute on function public.respond_tournament_invitation_with_team_action(uuid, boolean, boolean) from public;
grant execute on function public.respond_tournament_invitation_with_team_action(uuid, boolean, boolean) to authenticated;

comment on function public.respond_tournament_invitation_with_team_action is
  'The one atomic "Accept Tournament & Create/Reactivate Team" entry point, mirroring accept_fixture_request_with_team_action. p_consent_team_action is consent, not a command -- resolution is re-run fresh so concurrent invitations to the same missing identity converge on one team.';

-- ============================================================
-- 4. Resolve a canonical_team_type_id from structured age/gender/squad
--    fields -- what the client-side missing-team picker (opponent-
--    resolver.tsx) already collects for ordinary fixtures. Tournament
--    invitation needs the same identity expressed as a canonical_team_
--    type_id (invite_tournament_participant's own parameter shape),
--    so this is the lookup bridge -- never re-derives the identity
--    independently, just looks up the existing closed catalogue row.
-- ============================================================

create or replace function public.resolve_canonical_team_type_id(
  p_age_group text, p_gender text, p_squad_designation text default null
)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.canonical_team_types
  where category = 'youth' and age_group = p_age_group and gender = p_gender
    and coalesce(fixed_squad_designation, '') = coalesce(nullif(upper(p_squad_designation), 'A'), '')
  limit 1;
$$;

revoke execute on function public.resolve_canonical_team_type_id(text, text, text) from public;
grant execute on function public.resolve_canonical_team_type_id(text, text, text) to authenticated;

comment on function public.resolve_canonical_team_type_id is
  'Read-only lookup bridging the structured age/gender/squad fields the missing-team UI already collects to the canonical_team_type_id tournament invitations are keyed on. Never creates a catalogue row -- returns null if the combination genuinely does not exist in the closed catalogue.';

-- ============================================================
-- 5. Database constraint: the host's own club can never be inserted as an
--    ordinary invited participant (Section 35: "Host cannot also be
--    inserted as an ordinary invited participant accidentally"). A bare
--    CHECK can't join tournaments, so this is a trigger -- the real
--    enforcement, not a UI-only guard.
-- ============================================================

create or replace function internal.validate_tournament_participant_not_host() returns trigger
language plpgsql
as $$
declare
  v_host_directory_id uuid;
begin
  select host_directory_id into v_host_directory_id from public.tournaments where id = new.tournament_id;
  if v_host_directory_id is not null and new.club_directory_id = v_host_directory_id then
    raise exception 'The host club cannot also be inserted as an ordinary invited participant.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tournament_participants_validate_not_host on public.tournament_participants;
create trigger tournament_participants_validate_not_host
  before insert or update of club_directory_id on public.tournament_participants
  for each row execute function internal.validate_tournament_participant_not_host();
