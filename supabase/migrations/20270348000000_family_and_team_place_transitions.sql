-- Family relationship and team place transitions.
--
-- Identity/Auth Slice 2 (Phase 2 N.1, M.3, AH R10, R11, R20).
--
-- After this migration:
--
--   * A request to add another guardian opens a PENDING_APPROVAL relationship,
--     and the added adult answers it themselves
--     (respond_to_additional_guardian_request). The club can approve only
--     after that person has accepted (R11). Declining, rejecting or
--     withdrawing a request declines the relationship.
--   * A relationship is removed, put on hold or taken off hold by one function
--     (transition_guardian_relationship), with a reason wherever someone other
--     than the guardian acts. A guardian may remove themselves.
--   * A finished team place is never switched back on: restoring a player
--     adds a new place. A declined team request is DECLINED, not ENDED.
--     Moving a player ends one place and opens another in one transaction,
--     and an attendance response taken during a move is decided against the
--     place that is current when it commits (R20).
--   * Every relationship and team place change emits its security event, on
--     every path, from the table itself.
--   * Existing writers record where a relationship or team place came from.
--   * Free-text reasons are not readable through the API: a guardian never
--     reads why their relationship was put on hold, and a member never reads
--     the reason recorded against their removal.

-- ---------------------------------------------------------------------
-- 1. Provenance, catalogue and column visibility
-- ---------------------------------------------------------------------

alter table public.player_team_memberships drop constraint player_team_memberships_source_check;
alter table public.player_team_memberships add constraint player_team_memberships_source_check
  check (source in ('GUARDIAN_ADDED_CHILD', 'PLAYER_JOIN_REQUEST', 'TEAM_CODE', 'CLUB_CREATED', 'LINK_REQUEST_APPROVAL', 'GUARDIAN_INVITATION',
                    'SITE_ADMIN_ASSIGNMENT', 'SEASON_HANDOVER', 'GRADUATION', 'TEAM_MOVE', 'TEAM_READMISSION', 'DUPLICATE_RESOLUTION', 'LEGACY_BACKFILL'));

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('guardian.restored', 'FAMILY', 'WARNING', true, false, true);

revoke select on public.club_memberships from authenticated;
grant select (id, club_id, user_id, role, status, created_by, updated_by, created_at, updated_at, club_role_title, assigned_group_id,
              authority_suspended, authority_suspended_at, authority_restored_at, authority_restored_by, state, source, granted_by, granted_at,
              approved_by, approved_at, suspended_level, suspended_by, suspended_at, revoked_by, revoked_at,
              source_invitation_id, source_request_id, governance_title)
  on public.club_memberships to authenticated;

revoke select on public.role_assignments from authenticated;
grant select (id, user_id, club_id, team_id, membership_id, role_key, base_assignment_id, state, source, granted_by, granted_at, attributes,
              suspended_level, suspended_by, suspended_at, revoked_by, revoked_at, confirmation_state, confirmed_by, confirmed_at,
              source_invitation_id, created_at, updated_at)
  on public.role_assignments to authenticated;

revoke select on public.guardians from authenticated;
grant select (id, guardian_user_id, player_id, relationship_type, status, created_by, created_at, updated_by, updated_at, state, source,
              approved_by, approved_at, verification_state, revoked_at, source_request_id, source_invitation_id)
  on public.guardians to authenticated;

revoke select on public.player_team_memberships from authenticated;
grant select (id, player_id, team_id, status, joined_at, ended_at, created_by, created_at, updated_by, updated_at, state, source,
              granted_by, approved_by, approved_at, ended_by)
  on public.player_team_memberships to authenticated;

grant select (subject_response, subject_responded_at) on public.guardian_link_requests to authenticated;

-- ---------------------------------------------------------------------
-- 2. Events from the tables themselves
-- ---------------------------------------------------------------------

-- The club a player currently belongs to, for event scoping.
create or replace function internal.player_event_club(p_player_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.club_id
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and ptm.state in ('ACTIVE', 'PENDING')
  order by (ptm.state = 'ACTIVE') desc, ptm.created_at
  limit 1;
$$;

create or replace function internal.guardian_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.state = 'ACTIVE' then
      v_event := 'guardian.linked';
    end if;
  elsif new.state is distinct from old.state then
    v_event := case
      when new.state = 'ACTIVE' and old.state = 'PENDING_APPROVAL' then 'guardian.linked'
      when new.state = 'ACTIVE' and old.state = 'SUSPENDED' then 'guardian.restored'
      when new.state = 'SUSPENDED' then 'guardian.suspended'
      when new.state = 'REVOKED' then 'guardian.unlinked'
    end;
    v_reason := case new.state
      when 'REVOKED' then new.revocation_reason
      when 'SUSPENDED' then new.suspension_reason
      else new.reason
    end;
  end if;
  if v_event is not null then
    perform internal.emit_security_event(v_event, new.guardian_user_id, 'SUCCESS', v_reason,
      jsonb_build_object('relationship_id', new.id, 'source', new.source, 'from_state', case when tg_op = 'UPDATE' then old.state end, 'to_state', new.state),
      internal.player_event_club(new.player_id), null, new.player_id);
  end if;
  return null;
end;
$$;

create trigger guardian_after_change
  after insert or update on public.guardians
  for each row execute function internal.guardian_after_change();

create or replace function internal.player_team_membership_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_club uuid;
begin
  if coalesce(current_setting('ovalball.player_team_move', true), '') = 'on' then
    return null; -- the move records one player_team.moved event itself
  end if;
  if tg_op = 'INSERT' then
    if new.state = 'ACTIVE' then
      v_event := 'player_team.added';
    end if;
  elsif new.state is distinct from old.state then
    v_event := case
      when new.state = 'ACTIVE' then 'player_team.added'
      when new.state = 'ENDED' and old.state = 'ACTIVE' then 'player_team.ended'
    end;
  end if;
  if v_event is not null then
    select club_id into v_club from public.teams where id = new.team_id;
    perform internal.emit_security_event(v_event, null, 'SUCCESS', new.end_reason,
      jsonb_build_object('team_membership_id', new.id, 'source', new.source, 'from_state', case when tg_op = 'UPDATE' then old.state end, 'to_state', new.state),
      v_club, new.team_id, new.player_id);
  end if;
  return null;
end;
$$;

create trigger player_team_membership_after_change
  after insert or update on public.player_team_memberships
  for each row execute function internal.player_team_membership_after_change();

revoke all on function internal.player_event_club(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.guardian_after_change() from public, anon, authenticated, service_role;
revoke all on function internal.player_team_membership_after_change() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Guardian requests open a relationship awaiting approval
-- ---------------------------------------------------------------------

-- Only an additional-guardian request names both the adult and the child
-- to the people who can see it. A first-child request that matched an
-- existing player must not reveal that match to the requester, so its
-- relationship is created at approval.
create or replace function internal.open_additional_guardian_relationship(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.guardian_link_requests;
  v_id uuid;
begin
  select * into v_request from public.guardian_link_requests where id = p_request_id;
  if v_request.kind <> 'ADDITIONAL_GUARDIAN' or v_request.subject_user_id is null or v_request.target_player_id is null
     or v_request.status <> 'PENDING' then
    return null;
  end if;
  select id into v_id from public.guardians
  where guardian_user_id = v_request.subject_user_id and player_id = v_request.target_player_id
    and state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED');
  if v_id is null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, source_request_id, created_by)
    values (v_request.subject_user_id, v_request.target_player_id, 'guardian', 'pending', 'PENDING_APPROVAL',
            'ADDITIONAL_GUARDIAN_REQUEST', p_request_id, v_request.requested_by_user_id)
    returning id into v_id;
  end if;
  update public.guardian_link_requests set relationship_id = v_id where id = p_request_id and relationship_id is distinct from v_id;
  return v_id;
end;
$$;

create or replace function internal.guardian_link_request_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.emit_security_event('guardian.link_requested', coalesce(new.subject_user_id, new.requested_by_user_id), 'SUCCESS', null,
    jsonb_build_object('request_id', new.id, 'kind', new.kind), new.club_id, new.team_id, new.target_player_id);
  perform internal.open_additional_guardian_relationship(new.id);
  return null;
end;
$$;

-- Declines the relationship a request opened, if it is still waiting.
create or replace function internal.decline_requested_relationship(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guardians g
  set state = 'DECLINED', reason = p_reason, updated_by = auth.uid()
  from public.guardian_link_requests r
  where r.id = p_request_id and g.state = 'PENDING_APPROVAL'
    and (g.id = r.relationship_id or g.source_request_id = r.id);
end;
$$;

revoke all on function internal.open_additional_guardian_relationship(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.guardian_link_request_opened() from public, anon, authenticated, service_role;
revoke all on function internal.decline_requested_relationship(uuid, text) from public, anon, authenticated, service_role;

create trigger guardian_link_request_opened
  after insert on public.guardian_link_requests
  for each row execute function internal.guardian_link_request_opened();

-- ---------------------------------------------------------------------
-- 4. Guardian transitions
-- ---------------------------------------------------------------------

create or replace function public.respond_to_additional_guardian_request(p_request_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.guardian_link_requests;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_response not in ('ACCEPT', 'DECLINE') then
    raise exception 'Accept or decline the request.' using errcode = '22023';
  end if;
  select * into v_request from public.guardian_link_requests where id = p_request_id for update;
  if v_request.id is null or v_request.kind <> 'ADDITIONAL_GUARDIAN'
     or not (v_request.subject_user_id = auth.uid()
             or (v_request.subject_user_id is null and lower(v_request.invited_email) = lower(coalesce(auth.email(), '')))) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'This request has already been decided.' using errcode = '23514';
  end if;
  if v_request.subject_response is not null then
    raise exception 'You have already answered this request.' using errcode = '23514';
  end if;
  if exists (select 1 from public.guardians where guardian_user_id = auth.uid() and player_id = v_request.target_player_id and state = 'ACTIVE') then
    raise exception 'You are already a guardian of this child.' using errcode = '23514';
  end if;

  if p_response = 'ACCEPT' then
    update public.guardian_link_requests
    set subject_user_id = auth.uid(), subject_response = 'ACCEPTED', subject_responded_at = now()
    where id = p_request_id;
    perform internal.open_additional_guardian_relationship(p_request_id);
    return 'accepted';
  end if;

  update public.guardian_link_requests
  set subject_user_id = auth.uid(), subject_response = 'DECLINED', subject_responded_at = now(),
      status = 'REJECTED', decided_at = now(), decision_note = 'Declined by the person asked to be a guardian.'
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, 'Declined by the person asked to be a guardian.');
  perform internal.emit_security_event('guardian.link_declined', auth.uid(), 'SUCCESS', 'Declined by the person asked to be a guardian.',
    jsonb_build_object('request_id', p_request_id, 'kind', v_request.kind, 'decided_by', 'SUBJECT'),
    v_request.club_id, null, v_request.target_player_id);
  return 'declined';
end;
$$;

create or replace function public.approve_guardian_link_request(p_request_id uuid)
returns table (result text, player_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.guardian_link_requests%rowtype;
  v_player_id uuid;
  v_subject uuid;
  v_season_id uuid;
  v_grade record;
  v_team_id uuid;
  v_team_count integer;
  v_relationship public.guardians;
  v_relationship_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Lock the row so two approvers cannot both act on one request and
  -- produce two guardian relationships or two players.
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null then
    -- Same message for "does not exist" and "not yours to see", so this
    -- cannot be used to probe for request ids.
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  -- An additional guardian is the SUBJECT of the request, never the person
  -- who asked; only a first-child request is about the requester themselves.
  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_subject := r.subject_user_id;
  else
    v_subject := coalesce(r.subject_user_id, r.requested_by_user_id);
  end if;
  if v_subject is null then
    -- An additional-guardian request for someone with no account yet cannot
    -- be completed here; they must accept the invitation and sign in first.
    raise exception 'This person needs to accept their invitation and sign in before the relationship can be approved.';
  end if;
  -- The added adult agrees to it before anyone can approve it (R11).
  if r.kind = 'ADDITIONAL_GUARDIAN' and coalesce(r.subject_response, '') <> 'ACCEPTED' then
    raise exception 'The person asked to be a guardian has not accepted yet.' using errcode = '23514';
  end if;

  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_player_id := r.target_player_id;
  elsif r.matched_player_id is not null then
    -- Existing child: attach to the CANONICAL player. No duplicate is ever
    -- created on this branch -- that is the whole point of matching.
    v_player_id := r.matched_player_id;
  else
    -- No existing child: create the canonical Player now, at approval time,
    -- by a human with real authority -- never at request time.
    insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
    values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
    returning id into v_player_id;

    -- Place them on a team using the existing canonical age-grade domain,
    -- exactly as add_child_for_guardian does. Ambiguity leaves the player
    -- without a membership for the club to resolve, rather than guessing.
    v_season_id := internal.resolve_season_for_date(coalesce(r.rugby_code, 'union'), current_date);
    if v_season_id is not null then
      select * into v_grade from internal.resolve_player_age_grade(coalesce(r.rugby_code, 'union'), v_season_id, r.submitted_date_of_birth);
      if v_grade.status not in ('TOO_YOUNG', 'OUT_OF_YOUTH_RANGE') then
        select count(*) into v_team_count
        from public.teams t
        where t.club_id = r.club_id and t.active = true
          and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
        if v_team_count = 1 then
          select t.id into v_team_id
          from public.teams t
          where t.club_id = r.club_id and t.active = true
            and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
          insert into public.player_team_memberships (player_id, team_id, status, created_by, source, approved_by, approved_at)
          values (v_player_id, v_team_id, 'active', auth.uid(), 'LINK_REQUEST_APPROVAL', auth.uid(), now());
        end if;
      end if;
    end if;
  end if;

  -- The relationship itself: the one this request opened, or a new one. A
  -- relationship already active stays as it is; one on hold is not lifted by
  -- approving a request.
  select * into v_relationship from public.guardians g
  where g.guardian_user_id = v_subject and g.player_id = v_player_id and g.state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')
  for update;
  if v_relationship.state = 'SUSPENDED' then
    raise exception 'This relationship is on hold, so the request cannot be approved.' using errcode = '23514';
  elsif v_relationship.state = 'PENDING_APPROVAL' then
    update public.guardians
    set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), source_request_id = coalesce(source_request_id, p_request_id), updated_by = auth.uid()
    where id = v_relationship.id;
    v_relationship_id := v_relationship.id;
  elsif v_relationship.state = 'ACTIVE' then
    v_relationship_id := v_relationship.id;
  else
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, source_request_id, approved_by, approved_at, created_by)
    values (v_subject, v_player_id, 'guardian', 'active', 'ACTIVE',
            case r.kind when 'ADDITIONAL_GUARDIAN' then 'ADDITIONAL_GUARDIAN_REQUEST' else 'LINK_REQUEST' end,
            p_request_id, auth.uid(), now(), auth.uid())
    returning id into v_relationship_id;
  end if;

  update public.guardian_link_requests
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), resolved_player_id = v_player_id, relationship_id = v_relationship_id
  where id = p_request_id;

  perform internal.emit_security_event('guardian.link_approved', v_subject, 'SUCCESS', null,
    jsonb_build_object('request_id', p_request_id, 'kind', r.kind, 'relationship_id', v_relationship_id),
    r.club_id, null, v_player_id);

  return query select 'approved'::text, v_player_id;
end;
$$;

create or replace function public.reject_guardian_link_request(p_request_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.guardian_link_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  select * into v_request from public.guardian_link_requests glr where glr.id = p_request_id for update;
  if v_request.id is null then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  update public.guardian_link_requests
  set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, v_note);
  perform internal.emit_security_event('guardian.link_declined', coalesce(v_request.subject_user_id, v_request.requested_by_user_id), 'SUCCESS', v_note,
    jsonb_build_object('request_id', p_request_id, 'kind', v_request.kind, 'decided_by', 'APPROVER'),
    v_request.club_id, null, v_request.target_player_id);

  return 'rejected';
end;
$$;

create or replace function public.cancel_guardian_link_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.guardian_link_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null or r.requested_by_user_id <> auth.uid() then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  update public.guardian_link_requests
  set status = 'CANCELLED', decided_at = now(), decision_note = 'Withdrawn by the requester.'
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, 'Withdrawn by the requester.');

  return 'cancelled';
end;
$$;

-- Removes a relationship, or puts it on hold or takes it off hold.
--   REVOKED:   the guardian themselves; or, with a reason, the child's club
--              (club.guardians.manage) or a Full Site Admin.
--   SUSPENDED: a Full Site Admin, with a reason (the Safeguarding Officer and
--              Club Admin joint hold is AN-7, later).
--   ACTIVE:    from SUSPENDED only; a Full Site Admin, with a reason.
create or replace function public.transition_guardian_relationship(p_guardian_id uuid, p_to_state text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.guardians;
  v_self boolean;
  v_club uuid;
  v_club_authority boolean;
  v_site boolean;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_relationship from public.guardians where id = p_guardian_id for update;
  if v_relationship.id is null then
    raise exception 'Guardian relationship not found.' using errcode = 'P0002';
  end if;
  v_self := v_relationship.guardian_user_id = auth.uid();
  v_club := internal.player_event_club(v_relationship.player_id);
  v_club_authority := v_club is not null and internal.has_capability('club.guardians.manage', 'club', v_club, null);
  v_site := internal.is_full_site_admin();

  if p_to_state = 'REVOKED' then
    if not (v_self or v_club_authority or v_site) then
      raise exception 'You are not authorised to remove this relationship.' using errcode = '42501';
    end if;
    if v_relationship.state not in ('ACTIVE', 'SUSPENDED') then
      raise exception 'This relationship is not active, so there is nothing to remove.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, not v_self);
    update public.guardians
    set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = coalesce(v_reason, 'Removed by the guardian'), updated_by = auth.uid()
    where id = p_guardian_id;

  elsif p_to_state = 'SUSPENDED' then
    if not v_site or v_self then
      raise exception 'Only a Full Site Admin can put a guardian relationship on hold.' using errcode = '42501';
    end if;
    if v_relationship.state <> 'ACTIVE' then
      raise exception 'Only an active relationship can be put on hold.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    update public.guardians
    set state = 'SUSPENDED', suspended_at = now(), suspended_by = auth.uid(), suspension_reason = v_reason, updated_by = auth.uid()
    where id = p_guardian_id;

  elsif p_to_state = 'ACTIVE' then
    if v_relationship.state in ('REVOKED', 'DECLINED', 'EXPIRED') then
      raise exception 'An ended guardian relationship cannot be switched back on. Link the guardian again.' using errcode = '23514';
    end if;
    if v_relationship.state <> 'SUSPENDED' then
      raise exception 'This relationship is not on hold.' using errcode = '23514';
    end if;
    if not v_site or v_self then
      raise exception 'Only a Full Site Admin can take a guardian relationship off hold.' using errcode = '42501';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    update public.guardians
    set state = 'ACTIVE', suspended_at = null, suspended_by = null, suspension_reason = null, reason = v_reason, updated_by = auth.uid()
    where id = p_guardian_id;

  else
    raise exception 'A guardian relationship can be removed, put on hold or taken off hold.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.remove_guardian_relationship(p_guardian_id uuid, p_reason text)
returns table (orphaned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.guardians;
  v_club_id uuid;
  v_remaining int;
begin
  select * into g from public.guardians where id = p_guardian_id for update;
  if not found then
    raise exception 'Guardian relationship not found.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to remove a Guardian relationship.';
  end if;

  select t.club_id into v_club_id
  from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
  where ptm.player_id = g.player_id and ptm.state = 'ACTIVE'
  limit 1;

  if v_club_id is null or not internal.has_capability('club.guardians.manage', 'club', v_club_id, null) then
    raise exception 'You are not authorized to manage Guardian relationships for this player.' using errcode = '42501';
  end if;
  if g.state not in ('ACTIVE', 'SUSPENDED') then
    raise exception 'This relationship is not active, so there is nothing to remove.' using errcode = '23514';
  end if;

  update public.guardians
  set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = trim(p_reason), updated_by = auth.uid()
  where id = p_guardian_id;

  select count(*) into v_remaining from public.guardians where player_id = g.player_id and state = 'ACTIVE';

  return query select (v_remaining = 0);
end;
$$;

revoke all on function public.respond_to_additional_guardian_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.transition_guardian_relationship(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_additional_guardian_request(uuid, text) to authenticated, service_role;
grant execute on function public.transition_guardian_relationship(uuid, text, text) to authenticated, service_role;

-- The approval queue and the requester's own list say whether the added
-- adult has answered.
drop function public.guardian_link_requests_for_approval(uuid);
create function public.guardian_link_requests_for_approval(p_club_id uuid default null)
returns table (request_id uuid, kind text, status text, club_id uuid, club_name text, requester_name text, requester_email text,
               submitted_first_name text, submitted_surname text, submitted_date_of_birth date, matched_player_id uuid,
               matched_player_name text, matched_team_name text, target_player_id uuid, target_player_name text,
               invited_email text, created_at timestamptz, subject_response text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.kind,
    r.status,
    r.club_id,
    cd.name,
    coalesce(pr.first_name || ' ' || pr.surname, 'Unknown'),
    pr.email,
    r.submitted_first_name,
    r.submitted_surname,
    r.submitted_date_of_birth,
    r.matched_player_id,
    mp.first_name || ' ' || mp.surname,
    mt.display_name,
    r.target_player_id,
    tp.first_name || ' ' || tp.surname,
    r.invited_email,
    r.created_at,
    r.subject_response
  from public.guardian_link_requests r
  join public.clubs c on c.id = r.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join public.profiles pr on pr.id = r.requested_by_user_id
  left join public.players mp on mp.id = r.matched_player_id
  left join public.players tp on tp.id = r.target_player_id
  left join lateral (
    select t.display_name
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = r.matched_player_id and ptm.state in ('PENDING', 'ACTIVE')
    order by (ptm.state = 'ACTIVE') desc
    limit 1
  ) mt on true
  where r.status = 'PENDING'
    and (p_club_id is null or r.club_id = p_club_id)
    and internal.can_decide_guardian_link_request(r.id)
  order by r.created_at;
$$;

drop function public.my_guardian_link_requests();
create function public.my_guardian_link_requests()
returns table (request_id uuid, kind text, status text, club_id uuid, club_name text, child_label text, created_at timestamptz,
               decided_at timestamptz, requested_by_me boolean, awaiting_my_answer boolean, subject_response text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Note what is absent: matched_player_id, the matched child's real name,
  -- their team, their other guardians, and any confirmation that the
  -- submitted details matched an existing record. A pending row looks
  -- identical whether or not the child exists in Ovalball.
  select
    r.id,
    r.kind,
    r.status,
    r.club_id,
    cd.name,
    coalesce(
      nullif(trim(coalesce(r.submitted_first_name, '') || ' ' || coalesce(r.submitted_surname, '')), ''),
      -- For an additional-guardian request the initiator legitimately
      -- already knows this child, and the adult asked to join them is being
      -- asked about that child by name, so naming them reveals nothing new.
      tp.first_name || ' ' || tp.surname
    ),
    r.created_at,
    r.decided_at,
    r.requested_by_user_id = auth.uid(),
    (r.kind = 'ADDITIONAL_GUARDIAN' and r.status = 'PENDING' and r.subject_response is null
      and r.requested_by_user_id is distinct from auth.uid()
      and (r.subject_user_id = auth.uid()
           or (r.subject_user_id is null and lower(r.invited_email) = lower(coalesce(auth.email(), ''))))),
    r.subject_response
  from public.guardian_link_requests r
  join public.clubs c on c.id = r.club_id
  join public.club_directory cd on cd.id = c.directory_id
  left join public.players tp on tp.id = r.target_player_id
  where r.requested_by_user_id = auth.uid()
     or r.subject_user_id = auth.uid()
     or (r.kind = 'ADDITIONAL_GUARDIAN' and r.subject_user_id is null and r.status = 'PENDING'
         and lower(r.invited_email) = lower(coalesce(auth.email(), '')))
  order by r.created_at desc;
$$;

revoke all on function public.guardian_link_requests_for_approval(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_guardian_link_requests() from public, anon, authenticated, service_role;
grant execute on function public.guardian_link_requests_for_approval(uuid) to authenticated, service_role;
grant execute on function public.my_guardian_link_requests() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Team place transitions
-- ---------------------------------------------------------------------

create or replace function public.approve_pending_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.state <> 'PENDING' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to approve this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships
  set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
  where id = p_membership_id;

  select p.first_name into v_player_first_name from public.players p where p.id = m.player_id;

  -- EVERY legitimate recipient, not the earliest-created guardian. One parent
  -- being told and the other not was never a decision anybody made -- it was
  -- an `order by created_at asc limit 1` nobody revisited.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_approved', 'Team join confirmed',
         case when e.relationship = 'self'
              then 'You have been confirmed onto the team.'
              else v_player_first_name || ' has been confirmed onto the team.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$$;

create or replace function public.reject_pending_team_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.player_team_memberships;
  v_club_id uuid;
  v_player_first_name text;
begin
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership request not found.';
  end if;
  if m.state <> 'PENDING' then
    raise exception 'This request has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = m.team_id;
  if v_club_id is null or not (internal.has_capability('team.roster.manage', 'team', v_club_id, m.team_id) or internal.has_capability('club.roster.manage', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to reject this request.' using errcode = '42501';
  end if;

  update public.player_team_memberships
  set state = 'DECLINED', ended_by = auth.uid(), end_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = auth.uid()
  where id = p_membership_id;

  select p.first_name into v_player_first_name from public.players p where p.id = m.player_id;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'add_child_declined', 'Team join declined',
         case when e.relationship = 'self'
              then 'Your team join request was declined by the club.'
              else v_player_first_name || '''s team join request was declined by the club.' end,
         jsonb_build_object('player_id', m.player_id)
  from internal.player_contact_eligibility(array[m.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$$;

create or replace function public.archive_player_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_state text;
  v_may_manage boolean;
begin
  select team_id, state into v_team_id, v_state
  from public.player_team_memberships where id = p_membership_id
  for update;
  if v_team_id is null then
    raise exception 'That player is not in this team.';
  end if;

  select a.may_manage into v_may_manage from internal.team_people_authority(v_team_id) a;
  if not coalesce(v_may_manage, false) then
    raise exception 'Not authorized to change this team''s roster.' using errcode = '42501';
  end if;

  if v_state = 'PENDING' then
    raise exception 'That is a request to join, not a place in the team. Decline it instead.' using errcode = '23514';
  end if;
  if v_state in ('ENDED', 'DECLINED') then
    return; -- Already archived. Saying so twice is not an error.
  end if;

  update public.player_team_memberships
  set state = 'ENDED', ended_by = auth.uid(), end_reason = 'Archived from team people', updated_by = auth.uid(), updated_at = now()
  where id = p_membership_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_team_memberships', p_membership_id, 'update', auth.uid(),
          jsonb_build_object('status', 'ended', 'reason', 'archived_from_team_people'));
end;
$$;

-- Restoring an archived player gives them a new place in the team; the
-- archived place stays as the history of the one that ended.
create or replace function public.restore_player_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_player_id uuid;
  v_state text;
  v_may_manage boolean;
  v_new uuid;
begin
  select team_id, player_id, state into v_team_id, v_player_id, v_state
  from public.player_team_memberships where id = p_membership_id;
  if v_team_id is null then
    raise exception 'That player is not in this team.';
  end if;

  select a.may_manage into v_may_manage from internal.team_people_authority(v_team_id) a;
  if not coalesce(v_may_manage, false) then
    raise exception 'Not authorized to change this team''s roster.' using errcode = '42501';
  end if;

  if v_state <> 'ENDED' then
    return;
  end if;

  -- A player can hold only one active place in a team. If they were archived
  -- and then re-added by another route, that newer row is the real one.
  if exists (
    select 1 from public.player_team_memberships
    where team_id = v_team_id and player_id = v_player_id and state = 'ACTIVE'
  ) then
    raise exception 'That player is already in this team.' using errcode = '23505';
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, state, source, reason, created_by, updated_by, granted_by)
  values (v_player_id, v_team_id, 'active', 'ACTIVE', 'TEAM_READMISSION', 'Restored from team people', auth.uid(), auth.uid(), auth.uid())
  returning id into v_new;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_team_memberships', v_new, 'insert', auth.uid(),
          jsonb_build_object('status', 'active', 'reason', 'restored_from_team_people', 'restored_from_membership_id', p_membership_id));
end;
$$;

-- Moves a player's current place from one team to another: the old place
-- ends and a new one opens, in one transaction, with the authority of both
-- teams. The row lock serialises against respond_to_attendance (R20).
create or replace function public.move_player_team_membership(p_membership_id uuid, p_target_team_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.player_team_memberships;
  v_target public.teams;
  v_from_manage boolean;
  v_to_manage boolean;
  v_reason text;
  v_new uuid;
  v_from_club uuid;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into m from public.player_team_memberships where id = p_membership_id for update;
  if m.id is null then
    raise exception 'That player is not in this team.' using errcode = 'P0002';
  end if;
  select a.may_manage into v_from_manage from internal.team_people_authority(m.team_id) a;
  select * into v_target from public.teams where id = p_target_team_id;
  select a.may_manage into v_to_manage from internal.team_people_authority(p_target_team_id) a;
  if not coalesce(v_from_manage, false) or not coalesce(v_to_manage, false) or v_target.id is null then
    raise exception 'Moving a player needs authority over both teams.' using errcode = '42501';
  end if;
  if m.state <> 'ACTIVE' then
    raise exception 'Only a current team place can be moved.' using errcode = '23514';
  end if;
  if p_target_team_id = m.team_id then
    raise exception 'Choose a different team.' using errcode = '22023';
  end if;
  if not v_target.active then
    raise exception 'That team is archived.' using errcode = '23514';
  end if;
  if exists (select 1 from public.player_team_memberships where player_id = m.player_id and team_id = p_target_team_id and state = 'ACTIVE') then
    raise exception 'That player is already in the other team.' using errcode = '23505';
  end if;
  v_reason := internal.require_reason(p_reason, false);

  perform pg_catalog.set_config('ovalball.player_team_move', 'on', true);
  update public.player_team_memberships
  set state = 'ENDED', ended_by = auth.uid(), end_reason = coalesce(v_reason, 'Moved to another team'), updated_by = auth.uid()
  where id = p_membership_id;
  insert into public.player_team_memberships (player_id, team_id, status, state, source, reason, created_by, updated_by, granted_by)
  values (m.player_id, p_target_team_id, 'active', 'ACTIVE', 'TEAM_MOVE', v_reason, auth.uid(), auth.uid(), auth.uid())
  returning id into v_new;
  perform pg_catalog.set_config('ovalball.player_team_move', '', true);

  select club_id into v_from_club from public.teams where id = m.team_id;
  perform internal.emit_security_event('player_team.moved', null, 'SUCCESS', v_reason,
    jsonb_build_object('from_team_membership_id', p_membership_id, 'to_team_membership_id', v_new,
                       'from_team_id', m.team_id, 'to_team_id', p_target_team_id, 'to_club_id', v_target.club_id),
    v_from_club, m.team_id, m.player_id);
  return v_new;
end;
$$;

revoke all on function public.move_player_team_membership(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.move_player_team_membership(uuid, uuid, text) to authenticated, service_role;

create or replace function public.respond_to_attendance(p_fixture_id uuid, p_player_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Invalid attendance status.';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);

  -- The player's place in a team involved in this fixture is locked for the
  -- response, so a concurrent move decides it one way or the other (R20).
  perform 1
  from public.fixtures f
  join public.player_team_memberships ptm
    on ptm.player_id = p_player_id and ptm.state = 'ACTIVE' and ptm.team_id in (f.home_team_id, f.away_team_id)
  where f.id = p_fixture_id
  for share of ptm;
  if not found then
    raise exception 'This player is not associated with a team involved in this fixture.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (p_fixture_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (fixture_id, player_id) do update
    set status = excluded.status, responded_by_user_id = excluded.responded_by_user_id, response_source = excluded.response_source, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Existing writers record where a relationship or team place came from
-- ---------------------------------------------------------------------
-- Bodies unchanged except for the source (and invitation) recorded on
-- their inserts, and invitation or duplicate links leaving any open
-- relationship (awaiting approval, active or on hold) as it is.

create or replace function public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_norm record;
  v_candidate_team_count integer;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  -- Required at registration, and enforced here rather than in the browser.
  -- Asked once, now: every child eventually reaches the age where the boys'
  -- and girls' pathways separate, and at that point Ovalball must not have to
  -- guess -- nor infer it from whichever team they happen to have joined.
  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE', 'FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- INVITE-ONLY GUARD (Phase B).
  --
  -- Previously this function guarded only on "is signed in" and "club
  -- exists", then created a players row, a guardians row and a pending
  -- player_team_memberships row at ANY active club. That let an unrelated
  -- signed-in person invent a child at a club they have nothing to do with
  -- and declare themselves its guardian. The pending status meant no team
  -- authority followed, but the identity records were still created.
  --
  -- A guardian must now already have an authorised relationship with THIS
  -- club, by one of three routes:
  --
  --   1. they accepted a guardian invitation from this club
  --      (the canonical way a new parent arrives);
  --   2. they already guardian a player at this club
  --      (an existing parent adding a second child -- this is why existing
  --      users are not disrupted);
  --   3. they hold an active club membership here
  --      (club staff who are also a parent).
  --
  -- Authority is derived server-side from stable IDs. Nothing here trusts a
  -- club id merely because the client sent one.
  if not (
    exists (
      select 1 from public.guardian_invitations gi
      where gi.club_id = p_club_id
        and gi.accepted_by = auth.uid()
        and gi.status = 'accepted'
    )
    or exists (
      select 1
      from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id
      join public.teams t on t.id = ptm.team_id
      where g.guardian_user_id = auth.uid()
        and t.club_id = p_club_id
    )
    or exists (
      select 1 from public.club_memberships cm
      where cm.user_id = auth.uid()
        and cm.club_id = p_club_id
        and cm.status = 'active'
    )
  ) then
    raise exception 'You need an invitation from this club before you can add a child to it.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status in ('pending', 'active')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;
  if v_existing_player_id is not null then
    return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count >= 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  if v_match_count = 1 then
    select ptm.team_id into v_match_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = v_match_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_new_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source)
  values (auth.uid(), v_new_player_id, 'guardian', auth.uid(), 'SELF_ADDED_CHILD');

  -- Which team this child belongs in is decided by their own regulatory
  -- allocation, not by an age label. Matching on category + age_group alone
  -- found the club's BOYS U12 for a girl and proposed it -- only the
  -- membership guard stopped it being written. The canonical identity carries
  -- the pathway, so searching by it cannot land in the wrong branch.
  select * into v_norm from public.resolve_normal_operational_identity(
    p_rugby_code,
    internal.resolve_season_for_date(p_rugby_code, current_date),
    p_date_of_birth,
    upper(p_playing_pathway));

  if v_norm.canonical_team_type_id is null then
    -- No identity to place them in yet -- the club reviews it rather than
    -- Ovalball choosing a near-enough team.
    v_candidate_team_id := null;
    v_result := 'created_needs_club_review';
  else
    select count(*) into v_candidate_team_count
    from public.teams t
    where t.club_id = p_club_id and t.active = true
      and t.canonical_team_type_id = v_norm.canonical_team_type_id;

    if v_candidate_team_count = 1 then
      select t.id into v_candidate_team_id
      from public.teams t
      where t.club_id = p_club_id and t.active = true
        and t.canonical_team_type_id = v_norm.canonical_team_type_id;

      insert into public.player_team_memberships (player_id, team_id, status, state, created_by, source)
      values (v_new_player_id, v_candidate_team_id, 'pending', 'PENDING', auth.uid(), 'GUARDIAN_ADDED_CHILD');
      v_result := 'created_pending_team';
    else
      v_candidate_team_id := null;
      v_result := 'created_needs_club_review';
    end if;
  end if;

  return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$function$;

create or replace function public.create_player_for_guardian(p_guardian_invitation_id uuid, p_first_name text, p_surname text, p_date_of_birth date, p_playing_pathway text DEFAULT NULL::text)
 RETURNS TABLE(result text, player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv public.guardian_invitations;
  v_match_player_id uuid;
  v_player_id uuid;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_surname), '') = '' then
    raise exception 'First name and surname are required.';
  end if;

  select ptm.player_id into v_match_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = inv.team_id
    and ptm.status = 'active'
    and lower(p.first_name) = lower(trim(p_first_name))
    and lower(p.surname) = lower(trim(p_surname))
    and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;

  if v_match_player_id is not null then
    insert into public.player_duplicate_reviews (guardian_invitation_id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by)
    values (inv.id, inv.team_id, trim(p_first_name), trim(p_surname), p_date_of_birth, v_match_player_id, auth.uid());
    return query select 'under_review'::text, null::uuid;
    return;
  end if;

  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE','FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (trim(p_first_name), trim(p_surname), p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), v_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id);

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  values (v_player_id, inv.team_id, auth.uid(), 'GUARDIAN_INVITATION');

  return query select 'created'::text, v_player_id;
end;
$function$;

create or replace function public.link_guardian_to_existing_player(p_guardian_invitation_id uuid, p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv public.guardian_invitations;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if not found or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid() then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if inv.replacement_for_player_id is null or inv.replacement_for_player_id <> p_player_id then
    raise exception 'This invitation is not for that player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = inv.team_id and status = 'active') then
    raise exception 'That player is not on the invited team.' using errcode = '42501';
  end if;

  -- An open relationship (active, awaiting approval or on hold) is left as it
  -- is: an invitation never lifts a hold or skips a pending decision.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), p_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id)
  on conflict do nothing;
end;
$function$;

create or replace function public.resolve_player_duplicate_review_as_existing(p_review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.player_duplicate_reviews;
  v_club_id uuid;
  v_submitter uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = r.team_id;
  if v_club_id is null or not (internal.has_capability('team.guardians.invite', 'team', v_club_id, r.team_id) or internal.has_capability('team.guardians.invite', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to resolve this review.' using errcode = '42501';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (v_submitter, r.matched_player_id, 'guardian', auth.uid(), 'DUPLICATE_RESOLUTION', r.guardian_invitation_id)
  on conflict do nothing;

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  select r.matched_player_id, r.team_id, auth.uid(), 'DUPLICATE_RESOLUTION'
  where not exists (
    select 1 from public.player_team_memberships where player_id = r.matched_player_id and team_id = r.team_id and status = 'active'
  );

  update public.player_duplicate_reviews set status = 'linked_existing', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;
end;
$function$;

create or replace function public.resolve_player_duplicate_review_as_new(p_review_id uuid)
 RETURNS TABLE(player_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.player_duplicate_reviews;
  v_club_id uuid;
  v_submitter uuid;
  v_player_id uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.';
  end if;

  select club_id into v_club_id from public.teams where id = r.team_id;
  if v_club_id is null or not (internal.has_capability('team.guardians.invite', 'team', v_club_id, r.team_id) or internal.has_capability('team.guardians.invite', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to resolve this review.' using errcode = '42501';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (v_submitter, v_player_id, 'guardian', auth.uid(), 'DUPLICATE_RESOLUTION', r.guardian_invitation_id);

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  values (v_player_id, r.team_id, auth.uid(), 'DUPLICATE_RESOLUTION');

  update public.player_duplicate_reviews set status = 'created_new', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;

  return query select v_player_id;
end;
$function$;

create or replace function public.approve_player_club_join_request(p_request_id uuid, p_team_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  r public.player_club_join_requests;
  v_team public.teams;
  v_player public.players;
  v_club_name text;
begin
  -- The lock is the whole mechanism. Two managers on the same request serialise
  -- here, and the second one finds it no longer pending.
  select * into r from public.player_club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0001';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null or v_team.club_id <> r.club_id then
    raise exception 'Choose one of this club''s own teams.' using errcode = '23514';
  end if;
  if not v_team.active then
    raise exception 'That team is not active.' using errcode = '23514';
  end if;

  if not internal.may_resolve_join_request(r.club_id, p_team_id) then
    raise exception 'You are not authorized to resolve this request.' using errcode = '42501';
  end if;

  -- Nobody resolves their own request, whatever else they hold.
  select * into v_player from public.players where id = r.player_id;
  if v_player.user_id = auth.uid()
     or exists (select 1 from public.guardians g where g.player_id = r.player_id
                and g.guardian_user_id = auth.uid() and g.status = 'active') then
    raise exception 'You cannot approve a request for your own player.' using errcode = '42501';
  end if;

  -- The membership is created through the ordinary table, so the central
  -- compatibility guard runs exactly as it does everywhere else. Approval is
  -- not a way round it: a manager cannot place a player into a team the
  -- governing rules do not permit.
  insert into public.player_team_memberships (player_id, team_id, status, created_by, source, approved_by, approved_at)
  values (r.player_id, p_team_id, 'active', auth.uid(), 'PLAYER_JOIN_REQUEST', auth.uid(), now());

  update public.player_club_join_requests
  set status = 'approved', placed_team_id = p_team_id, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_club_join_requests', p_request_id, 'update', auth.uid(),
          jsonb_build_object('status', 'approved', 'placed_team_id', p_team_id));

  select cd.name into v_club_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = r.club_id;

  -- TELL WHOEVER MAY LEGITIMATELY BE TOLD. This used to notify the player
  -- directly whenever they had a login, with no age or consent test -- so a
  -- child who asked to join a club heard back directly from it. The wording
  -- is recipient-relative, because "You have been accepted" and "Priya has
  -- been accepted" are the same fact told to two different people.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct on (e.user_id) e.user_id, 'club_join_approved',
         case when e.relationship = 'self' then 'You have been accepted' else 'Join request accepted' end,
         case when e.relationship = 'self'
              then format('%s have accepted you. You are now in %s.', v_club_name, v_team.display_name)
              else format('%s has been accepted into %s.', v_player.first_name, v_team.display_name) end,
         jsonb_build_object('player_id', r.player_id, 'team_id', p_team_id)
  from internal.player_contact_eligibility(array[r.player_id]) e
  where e.user_id is not null
  order by e.user_id, (e.relationship = 'self') desc;
end;
$function$;

create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q public.player_graduation_queue;
  v_target public.teams;
  v_dob date;
  v_is_adult boolean;
  v_has_approved_dispensation boolean;
  v_season_id uuid;
  v_player_age integer;
  v_target_age integer;
  v_label text;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select * into v_target from public.teams where id = p_target_team_id;
  if v_target.club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.has_capability('place_graduating_players', 'team', q.club_id, p_target_team_id)
          or internal.has_capability('place_graduating_players', 'club', q.club_id)) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  select date_of_birth into v_dob from public.players where id = q.player_id;

  if v_target.category = 'senior' then
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot verify they are old enough for adult rugby. Record their date of birth before placing them on a senior team.' using errcode = '23514';
    end if;

    v_is_adult := v_dob <= (current_date - interval '18 years')::date;

    if not v_is_adult then
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = q.player_id
          and d.target_team_id = p_target_team_id
          and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_approved_dispensation;

      if not v_has_approved_dispensation then
        raise exception 'This player is under 18 and cannot be placed on a senior team without an approved governing-body dispensation on file for this exact player and team. Request a dispensation first (Season Handover -> Dispensations) and have the club record the governing body''s approval reference once granted -- Ovalball records that approval, it does not grant it on the governing body''s behalf.' using errcode = '23514';
      end if;
    end if;

  elsif v_target.category = 'youth' and v_target.age_group is not null then
    -- The direction that was unguarded. An adult must not land in a youth
    -- squad because the graduation list happened to offer one.
    if v_dob is null then
      raise exception 'This player has no recorded date of birth -- Ovalball cannot check they are the right age for %. Record their date of birth before placing them on an age-banded team.',
        v_target.display_name using errcode = '23514';
    end if;

    v_season_id := internal.resolve_season_for_date(v_target.rugby_code, current_date);
    if v_season_id is null then
      raise exception 'No % season covers today, so Ovalball cannot work out this player''s age grade. Set up the current season before placing graduating players.',
        v_target.rugby_code using errcode = '23514';
    end if;

    select regulatory_age_number, regulatory_age_label into v_player_age, v_label
    from public.resolve_player_regulatory_age(v_target.rugby_code, v_season_id, v_dob);

    v_target_age := nullif(regexp_replace(v_target.age_group, '\D', '', 'g'), '')::integer;

    if v_player_age is not null and v_target_age is not null and v_player_age > v_target_age then
      select exists (
        select 1 from public.player_team_dispensation d
        where d.player_id = q.player_id
          and d.target_team_id = p_target_team_id
          and d.status = 'approved'
          and d.governing_body_reference is not null
      ) into v_has_approved_dispensation;

      if not v_has_approved_dispensation then
        raise exception 'This player is % this season and would be over-age for %. Placing an older player into a younger age band needs an approved governing-body dispensation on file for this exact player and team. Playing up an age group does not -- only playing down.',
          v_label, v_target.display_name using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by, source)
  values (q.player_id, p_target_team_id, 'active', auth.uid(), 'GRADUATION');

  -- The cohort they graduated from is archived; leaving the membership active
  -- left an archived team holding live members and double-counted the player.
  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = auth.uid()
  where player_id = q.player_id and team_id = q.source_team_id and status = 'active';

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$function$;

create or replace function internal.apply_season_handover_core(p_rollover_id uuid, p_expected_revision integer, p_actor uuid)
 RETURNS TABLE(already_applied boolean, teams_progressed integer, teams_folded integer, teams_graduated integer, teams_created integer, teams_reactivated integer, players_moved integer, players_held integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.age_grade_rollovers;
  v_blocker record;
  v_blockers integer := 0;
  v_first_blocker text;
  v_p record;
  v_pt record;
  v_team public.teams;
  v_squad text;
  v_gender text;
  v_target uuid;
  v_progressed integer := 0;
  v_folded integer := 0;
  v_graduated integer := 0;
  v_created integer := 0;
  v_reactivated integer := 0;
  v_moved integer := 0;
  v_held integer := 0;
  v_pass integer := 0;
  v_applied_this_pass integer;
  v_remaining integer;
  v_stuck text;
  v_actor uuid := p_actor;
begin
  -- A. Lock the handover. Every decision function takes this same row lock, so
  --    a decision cannot interleave with an Apply that is already reading it.
  select * into r from public.age_grade_rollovers where id = p_rollover_id for update;
  if not found then raise exception 'Handover not found.'; end if;

  -- C. Already done. Idempotent by design: a double click, a retried request
  --    or a resent form gets the same answer and does no work.
  if r.applied_at is not null then
    return query select true, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  -- D. The reviewer read a particular set of decisions. If someone else has
  --    changed one since, applying silently would apply something nobody
  --    reviewed.
  if p_expected_revision is not null and p_expected_revision <> r.decisions_revision then
    raise exception 'These decisions have changed since you reviewed them. Reload the handover and check what is different before applying.'
      using errcode = 'P0001';
  end if;

  -- E. Revalidate everything, from live state.
  for v_blocker in select * from internal.handover_apply_blockers_core(p_rollover_id) loop
    v_blockers := v_blockers + 1;
    if v_first_blocker is null then
      v_first_blocker := v_blocker.subject || ': ' || v_blocker.detail;
    end if;
  end loop;
  if v_blockers > 0 then
    raise exception 'This handover cannot be applied yet -- % item(s) still need resolving. First: %', v_blockers, v_first_blocker
      using errcode = 'P0001';
  end if;

  update public.season_transitions
  set status = 'applying', updated_at = now()
  where rollover_id = p_rollover_id and status <> 'completed';

  -- 2. End the cohorts that are not continuing. Done first: it frees their
  --    canonical identities and closes their memberships before anything
  --    tries to take either.
  for v_p in
    -- Squads before their primary: the schema refuses to deactivate a primary
    -- while a B or C squad at that level is still live.
    select p.* from public.age_grade_rollover_team_proposals p
    join public.teams t on t.id = p.team_id
    where p.rollover_id = p_rollover_id and p.decision = 'graduated' and p.applied_at is null
    order by t.squad_designation desc nulls last
  loop
    select * into v_team from public.teams where id = v_p.team_id;
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;
    if v_team.active then
      perform internal.graduate_team_core(v_p.team_id, v_actor);
    end if;
    update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
    v_graduated := v_graduated + 1;
  end loop;

  for v_p in
    select p.* from public.age_grade_rollover_team_proposals p
    join public.teams t on t.id = p.team_id
    where p.rollover_id = p_rollover_id and p.decision = 'folded' and p.applied_at is null
    order by t.squad_designation desc nulls last
  loop
    select * into v_team from public.teams where id = v_p.team_id;
    if r.from_season_id is not null then
      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
      on conflict (team_id, season_id) do nothing;
    end if;
    if v_team.active then
      perform internal.fold_team_core(v_p.team_id, coalesce(v_p.fold_reason, 'Not continuing next season.'), v_actor);
    end if;
    update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
    v_folded := v_folded + 1;
  end loop;

  -- 3. Progress the continuing teams, by relaxation. See the header: any fixed
  --    ordering assumes age grades only rise, and Adjust can break that.
  loop
    v_pass := v_pass + 1;
    v_applied_this_pass := 0;

    for v_p in
      select * from public.age_grade_rollover_team_proposals
      where rollover_id = p_rollover_id and decision = 'confirmed' and applied_at is null
      order by (decided_squad_designation is null) desc, decided_age_group desc nulls last
    loop
      select * into v_team from public.teams where id = v_p.team_id;
      v_squad := coalesce(v_p.decided_squad_designation, v_team.squad_designation);
      v_gender := coalesce(v_p.decided_gender, v_team.gender);

      -- Is the destination free right now?
      if exists (
        select 1 from public.teams t2
        where t2.club_id = v_team.club_id and t2.active and t2.id <> v_team.id
          and t2.canonical_team_type_id = v_p.decided_canonical_team_type_id
          and coalesce(t2.squad_designation, '') = coalesce(v_squad, '')
      ) then
        continue;
      end if;

      -- A B or C squad cannot become active at a level before its primary is
      -- there. Skipping rather than failing is the point of the relaxation
      -- loop: the primary moves this pass, the squad follows on the next.
      if v_squad in ('B', 'C') and not exists (
        select 1 from public.teams t3
        where t3.club_id = v_team.club_id and t3.active
          and t3.canonical_team_type_id = v_p.decided_canonical_team_type_id
          and t3.squad_designation is null
      ) then
        continue;
      end if;

      if r.from_season_id is not null then
        insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
        values (v_team.id, r.from_season_id, v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name)
        on conflict (team_id, season_id) do nothing;
      end if;

      update public.teams
      set age_group = v_p.decided_age_group,
          squad_designation = v_squad,
          gender = v_gender,
          -- The team's own code, not the union default: a Rugby League side
          -- progressed by the handover must not come out named the union way.
          display_name = internal.compute_team_display_name('youth', v_p.decided_age_group, v_gender, v_squad, v_team.rugby_code),
          updated_by = v_actor
      where id = v_p.team_id;

      insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
      select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
      from public.teams where id = v_p.team_id
      on conflict (team_id, season_id) do nothing;

      insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
      values ('teams', v_p.team_id, 'update', v_actor,
        jsonb_build_object('age_group', v_p.current_age_group, 'gender', v_team.gender),
        jsonb_build_object('event', 'HANDOVER_TEAM_PROGRESSED', 'rollover_id', r.id,
                           'age_group', v_p.decided_age_group, 'gender', v_gender,
                           'squad_designation', v_squad, 'target_season_id', r.to_season_id));

      update public.age_grade_rollover_team_proposals set applied_at = now() where id = v_p.id;
      v_progressed := v_progressed + 1;
      v_applied_this_pass := v_applied_this_pass + 1;
    end loop;

    select count(*) into v_remaining from public.age_grade_rollover_team_proposals
    where rollover_id = p_rollover_id and decision = 'confirmed' and applied_at is null;

    exit when v_remaining = 0;

    if v_applied_this_pass = 0 then
      select string_agg(t.display_name, ', ') into v_stuck
      from public.age_grade_rollover_team_proposals p
      join public.teams t on t.id = p.team_id
      where p.rollover_id = p_rollover_id and p.decision = 'confirmed' and p.applied_at is null;
      raise exception 'These teams are waiting on each other''s identities and cannot all move: %. Change one of their destinations and apply again -- nothing has been changed.', v_stuck
        using errcode = 'P0001';
    end if;
    if v_pass > 50 then
      raise exception 'The handover could not settle the team progressions. Nothing has been changed.' using errcode = 'P0001';
    end if;
  end loop;

  -- 4. Create the planned teams. The identities they need were vacated in
  --    step 3, which is the whole reason planning existed.
  for v_pt in
    select * from public.age_grade_rollover_planned_teams
    where rollover_id = p_rollover_id and applied_at is null
    order by squad_designation nulls first
  loop
    v_target := internal.apply_planned_team(v_pt.id, v_actor);
    if (select reactivated from public.age_grade_rollover_planned_teams where id = v_pt.id) then
      v_reactivated := v_reactivated + 1;
    else
      v_created := v_created + 1;
    end if;

    insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
    select id, r.to_season_id, category, age_group, squad_designation, gender, display_name
    from public.teams where id = v_target
    on conflict (team_id, season_id) do nothing;

    if v_pt.origin = 'MIXED_SPLIT' and v_pt.source_proposal_id is not null then
      update public.age_grade_rollover_team_proposals
      set girls_team_created = true, girls_team_id = v_target where id = v_pt.source_proposal_id;
    elsif v_pt.origin = 'U6_INTAKE' and v_pt.source_proposal_id is not null then
      update public.age_grade_rollover_team_proposals
      set intake_team_created = true, intake_team_id = v_target where id = v_pt.source_proposal_id;
    end if;
  end loop;

  -- 6. Move the players. The membership pathway guard is authoritative here as
  --    everywhere else -- if a placement is not compatible it raises, and the
  --    whole handover rolls back rather than half-moving a cohort.
  for v_p in
    select * from public.age_grade_rollover_player_proposals
    where rollover_id = p_rollover_id and placement_applied_at is null
    order by player_id
  loop
    if v_p.allocation_status = 'CLUB_HOLDING' then
      -- Youth pathway complete. No adult team is assigned by Ovalball.
      insert into public.player_graduation_queue (player_id, source_team_id, club_id)
      values (v_p.player_id, v_p.current_team_id, r.club_id)
      on conflict do nothing;
      update public.player_team_memberships
      set status = 'ended', ended_at = now(), updated_by = v_actor
      where player_id = v_p.player_id and team_id = v_p.current_team_id and status = 'active';
      v_held := v_held + 1;
    else
      v_target := coalesce(
        v_p.selected_team_id,
        (select created_team_id from public.age_grade_rollover_planned_teams where id = v_p.planned_team_id),
        v_p.proposed_team_id);

      if v_target is not null and v_target is distinct from v_p.current_team_id then
        update public.player_team_memberships
        set status = 'ended', ended_at = now(), updated_by = v_actor
        where player_id = v_p.player_id and team_id = v_p.current_team_id and status = 'active';

        insert into public.player_team_memberships (player_id, team_id, status, created_by, source)
        values (v_p.player_id, v_target, 'active', v_actor, 'SEASON_HANDOVER')
        on conflict do nothing;
        v_moved := v_moved + 1;
      end if;
    end if;

    update public.age_grade_rollover_player_proposals
    set placement_applied_at = now() where id = v_p.id;

    insert into public.audit_log (table_name, record_id, action, changed_by, after)
    values ('age_grade_rollover_player_proposals', v_p.id, 'update', v_actor,
      jsonb_build_object('event', 'HANDOVER_PLACEMENT_APPLIED', 'rollover_id', r.id,
                         'player_id', v_p.player_id, 'from_team_id', v_p.current_team_id,
                         'to_team_id', case when v_p.allocation_status = 'CLUB_HOLDING' then null else v_target end,
                         'club_holding', v_p.allocation_status = 'CLUB_HOLDING',
                         'target_season_id', r.to_season_id));
  end loop;

  -- 7. Done.
  update public.age_grade_rollovers
  set applied_at = now(), applied_by = v_actor where id = p_rollover_id;

  update public.season_transitions
  set status = 'completed', applied_at = now(), needs_attention_reason = null, last_error = null, updated_at = now()
  where rollover_id = p_rollover_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('age_grade_rollovers', p_rollover_id, 'update', v_actor,
    jsonb_build_object('event', 'SEASON_HANDOVER_APPLIED', 'club_id', r.club_id,
                       'rugby_code', r.rugby_code, 'from_season_id', r.from_season_id,
                       'to_season_id', r.to_season_id,
                       'teams_progressed', v_progressed, 'teams_folded', v_folded,
                       'teams_graduated', v_graduated, 'teams_created', v_created,
                       'teams_reactivated', v_reactivated,
                       'players_moved', v_moved, 'players_held', v_held,
                       'decisions_revision', r.decisions_revision));

  return query select false, v_progressed, v_folded, v_graduated, v_created, v_reactivated, v_moved, v_held;
end;
$function$;
