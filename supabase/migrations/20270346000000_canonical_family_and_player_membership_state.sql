-- Canonical family relationships and player team memberships.
--
-- Identity/Auth Slice 2 (Phase 2 design N, M.3, Y.9, Y.10, AF).
--
-- A guardian relationship was a row with `status` active or revoked and
-- nothing else: no record of how it came to exist, who approved it, whether
-- it was ever put on hold, or who ended it and why. A player's place in a
-- team had the same shape.
--
-- After this migration:
--
--   * `guardians.state` is canonical: PENDING_APPROVAL, ACTIVE, SUSPENDED,
--     REVOKED, DECLINED, EXPIRED. Only ACTIVE confers family access (FR-1:
--     the legacy `status` is 'active' only for ACTIVE rows). REVOKED, DECLINED
--     and EXPIRED are terminal, and at most one open relationship exists per
--     guardian and player (FR-2). A guardian can never be linked to their own
--     player record. Every row records its source, approval, verification,
--     hold and removal.
--   * `player_team_memberships.state` is canonical: PENDING, ACTIVE, ENDED,
--     DECLINED. ENDED and DECLINED are terminal; re-adding a player creates a
--     new row. Every row records its source and who ended it and why.
--   * An additional-guardian request records the added person's own answer,
--     because a club may approve it only after that person has accepted.
--   * Existing rows are backfilled without inventing anything: provenance is
--     recorded only where a request, invitation or duplicate resolution
--     proves it, otherwise LEGACY_BACKFILL, and verification is UNVERIFIED.
--
-- Transition RPCs arrive in a following migration.

-- ---------------------------------------------------------------------
-- 1. guardians
-- ---------------------------------------------------------------------

alter table public.guardians
  add column state text,
  add column source text,
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column verification_state text,
  add column reason text,
  add column suspended_by uuid,
  add column suspended_at timestamptz,
  add column suspension_reason text,
  add column confidential boolean not null default false,
  add column revoked_by uuid,
  add column revoked_at timestamptz,
  add column revocation_reason text,
  add column source_request_id uuid,
  add column source_invitation_id uuid;

comment on column public.guardians.state is
  'Canonical relationship state (Phase 2 N.1). Only ACTIVE confers any family-derived access; the legacy status column is maintained from it.';

update public.guardians g
set state = case g.status when 'active' then 'ACTIVE' else 'REVOKED' end,
    verification_state = 'UNVERIFIED';

with evidence as (
  select g.id,
    (select r.id from public.guardian_link_requests r
      where r.status = 'APPROVED' and r.resolved_player_id = g.player_id
        and g.guardian_user_id = case when r.kind = 'ADDITIONAL_GUARDIAN' then r.subject_user_id else coalesce(r.subject_user_id, r.requested_by_user_id) end
      order by r.decided_at desc nulls last limit 1) as request_id,
    (select i.id from public.guardian_invitations i
      where i.status = 'accepted' and i.accepted_by = g.guardian_user_id and i.replacement_for_player_id = g.player_id
      order by i.accepted_at desc nulls last limit 1) as invitation_id,
    (select d.id from public.player_duplicate_reviews d
      where d.status = 'linked_existing' and d.matched_player_id = g.player_id
        and coalesce(d.requesting_guardian_user_id, d.submitted_by) = g.guardian_user_id
      order by d.resolved_at desc nulls last limit 1) as duplicate_id
  from public.guardians g
)
update public.guardians g
set source = case
      when e.request_id is not null then case (select r.kind from public.guardian_link_requests r where r.id = e.request_id)
                                          when 'ADDITIONAL_GUARDIAN' then 'ADDITIONAL_GUARDIAN_REQUEST' else 'LINK_REQUEST' end
      when e.invitation_id is not null then 'GUARDIAN_INVITATION'
      when e.duplicate_id is not null then 'DUPLICATE_RESOLUTION'
      else 'LEGACY_BACKFILL'
    end,
    source_request_id = e.request_id,
    source_invitation_id = case when e.request_id is null then e.invitation_id end,
    approved_by = (select r.decided_by from public.guardian_link_requests r where r.id = e.request_id),
    approved_at = (select r.decided_at from public.guardian_link_requests r where r.id = e.request_id)
from evidence e
where e.id = g.id;

update public.guardians g
set revoked_at = coalesce((
      select max(a.changed_at) from public.audit_log a
      where a.table_name = 'guardians' and a.record_id = g.id and a.action = 'update'
        and a.after ->> 'status' = 'revoked' and coalesce(a.before ->> 'status', '') <> 'revoked'
    ), now()),
    revoked_by = coalesce((
      select a.changed_by from public.audit_log a
      where a.table_name = 'guardians' and a.record_id = g.id and a.action = 'update'
        and a.after ->> 'status' = 'revoked' and coalesce(a.before ->> 'status', '') <> 'revoked'
      order by a.changed_at desc limit 1
    )),
    revocation_reason = 'legacy'
where g.state = 'REVOKED';

alter table public.guardians alter column state set not null;
alter table public.guardians alter column state set default 'ACTIVE';
alter table public.guardians alter column source set not null;
alter table public.guardians alter column source set default 'LEGACY_BACKFILL';
alter table public.guardians alter column verification_state set not null;
alter table public.guardians alter column verification_state set default 'UNVERIFIED';

alter table public.guardians drop constraint guardians_status_check;
alter table public.guardians add constraint guardians_status_check
  check (status in ('active', 'revoked', 'pending', 'suspended', 'declined', 'expired')) not valid;
alter table public.guardians drop constraint guardians_relationship_type_check;
alter table public.guardians add constraint guardians_relationship_type_check
  check (relationship_type in ('parent', 'guardian', 'carer', 'other_with_parental_responsibility')) not valid;
alter table public.guardians add constraint guardians_state_check
  check (state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'DECLINED', 'EXPIRED')) not valid;
alter table public.guardians add constraint guardians_source_check
  check (source in ('GUARDIAN_INVITATION', 'LINK_REQUEST', 'ADDITIONAL_GUARDIAN_REQUEST', 'SELF_ADDED_CHILD', 'CLUB_CREATED', 'SITE_ADMIN_ASSIGNMENT', 'DUPLICATE_RESOLUTION', 'LEGACY_BACKFILL')) not valid;
alter table public.guardians add constraint guardians_verification_state_check
  check (verification_state in ('UNVERIFIED', 'CLUB_VERIFIED', 'SITE_VERIFIED')) not valid;
alter table public.guardians add constraint guardians_revocation_shape
  check ((state = 'REVOKED') = (revoked_at is not null)) not valid;
alter table public.guardians add constraint guardians_status_matches_state
  check (status = case state when 'PENDING_APPROVAL' then 'pending' else lower(state) end) not valid;
alter table public.guardians validate constraint guardians_status_check;
alter table public.guardians validate constraint guardians_relationship_type_check;
alter table public.guardians validate constraint guardians_state_check;
alter table public.guardians validate constraint guardians_source_check;
alter table public.guardians validate constraint guardians_verification_state_check;
alter table public.guardians validate constraint guardians_revocation_shape;
alter table public.guardians validate constraint guardians_status_matches_state;

-- FR-2: one open relationship per guardian and player.
create unique index guardians_open_pair_unique on public.guardians (guardian_user_id, player_id)
  where state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED');
create index guardians_player_state_idx on public.guardians (player_id, state);
create index guardians_guardian_state_idx on public.guardians (guardian_user_id, state);

create or replace function internal.guardian_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_user uuid;
begin
  if tg_op = 'INSERT' then
    -- state defaults to ACTIVE, so a legacy insert that names another status
    -- is read from that status.
    if new.state is null or (new.state = 'ACTIVE' and lower(coalesce(new.status, 'active')) <> 'active') then
      new.state := case lower(coalesce(new.status, 'active'))
        when 'active' then 'ACTIVE' when 'revoked' then 'REVOKED' when 'pending' then 'PENDING_APPROVAL'
        when 'suspended' then 'SUSPENDED' when 'declined' then 'DECLINED' when 'expired' then 'EXPIRED' else 'ACTIVE' end;
    end if;
    new.source := coalesce(new.source, 'LEGACY_BACKFILL');
    new.verification_state := coalesce(new.verification_state, 'UNVERIFIED');
    if new.state = 'REVOKED' then new.revoked_at := coalesce(new.revoked_at, now()); end if;
  else
    if new.state is not distinct from old.state and new.status is distinct from old.status then
      -- A legacy status write by a backend session.
      new.state := case lower(new.status)
        when 'active' then 'ACTIVE' when 'revoked' then 'REVOKED' when 'pending' then 'PENDING_APPROVAL'
        when 'suspended' then 'SUSPENDED' when 'declined' then 'DECLINED' when 'expired' then 'EXPIRED' else old.state end;
    end if;
    if new.state is distinct from old.state then
      if old.state in ('REVOKED', 'DECLINED', 'EXPIRED') then
        raise exception 'An ended guardian relationship cannot be switched back on. Link the guardian again.' using errcode = '23514';
      end if;
      if old.state = 'PENDING_APPROVAL' and new.state not in ('ACTIVE', 'DECLINED', 'EXPIRED') then
        raise exception 'A guardian request can only be approved, declined or expire.' using errcode = '23514';
      end if;
      if old.state <> 'PENDING_APPROVAL' and new.state in ('PENDING_APPROVAL', 'DECLINED', 'EXPIRED') then
        raise exception 'Only a guardian request can be declined or expire, and nothing returns to awaiting approval.' using errcode = '23514';
      end if;
      if new.state = 'REVOKED' then
        new.revoked_at := coalesce(new.revoked_at, now());
        new.revoked_by := coalesce(new.revoked_by, auth.uid());
      elsif new.state = 'SUSPENDED' then
        new.suspended_at := coalesce(new.suspended_at, now());
      end if;
    end if;
    if new.guardian_user_id <> old.guardian_user_id or new.player_id <> old.player_id then
      raise exception 'A guardian relationship''s guardian and player never change.' using errcode = '23514';
    end if;
  end if;

  select pl.user_id into v_player_user from public.players pl where pl.id = new.player_id;
  if v_player_user is not null and v_player_user = new.guardian_user_id then
    raise exception 'A person cannot be their own guardian.' using errcode = '23514';
  end if;

  new.status := case new.state when 'PENDING_APPROVAL' then 'pending' else lower(new.state) end;
  return new;
end;
$$;

revoke all on function internal.guardian_facts() from public, anon, authenticated, service_role;

create trigger a_guardian_facts
  before insert or update on public.guardians
  for each row execute function internal.guardian_facts();

-- ---------------------------------------------------------------------
-- 2. Additional-guardian acceptance
-- ---------------------------------------------------------------------

alter table public.guardian_link_requests
  add column subject_response text check (subject_response in ('ACCEPTED', 'DECLINED')),
  add column subject_responded_at timestamptz,
  add column relationship_id uuid references public.guardians (id);

alter table public.guardian_link_requests add constraint guardian_link_requests_response_shape
  check ((subject_response is null) = (subject_responded_at is null));

comment on column public.guardian_link_requests.subject_response is
  'The added adult''s own answer to an ADDITIONAL_GUARDIAN request. A club may approve only after ACCEPTED (Phase 2 R11).';

-- ---------------------------------------------------------------------
-- 3. player_team_memberships
-- ---------------------------------------------------------------------

alter table public.player_team_memberships
  add column state text,
  add column source text,
  add column granted_by uuid,
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column reason text,
  add column ended_by uuid,
  add column end_reason text;

comment on column public.player_team_memberships.state is
  'Canonical team place state (Phase 2 M.3). ENDED and DECLINED are terminal; the legacy status column is maintained from it.';

update public.player_team_memberships
set state = upper(status),
    source = 'LEGACY_BACKFILL',
    granted_by = created_by;

alter table public.player_team_memberships alter column state set not null;
alter table public.player_team_memberships alter column state set default 'ACTIVE';
alter table public.player_team_memberships alter column source set not null;
alter table public.player_team_memberships alter column source set default 'LEGACY_BACKFILL';

alter table public.player_team_memberships drop constraint player_team_memberships_status_check;
alter table public.player_team_memberships add constraint player_team_memberships_status_check
  check (status in ('active', 'pending', 'ended', 'declined')) not valid;
alter table public.player_team_memberships drop constraint player_team_memberships_ended_requires_status;
alter table public.player_team_memberships add constraint player_team_memberships_ended_requires_status
  check (status in ('active', 'pending') or ended_at is not null) not valid;
alter table public.player_team_memberships add constraint player_team_memberships_state_check
  check (state in ('PENDING', 'ACTIVE', 'ENDED', 'DECLINED')) not valid;
alter table public.player_team_memberships add constraint player_team_memberships_source_check
  check (source in ('GUARDIAN_ADDED_CHILD', 'PLAYER_JOIN_REQUEST', 'TEAM_CODE', 'CLUB_CREATED', 'LINK_REQUEST_APPROVAL', 'GUARDIAN_INVITATION', 'SITE_ADMIN_ASSIGNMENT', 'SEASON_HANDOVER', 'TEAM_MOVE', 'DUPLICATE_RESOLUTION', 'LEGACY_BACKFILL')) not valid;
alter table public.player_team_memberships add constraint player_team_memberships_status_matches_state
  check (status = lower(state)) not valid;
alter table public.player_team_memberships validate constraint player_team_memberships_status_check;
alter table public.player_team_memberships validate constraint player_team_memberships_ended_requires_status;
alter table public.player_team_memberships validate constraint player_team_memberships_state_check;
alter table public.player_team_memberships validate constraint player_team_memberships_source_check;
alter table public.player_team_memberships validate constraint player_team_memberships_status_matches_state;

create index player_team_memberships_player_state_idx on public.player_team_memberships (player_id, state);
create index player_team_memberships_team_state_idx on public.player_team_memberships (team_id, state);

create or replace function internal.player_team_membership_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- state defaults to ACTIVE, so a legacy insert that names another status
    -- is read from that status.
    if new.state is null or (new.state = 'ACTIVE' and lower(coalesce(new.status, 'active')) <> 'active') then
      new.state := upper(coalesce(new.status, 'active'));
    end if;
    new.source := coalesce(new.source, 'LEGACY_BACKFILL');
    new.granted_by := coalesce(new.granted_by, new.created_by);
  else
    if new.state is not distinct from old.state and new.status is distinct from old.status then
      new.state := upper(new.status);
    end if;
    if new.state is distinct from old.state then
      if old.state in ('ENDED', 'DECLINED') then
        raise exception 'A finished team place cannot be switched back on. Add the player to the team again.' using errcode = '23514';
      end if;
      if old.state = 'PENDING' and new.state not in ('ACTIVE', 'DECLINED', 'ENDED') then
        raise exception 'A team join request can only be approved or declined.' using errcode = '23514';
      end if;
      if old.state <> 'PENDING' and new.state in ('PENDING', 'DECLINED') then
        raise exception 'Only a team join request can be declined, and nothing returns to being a request.' using errcode = '23514';
      end if;
      if new.state in ('ENDED', 'DECLINED') then
        new.ended_at := coalesce(new.ended_at, now());
        new.ended_by := coalesce(new.ended_by, auth.uid());
      end if;
    end if;
    if new.player_id <> old.player_id then
      raise exception 'A team place''s player never changes.' using errcode = '23514';
    end if;
  end if;
  new.status := lower(new.state);
  return new;
end;
$$;

revoke all on function internal.player_team_membership_facts() from public, anon, authenticated, service_role;

create trigger a_player_team_membership_facts
  before insert or update on public.player_team_memberships
  for each row execute function internal.player_team_membership_facts();

-- The pathway guard fired on writes to the legacy status column. A canonical
-- transition writes state, so the guard must fire on that too; it runs after
-- a_player_team_membership_facts has derived status.
drop trigger player_membership_pathway_guard on public.player_team_memberships;
create trigger player_membership_pathway_guard
  before insert or update of player_id, team_id, status, state on public.player_team_memberships
  for each row execute function internal.player_membership_pathway_guard();

-- ---------------------------------------------------------------------
-- 4. Verification (Phase 2 AF): each must be zero
-- ---------------------------------------------------------------------

do $$
declare
  v_guardian_null integer;
  v_guardian_status integer;
  v_guardian_open_dupes integer;
  v_ptm_null integer;
  v_ptm_status integer;
begin
  select count(*) into v_guardian_null from public.guardians where state is null;
  select count(*) into v_guardian_status from public.guardians
  where (status = 'active') <> (state = 'ACTIVE');
  select count(*) into v_guardian_open_dupes from (
    select guardian_user_id, player_id from public.guardians
    where state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED') group by 1, 2 having count(*) > 1) d;
  select count(*) into v_ptm_null from public.player_team_memberships where state is null;
  select count(*) into v_ptm_status from public.player_team_memberships where status <> lower(state);
  if v_guardian_null + v_guardian_status + v_guardian_open_dupes + v_ptm_null + v_ptm_status <> 0 then
    raise exception 'Slice 2 family verification failed: guardian null state %, guardian status mismatch %, open duplicate pairs %, team place null state %, team place status mismatch %.',
      v_guardian_null, v_guardian_status, v_guardian_open_dupes, v_ptm_null, v_ptm_status;
  end if;
end $$;
