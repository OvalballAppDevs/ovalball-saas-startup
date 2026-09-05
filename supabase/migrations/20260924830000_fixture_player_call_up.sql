-- TEMPORARY PLAYER CALL-UP (Mini-Rugby / Team Administration / Season
-- Handover brief, amendment): a coach short on numbers for a single
-- fixture needs to borrow a player from a younger sibling team for
-- JUST that match, without ever touching that player's real,
-- canonical team membership (player_team_memberships). This is a
-- fixture-scoped overlay, not a second player-roster system --
-- players/player_team_memberships already exist in Main (confirmed
-- before writing this migration), so this builds directly on them
-- rather than waiting on Side Project 1's own, separate player work.

create table public.fixture_player_call_up (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  player_id uuid not null references public.players(id),
  source_team_id uuid not null references public.teams(id),
  target_team_id uuid not null references public.teams(id),
  eligibility_rule_reference text not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'revoked')),
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fixture_id, player_id)
);

comment on table public.fixture_player_call_up is
  'A fixture-scoped overlay: player_id is on loan from source_team_id to target_team_id for exactly this one fixture_id. NEVER mutates player_team_memberships -- the player''s real, canonical team is unaffected once the match is over. eligibility_rule_reference is a free-text citation of the rule permitting the call-up (e.g. an RFU/RFL regulation number); this schema does not itself encode or enforce a specific permitted age-gap, since that is an unverified governing-body rule -- see internal.validate_player_call_up''s comment.';

alter table public.fixture_player_call_up enable row level security;

create policy fixture_player_call_up_select on public.fixture_player_call_up
  for select using (
    internal.can_manage_team(source_team_id)
    or internal.can_manage_team(target_team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = source_team_id))
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = target_team_id))
    or internal.is_site_admin()
  );

-- internal.validate_player_call_up: structural invariants checked on
-- every insert/update, regardless of which RPC performed it --
-- forging any of these by writing the table directly (bypassing the
-- RPCs below) still fails.
create or replace function internal.validate_player_call_up()
returns trigger
language plpgsql
as $$
declare
  v_source public.teams;
  v_target public.teams;
  v_effective_ids uuid[];
  v_source_age integer;
  v_target_age integer;
begin
  select * into v_source from public.teams where id = new.source_team_id;
  select * into v_target from public.teams where id = new.target_team_id;

  if v_source.club_id <> v_target.club_id then
    raise exception 'A player call-up can only move a player between two teams of the SAME club. A cross-club arrangement needs a Dispensation, not a call-up.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.player_team_memberships
    where player_id = new.player_id and team_id = new.source_team_id and status = 'active' and ended_at is null
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;

  v_effective_ids := public.get_effective_fixture_team_ids(new.fixture_id);
  if not (
    new.target_team_id = any(v_effective_ids)
    or new.target_team_id = (select opponent_team_id from public.fixtures where id = new.fixture_id)
  ) then
    raise exception 'target_team_id is not one of the teams actually playing this fixture.' using errcode = '23514';
  end if;

  -- Direction is a hard constraint (playing UP an age grade, never
  -- down) whenever both ages are ordinary parseable U-ages; the exact
  -- permitted GAP (one age grade vs. more) is left to
  -- eligibility_rule_reference rather than hardcoded here, since no
  -- verified governing-body limit has been confirmed for this club's
  -- rugby_code (see GOVERNING-BODY CONFIRMATION REQUIRED items in the
  -- project's final report).
  v_source_age := substring(v_source.age_group from '^U(\d+)')::integer;
  v_target_age := substring(v_target.age_group from '^U(\d+)')::integer;
  if v_source_age is not null and v_target_age is not null and v_target_age < v_source_age then
    raise exception 'A call-up must move a player UP an age grade (from % to %), never down.', v_source.age_group, v_target.age_group using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger fixture_player_call_up_validate
  before insert or update on public.fixture_player_call_up
  for each row execute function internal.validate_player_call_up();

-- request_player_call_up: raised by whoever manages the TARGET team
-- (they are the one short of numbers) or that club's fixture
-- secretary/admin. Structural validity is enforced by the trigger
-- above; this RPC only adds the authorization check and initial state.
create or replace function public.request_player_call_up(p_fixture_id uuid, p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_target_club uuid;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.can_manage_team(p_target_team_id) or internal.can_manage_club_fixtures(v_target_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to request a call-up onto this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A call-up requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, eligibility_rule_reference, requested_by)
  values (p_fixture_id, p_player_id, p_source_team_id, p_target_team_id, p_eligibility_rule_reference, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.request_player_call_up(uuid, uuid, uuid, uuid, text) to authenticated;

-- decide_player_call_up: the SOURCE team is the one being asked to
-- lend their player, so approval authority sits with whoever manages
-- the source team (or that club's fixture secretary/admin) -- the
-- requester (target team) cannot also approve their own request.
-- Approval is the one moment the ONE-PLAYER-ONE-PHYSICAL-FIXTURE-
-- COMMITMENT invariant is enforced: a speculative 'requested' row is
-- harmless and may coexist with other requests, but nothing may become
-- 'approved' while the player already holds another non-cancelled
-- commitment (a canonical team fixture, or another approved call-up)
-- on the same kickoff_date.
create or replace function public.decide_player_call_up(p_call_up_id uuid, p_action text, p_reason text default null)
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
  if not (internal.can_manage_team(c.source_team_id) or internal.can_manage_club_fixtures(v_source_club) or internal.is_site_admin()) then
    raise exception 'Not authorized to decide this call-up -- only the source team (the one lending the player) or that club''s fixture secretary/admin may approve or reject it.' using errcode = '42501';
  end if;
  if c.status <> 'requested' and p_action in ('approve', 'reject') then
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
end;
$$;

grant execute on function public.decide_player_call_up(uuid, text, text) to authenticated;
