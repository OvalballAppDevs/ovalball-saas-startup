-- decide_player_call_up: approving is blocked while a linked
-- eligibility requirement is still outstanding (a source team cannot
-- consent to something that isn't legally playable yet); rejecting is
-- always allowed regardless of eligibility state, since the source
-- team is entitled to simply say no to lending the player at all.
create or replace function public.decide_player_call_up(p_call_up_id uuid, p_action text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.fixture_player_call_up;
  v_source_club uuid;
  v_kickoff_date date;
  v_conflict_count integer;
begin
  select * into c from public.fixture_player_call_up where id = p_call_up_id for update;
  if not found then
    raise exception 'Call-up not found.';
  end if;
  select club_id into v_source_club from public.teams where id = c.source_team_id;
  if not (internal.has_capability('approve_fixture_callups', 'team', v_source_club, c.source_team_id) or internal.has_capability('approve_fixture_callups', 'club', v_source_club)) then
    raise exception 'Not authorized to decide this call-up -- only the source team (the one lending the player) or that club''s fixture secretary/admin may approve or reject it.' using errcode = '42501';
  end if;

  if p_action = 'approve' and c.status = 'awaiting_eligibility' then
    raise exception 'This call-up cannot be approved until its linked age-grade approval has been granted.' using errcode = '23514';
  end if;
  if c.status not in ('requested', 'awaiting_eligibility') and p_action in ('approve', 'reject') then
    raise exception 'This call-up has already been decided (%).', c.status;
  end if;
  if p_action = 'revoke' and c.status <> 'approved' then
    raise exception 'Only an approved call-up can be revoked.';
  end if;

  if p_action = 'approve' then
    select kickoff_date into v_kickoff_date from public.fixtures where id = c.fixture_id;

    select count(*) into v_conflict_count
    from public.fixture_player_call_up other
    join public.fixtures f on f.id = other.fixture_id
    where other.player_id = c.player_id
      and other.id <> c.id
      and other.status = 'approved'
      and f.kickoff_date = v_kickoff_date;
    if v_conflict_count > 0 then
      raise exception 'This player already holds an approved call-up to a different fixture on %. A player may hold only one physical fixture commitment per day.', v_kickoff_date using errcode = '23514';
    end if;

    select count(*) into v_conflict_count
    from public.player_team_memberships ptm
    join public.fixtures f on f.owning_team_id = ptm.team_id or f.opponent_team_id = ptm.team_id
    where ptm.player_id = c.player_id
      and ptm.status = 'active' and ptm.ended_at is null
      and f.kickoff_date = v_kickoff_date
      and f.status <> 'Cancelled'
      and f.id <> c.fixture_id;
    if v_conflict_count > 0 then
      raise exception 'This player''s own team already has a fixture commitment on %. A player may hold only one physical fixture commitment per day.', v_kickoff_date using errcode = '23514';
    end if;

    update public.fixture_player_call_up set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  elsif p_action = 'reject' then
    update public.fixture_player_call_up set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  elsif p_action = 'revoke' then
    update public.fixture_player_call_up set status = 'revoked', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  else
    raise exception 'Unknown call-up action: %', p_action;
  end if;

  if p_action in ('approve', 'reject') then
    insert into public.notifications (user_id, type, title, body, data)
    select c.requested_by, 'fixture_call_up_decided',
      case when p_action = 'approve' then 'Call-up approved' else 'Call-up rejected' end,
      format('%s call-up for %s has been %sd.', (select display_name from public.teams where id = c.target_team_id), (select first_name || ' ' || surname from public.players where id = c.player_id), p_action),
      jsonb_build_object('call_up_id', c.id)
    where c.requested_by is not null;
  end if;
end;
$$;

-- decide_player_dispensation: the club/governing_body stages now
-- propagate to any call-up(s) waiting on this exact dispensation --
-- an approval unblocks them back to 'requested' (the source team can
-- now decide for real), a rejection at any stage cancels them outright
-- rather than leaving a call-up silently stuck forever. Only the
-- governing_body branch actually changes here beyond that
-- propagation; source_team and club stages are unchanged in their own
-- authorization.
create or replace function public.decide_player_dispensation(p_id uuid, p_stage text, p_approve boolean, p_governing_body_reference text default null::text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;

  if p_stage = 'source_team' then
    if d.status <> 'requested' then
      raise exception 'This dispensation is not awaiting source-team approval (current status: %).', d.status;
    end if;
    if not (internal.has_capability('approve_player_dispensations', 'team', v_source_club, d.source_team_id) or internal.has_capability('approve_player_dispensations', 'club', v_source_club)) then
      raise exception 'Not authorized to give source-team approval -- only the source team (the one lending the player) or that club''s fixture secretary/admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'source_team_approved' else 'rejected' end,
        source_team_decided_by = auth.uid(), source_team_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'club' then
    if d.status <> 'source_team_approved' then
      raise exception 'This dispensation is not awaiting club approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to give club approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'club_approved' else 'rejected' end,
        club_decided_by = auth.uid(), club_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'governing_body' then
    if d.status <> 'club_approved' then
      raise exception 'This dispensation is not awaiting governing-body approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to record governing-body approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    if p_approve and coalesce(trim(p_governing_body_reference), '') = '' then
      raise exception 'Recording governing-body approval requires a reference (e.g. the dispensation certificate/case number the club holds).';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'approved' else 'rejected' end,
        governing_body_reference = p_governing_body_reference,
        governing_body_decided_by = auth.uid(), governing_body_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  else
    raise exception 'Unknown dispensation stage: %', p_stage;
  end if;

  if not p_approve then
    update public.fixture_player_call_up
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_reason = coalesce(p_reason, 'The linked age-grade approval was rejected.')
    where eligibility_requirement_id = d.id and status = 'awaiting_eligibility';

    insert into public.notifications (user_id, type, title, body, data)
    select c.requested_by, 'fixture_call_up_decided', 'Call-up blocked',
      format('The age-grade approval for %s was rejected, so the linked call-up request cannot proceed.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
      jsonb_build_object('dispensation_id', d.id)
    from public.fixture_player_call_up c
    where c.eligibility_requirement_id = d.id and c.requested_by is not null;
  elsif p_stage = 'governing_body' then
    update public.fixture_player_call_up
    set status = 'requested'
    where eligibility_requirement_id = d.id and status = 'awaiting_eligibility';

    insert into public.notifications (user_id, type, title, body, data)
    select c.requested_by, 'fixture_call_up_decided', 'Age-grade approval granted',
      format('The age-grade approval for %s has been recorded. The call-up can now proceed to the source team''s decision.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
      jsonb_build_object('dispensation_id', d.id, 'call_up_id', c.id)
    from public.fixture_player_call_up c
    where c.eligibility_requirement_id = d.id and c.requested_by is not null;
  end if;
end;
$$;
