-- Safeguarding Officer Foundation, part 4: dispensation notifications
-- (spec section 18-20). Audit finding: player dispensation/movement is
-- always same-club (source_team and target_team belong to the same
-- club -- the eligibility resolver hard-rejects any cross-club move as
-- "not_permitted"), so exactly one club's officer(s) are ever relevant
-- per dispensation. Notification does NOT change who approves anything
-- -- request_player_dispensation/decide_player_dispensation/revoke_
-- player_dispensation's own authorization checks are copied verbatim,
-- unchanged; only a notification insert is added at each real event.

-- ============================================================
-- 1. internal.notify_club_safeguarding_officers -- one small, genuinely
-- shared helper (not a new subsystem -- it is the exact same "insert
-- into notifications select ... from <capability-derived recipient set>"
-- idiom every other domain event in this codebase already repeats
-- inline, factored out only because THIS specific recipient query
-- (active, accepted officers with a specific capability at a club) would
-- otherwise be duplicated verbatim at every one of the four call sites
-- below).
-- ============================================================
create or replace function internal.notify_club_safeguarding_officers(
  p_club_id uuid, p_capability_key text, p_type text, p_title text, p_body text, p_data jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- internal.has_capability() only ever answers for auth.uid() (the
  -- CALLING user), not an arbitrary target -- these four notification
  -- capabilities are deliberately never part of any role-derived default
  -- bundle (see the previous migration), so whether a SPECIFIC other
  -- person (the officer) holds one reduces exactly to "does an active
  -- capability_overrides grant exist and no active deny outranks it" --
  -- the same deny-beats-grant precedence internal.has_capability itself
  -- uses, replicated here only because that function cannot be called
  -- for anyone but the current session.
  insert into public.notifications (user_id, type, title, body, data)
  select o.user_id, p_type, p_title, p_body, p_data
  from public.club_safeguarding_officers o
  where o.club_id = p_club_id and o.status = 'active' and o.user_id is not null
    and not exists (
      select 1 from public.capability_overrides co
      where co.user_id = o.user_id and co.capability_key = p_capability_key
        and co.scope_type = 'club' and co.club_id = p_club_id and co.effect = 'deny' and co.status = 'active'
    )
    and exists (
      select 1 from public.capability_overrides co
      where co.user_id = o.user_id and co.capability_key = p_capability_key
        and co.scope_type = 'club' and co.club_id = p_club_id and co.effect = 'grant' and co.status = 'active'
    );
end;
$$;

comment on function internal.notify_club_safeguarding_officers is
  'Notifies every active, accepted Safeguarding Officer at a club who individually holds the named capability -- never every officer regardless of grant, and never anyone who is merely "the Safeguarding Officer" by title alone. p_data must never carry regulatory/case content (spec section 32) -- only stable ids for the receiving UI to look up.';

-- ============================================================
-- 2. request_player_dispensation -- unchanged authorization, unchanged
-- delegation to internal.request_player_dispensation_core (never touched
-- -- the approval workflow itself is out of scope, per spec section 18's
-- explicit "do not change who grants/approves"). Only a notification is
-- added, after the fact, using the already-resolved v_target_club.
-- ============================================================
create or replace function public.request_player_dispensation(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_club uuid;
  v_id uuid;
  v_player_name text;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_player_dispensations', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_player_dispensations', 'club', v_target_club)) then
    raise exception 'Not authorized to request a dispensation onto this team.' using errcode = '42501';
  end if;
  v_id := internal.request_player_dispensation_core(p_player_id, p_source_team_id, p_target_team_id, p_season_id, p_eligibility_rule_reference, auth.uid());

  select first_name || ' ' || surname into v_player_name from public.players where id = p_player_id;
  perform internal.notify_club_safeguarding_officers(
    v_target_club, 'club.dispensation.notify', 'safeguarding_dispensation_requested', 'Dispensation requested',
    format('A dispensation was requested for %s.', coalesce(v_player_name, 'a player')),
    jsonb_build_object('dispensation_id', v_id)
  );

  return v_id;
end;
$$;

-- ============================================================
-- 3. decide_player_dispensation -- unchanged authorization/stage logic
-- (copied verbatim from the latest definition), notifications added only
-- at the two events spec section 19 actually asks for: a rejection at
-- any stage, and the final governing-body approval. An intermediate
-- source_team/club approval that does not yet finish or reject the
-- dispensation is deliberately NOT notified -- spec section 19's own
-- "only send events that are genuinely useful" instruction; a Safeguarding
-- Officer does not need a push for every intermediate internal handoff.
-- ============================================================
create or replace function public.decide_player_dispensation(p_id uuid, p_stage text, p_approve boolean, p_governing_body_reference text default null::text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
  v_player_name text;
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

  -- Safeguarding Officer notification (spec section 19): only on a
  -- rejection (any stage) or the final governing-body approval -- never
  -- an intermediate approval, and never a change to who actually decides.
  select first_name || ' ' || surname into v_player_name from public.players where id = d.player_id;
  if not p_approve then
    perform internal.notify_club_safeguarding_officers(
      v_source_club, 'club.dispensation.notify', 'safeguarding_dispensation_decided', 'Dispensation declined',
      format('The dispensation for %s was declined at the %s stage.', coalesce(v_player_name, 'a player'), p_stage),
      jsonb_build_object('dispensation_id', d.id)
    );
  elsif p_stage = 'governing_body' then
    perform internal.notify_club_safeguarding_officers(
      v_source_club, 'club.dispensation.notify', 'safeguarding_dispensation_decided', 'Dispensation approved',
      format('The dispensation for %s has been fully approved.', coalesce(v_player_name, 'a player')),
      jsonb_build_object('dispensation_id', d.id)
    );
  end if;
end;
$$;

-- ============================================================
-- 4. revoke_player_dispensation -- unchanged authorization (copied
-- verbatim from the latest definition), notification added at the end.
-- ============================================================
create or replace function public.revoke_player_dispensation(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
  v_player_name text;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  if d.status <> 'approved' then
    raise exception 'Only an approved dispensation can be revoked (current status: %).', d.status;
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;
  if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to revoke this dispensation -- only this club''s Club Admin may revoke.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to revoke a dispensation.';
  end if;

  update public.player_team_dispensation
  set status = 'revoked', decision_reason = p_reason, updated_at = now()
  where id = p_id;

  with blocked as (
    update public.fixture_player_call_up
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_reason = format('The linked age-grade approval was revoked: %s', p_reason)
    where eligibility_requirement_id = d.id and status in ('requested', 'awaiting_eligibility')
    returning id, requested_by
  )
  insert into public.notifications (user_id, type, title, body, data)
  select blocked.requested_by, 'fixture_call_up_decided', 'Call-up blocked',
    format('The age-grade approval for %s was revoked, so the linked call-up request can no longer proceed.', (select first_name || ' ' || surname from public.players where id = d.player_id)),
    jsonb_build_object('dispensation_id', d.id, 'call_up_id', blocked.id)
  from blocked
  where blocked.requested_by is not null;

  select first_name || ' ' || surname into v_player_name from public.players where id = d.player_id;
  perform internal.notify_club_safeguarding_officers(
    v_source_club, 'club.dispensation.notify', 'safeguarding_dispensation_revoked', 'Dispensation revoked',
    format('The dispensation for %s was revoked: %s', coalesce(v_player_name, 'a player'), p_reason),
    jsonb_build_object('dispensation_id', d.id)
  );
end;
$$;
