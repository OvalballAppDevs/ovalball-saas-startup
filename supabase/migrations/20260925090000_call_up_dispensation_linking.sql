-- Links the fixture call-up domain to the dispensation domain through
-- the resolver added in 20260925080000, without flattening them into
-- one record. A call-up gains a nullable pointer to the dispensation
-- record that must be approved before it can become playable; the
-- dispensation itself is unchanged in shape, only in when it gets
-- created (now sometimes automatically, on the requester's behalf,
-- when the resolver says external approval is required).
alter table public.fixture_player_call_up
  add column if not exists eligibility_requirement_id uuid references public.player_team_dispensation(id);

alter table public.fixture_player_call_up drop constraint if exists fixture_player_call_up_status_check;
alter table public.fixture_player_call_up
  add constraint fixture_player_call_up_status_check
  check (status = any (array['awaiting_eligibility', 'requested', 'approved', 'rejected', 'revoked']));

-- request_player_dispensation split into an authorization wrapper and a
-- reusable core -- request_player_call_up needs to create a linked
-- dispensation record on the ORIGINAL requester's behalf without
-- re-running a manage_player_dispensations capability check the
-- requester was never expected to separately hold (they already
-- proved manage_fixture_callups; the resolver, not the caller,
-- decided a dispensation was needed). The public entry point's own
-- authorization and validation are otherwise unchanged.
create or replace function internal.request_player_dispensation_core(
  p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid,
  p_eligibility_rule_reference text, p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_source_club uuid;
  v_target_club uuid;
begin
  select club_id into v_source_club from public.teams where id = p_source_team_id;
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if v_source_club is distinct from v_target_club then
    raise exception 'A dispensation can only move a player between two teams of the SAME club.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.player_team_memberships
    where player_id = p_player_id and team_id = p_source_team_id and status = 'active' and ended_at is null
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A dispensation requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, requested_by)
  values (p_player_id, p_source_team_id, p_target_team_id, p_season_id, p_eligibility_rule_reference, p_requested_by)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.request_player_dispensation(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_club uuid;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_player_dispensations', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_player_dispensations', 'club', v_target_club)) then
    raise exception 'Not authorized to request a dispensation onto this team.' using errcode = '42501';
  end if;
  return internal.request_player_dispensation_core(p_player_id, p_source_team_id, p_target_team_id, p_season_id, p_eligibility_rule_reference, auth.uid());
end;
$$;

-- request_player_call_up now consults the resolver before creating
-- anything. PERMITTED/TEAM_APPROVAL_ONLY behave exactly as before
-- (status 'requested', no linked record). EXTERNAL_APPROVAL_REQUIRED
-- reuses an already-approved dispensation for this exact (player,
-- target team, season) if one exists; otherwise it creates the linked
-- dispensation itself (on the requester's own behalf, per Section 4:
-- "Ovalball knows... detect it automatically") and parks the call-up
-- at 'awaiting_eligibility' rather than rejecting the request outright.
-- NOT_PERMITTED blocks the call-up from ever being created.
create or replace function public.request_player_call_up(p_fixture_id uuid, p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_target_club uuid;
  v_rugby_code text;
  v_dob date;
  v_resolved record;
  v_season_id uuid;
  v_existing_dispensation record;
  v_eligibility_id uuid;
  v_call_up_status text;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_fixture_callups', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_fixture_callups', 'club', v_target_club)) then
    raise exception 'Not authorized to request a call-up onto this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A call-up requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  select rugby_code into v_rugby_code from public.teams where id = p_source_team_id;
  select date_of_birth into v_dob from public.players where id = p_player_id;
  select * into v_resolved from internal.resolve_player_movement_eligibility(v_rugby_code, current_date, v_dob, p_source_team_id, p_target_team_id);

  if v_resolved.requirement = 'not_permitted' then
    raise exception '%', v_resolved.reason using errcode = '23514';
  end if;

  v_call_up_status := 'requested';

  if v_resolved.requirement = 'external_approval_required' then
    v_season_id := internal.resolve_season_for_date(v_rugby_code, current_date);
    select * into v_existing_dispensation from public.player_team_dispensation
      where player_id = p_player_id and target_team_id = p_target_team_id and season_id = v_season_id;

    if found and v_existing_dispensation.status = 'approved' then
      v_eligibility_id := v_existing_dispensation.id;
      v_call_up_status := 'requested';
    elsif found then
      raise exception 'This player''s eligibility for % this season is currently "%", not approved -- a Club Admin must review it before a new call-up can be requested. (%)',
        (select display_name from public.teams where id = p_target_team_id), v_existing_dispensation.status, v_resolved.reason using errcode = '23514';
    else
      v_eligibility_id := internal.request_player_dispensation_core(
        p_player_id, p_source_team_id, p_target_team_id, v_season_id,
        coalesce(v_resolved.rule_reference, 'Age-grade dispensation') || ' -- ' || v_resolved.reason,
        auth.uid()
      );
      v_call_up_status := 'awaiting_eligibility';
    end if;
  end if;

  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, eligibility_rule_reference, requested_by, status, eligibility_requirement_id)
  values (p_fixture_id, p_player_id, p_source_team_id, p_target_team_id, p_eligibility_rule_reference, auth.uid(), v_call_up_status, v_eligibility_id)
  returning id into v_id;

  if v_call_up_status = 'awaiting_eligibility' then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'player_eligibility_approval_required', 'Age-grade approval required',
      format('%s requested for %s needs an age-grade approval before the request can proceed. %s', (select first_name || ' ' || surname from public.players where id = p_player_id), (select display_name from public.teams where id = p_target_team_id), v_resolved.reason),
      jsonb_build_object('dispensation_id', v_eligibility_id, 'call_up_id', v_id)
    from public.club_memberships cm
    where cm.club_id = v_target_club and cm.status = 'active' and cm.role = 'CLUB_ADMIN';
  end if;

  if v_call_up_status = 'requested' then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_call_up_requested', 'Player call-up requested',
      format('%s have requested %s for an upcoming fixture.', (select display_name from public.teams where id = p_target_team_id), (select first_name || ' ' || surname from public.players where id = p_player_id)),
      jsonb_build_object('call_up_id', v_id)
    from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
    where tp.team_id = p_source_team_id and cm.status = 'active' and tp.permission in ('team_admin', 'coach', 'manager')
    union
    select cm.user_id, 'fixture_call_up_requested', 'Player call-up requested',
      format('%s have requested %s for an upcoming fixture.', (select display_name from public.teams where id = p_target_team_id), (select first_name || ' ' || surname from public.players where id = p_player_id)),
      jsonb_build_object('call_up_id', v_id)
    from public.club_memberships cm
    where cm.club_id = v_target_club and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return v_id;
end;
$$;
