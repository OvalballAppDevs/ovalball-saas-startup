-- Tournament architecture. A tournament is NOT a normal 1-v-1 fixture with
-- a comma-separated opponent list -- it is a first-class scheduled event
-- with its own host and a normalized set of invited/participating teams.
-- Mirrors the Master Fixture Registry's own principles: one stable event
-- identity (tournaments.id), canonical Club Directory as the only
-- opposition source (never free text), Team Directory canonical_team_type
-- as the requested identity (never an invented team name), and no parallel
-- permission system -- every write here reuses internal.can_manage_club_
-- fixtures/internal.can_manage_team, exactly like ordinary fixtures.

-- ============================================================
-- 1. tournaments -- the host side. host_club_id/host_team_id start NULL
--    only for the away-initiated "propose at a host who hasn't acted yet"
--    case (status = 'pending_host_confirmation'); every other creation
--    path sets both immediately (status = 'confirmed').
-- ============================================================

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  host_club_id uuid references public.clubs(id),
  host_team_id uuid references public.teams(id),
  -- The canonical Club Directory identity of the host, ALWAYS set (even
  -- before host_club_id is, and even after -- clubs.directory_id is a
  --1:1, so this is never redundant information, it is what makes an
  -- away-initiated proposal possible before any clubs/teams row is
  -- involved on the host side at all).
  host_directory_id uuid not null references public.club_directory(id),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  season_id uuid references public.seasons(id),
  competition_edition_id uuid references public.competition_editions(id),
  event_date date not null,
  kickoff_time time,
  pitch_id uuid references public.club_pitches(id),
  venue_notes text,
  status text not null default 'confirmed' check (status in ('pending_host_confirmation', 'confirmed', 'cancelled', 'completed')),
  notes text,
  conversation_id uuid not null default gen_random_uuid(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_reason text,
  constraint tournaments_host_confirmed_requires_team
    check (status <> 'confirmed' or (host_club_id is not null and host_team_id is not null)),
  constraint tournaments_pitch_belongs_to_host
    check (pitch_id is null or host_club_id is null) -- widened by a trigger below once host_club_id is known; a bare CHECK can't join club_pitches.club_id, so real enforcement is in the trigger (section 3) -- this column-only check just blocks the nonsensical "pitch set with no host club yet" shape.
);

comment on table public.tournaments is
  'A first-class scheduled rugby event, distinct from an ordinary 1-v-1 fixture. host_directory_id is the canonical Club Directory identity of the host (always known); host_club_id/host_team_id are populated once the host is a real, activated, participating Ovalball club/team -- for a still-"pending_host_confirmation" away-initiated proposal, both stay null until claim_tournament_host() resolves them. See tournament_participants for the normalized invited-team list -- never JSON, never comma-separated.';

comment on column public.tournaments.conversation_id is
  'A shared workspace identity for host+participant operational conversation, mirroring fixtures.conversation_id -- the messaging UI/RLS for this is intentionally NOT built in this migration (a later, separately-scoped pass owns fixture/tournament messaging UI); this column exists now so that pass has a stable id to attach to rather than retrofitting one.';

create index tournaments_host_club_id_idx on public.tournaments (host_club_id) where host_club_id is not null;
create index tournaments_event_date_idx on public.tournaments (event_date);
create index tournaments_season_id_idx on public.tournaments (season_id) where season_id is not null;

alter table public.tournaments enable row level security;

-- ============================================================
-- 2. tournament_participants -- normalized, one row per invited/
--    participating team. club_directory_id is always set (the canonical
--    opposition source); club_id/team_id populate only as far as that
--    club is activated and operates the requested canonical team.
-- ============================================================

create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  club_directory_id uuid not null references public.club_directory(id),
  club_id uuid references public.clubs(id),
  team_id uuid references public.teams(id),
  -- The requested team IDENTITY, always set -- "U12" was invited even
  -- before/without a real team_id existing to represent it.
  canonical_team_type_id uuid not null references public.canonical_team_types(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'external_recorded')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Section EF: never invite the same club+team-identity twice to the
  -- same tournament -- a real database constraint, not just a UI check.
  unique (tournament_id, club_directory_id, canonical_team_type_id)
);

comment on table public.tournament_participants is
  'One row per invited/participating team -- never JSON or a comma-separated list. status=''external_recorded'' means the club is a known canonical Club Directory entry but not activated on Ovalball: there is nobody to send a real invitation to, so this status is set immediately and must never be confused with ''pending'' (nobody has been asked to respond) or ''declined'' (nobody has said no) -- see reconcile_tournament_participant() for what happens if that club later activates. The host itself does NOT get a participant row (tracked via tournaments.host_club_id/host_team_id directly) -- an away-initiated proposal''s PROPOSING team does get one (status ''accepted'', since proposing is itself participation).';

create index tournament_participants_tournament_id_idx on public.tournament_participants (tournament_id);
create index tournament_participants_team_id_idx on public.tournament_participants (team_id) where team_id is not null;
create index tournament_participants_club_directory_id_idx on public.tournament_participants (club_directory_id);

alter table public.tournament_participants enable row level security;

-- ============================================================
-- 3. Pitch-belongs-to-host guard (Section BU: "Do not let Site Admin grid
--    accidentally point a fixture at another unrelated club's private
--    pitch"). A bare CHECK constraint can't join club_pitches -- a
--    trigger is the real enforcement; the column CHECK above only blocks
--    the "pitch with no host club" shape, this closes the rest.
-- ============================================================

create or replace function internal.validate_tournament_pitch_ownership() returns trigger
language plpgsql
as $$
begin
  if new.pitch_id is not null then
    if new.host_club_id is null then
      raise exception 'A pitch can only be set once the host club is confirmed.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.club_pitches cp where cp.id = new.pitch_id and cp.club_id = new.host_club_id) then
      raise exception 'That pitch does not belong to this tournament''s host club.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_validate_pitch_ownership on public.tournaments;
create trigger tournaments_validate_pitch_ownership
  before insert or update of pitch_id, host_club_id on public.tournaments
  for each row execute function internal.validate_tournament_pitch_ownership();

-- The column-only CHECK above (tournaments_pitch_belongs_to_host) is
-- actually too strict once a host is confirmed with no pitch chosen yet
-- and later gets one via update_tournament_details -- drop it in favour of
-- the trigger doing the complete job (host-null-with-pitch is already
-- covered by the trigger's own first branch).
alter table public.tournaments drop constraint tournaments_pitch_belongs_to_host;

-- ============================================================
-- 4. RLS. Select: anyone who can manage the host club/team, or has a
--    participant row they can manage (team-level or club-level), or is
--    Site Admin -- mirrors fixtures' own "either side" pattern. Direct
--    table writes are NOT granted to authenticated at all -- every mutation
--    goes through a SECURITY DEFINER RPC below (this table has enough
--    cross-cutting invariants -- host claim, pitch ownership, participant
--    authority -- that a bare RLS UPDATE policy could not safely express
--    them; the RPCs are the only write path, matching this codebase's own
--    established pattern for equally cross-cutting tables like
--    canonical_team_types).
--
--    internal.can_view_tournament is a SECURITY DEFINER helper (not an
--    inline subquery in each policy) specifically to avoid a real
--    infinite-recursion trap: tournaments_select_scoped's own condition
--    needs to read tournament_participants, and tournament_participants_
--    select_scoped's own condition needs to read tournaments -- two RLS
--    policies subquerying each other's RLS-protected table directly
--    recurses forever. Routing both through one SECURITY DEFINER function
--    (whose OWN internal queries bypass RLS, same as every other
--    SECURITY DEFINER function in this codebase -- see internal.can_
--    access_fixture_conversation for the identical established pattern)
--    breaks the cycle: the policy body itself is a single function call,
--    never a nested query against the other RLS-protected table.
-- ============================================================

create or replace function internal.can_view_tournament(p_tournament_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    internal.is_site_admin()
    or exists (
      -- host_directory_id (never null) rather than host_club_id/host_
      -- team_id (null pre-claim): the PROPOSED host of a still-pending_
      -- host_confirmation tournament must be able to see it in order to
      -- claim it in the first place -- host_club_id/host_team_id alone
      -- would make an unclaimed proposal invisible to the very club it
      -- names.
      select 1 from public.tournaments t
      join public.clubs c on c.directory_id = t.host_directory_id
      where t.id = p_tournament_id and internal.can_manage_club_fixtures(c.id)
    )
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and ((tp.team_id is not null and internal.can_manage_team(tp.team_id))
             or (tp.club_id is not null and internal.can_manage_club_fixtures(tp.club_id)))
    );
$$;

comment on function internal.can_view_tournament is
  'True for a team/club official of the (proposed-or-confirmed) host side OR any participant side, or Site Admin. SECURITY DEFINER so its own internal queries bypass RLS -- this is what lets both tournaments_select_scoped and tournament_participants_select_scoped call through the SAME function without the two tables'' policies ever directly subquerying each other (which would recurse infinitely).';

create policy tournaments_select_scoped on public.tournaments for select
  using (internal.can_view_tournament(id));

create policy tournament_participants_select_scoped on public.tournament_participants for select
  using (internal.can_view_tournament(tournament_id));

-- ============================================================
-- 5. create_tournament -- a club creating its OWN tournament directly.
--    host_club_id/host_team_id known immediately, status starts
--    'confirmed', no claim step needed.
-- ============================================================

create or replace function public.create_tournament(
  p_host_team_id uuid, p_event_date date, p_kickoff_time time default null,
  p_pitch_id uuid default null, p_competition_edition_id uuid default null,
  p_venue_notes text default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_club_id uuid;
  v_host_directory_id uuid;
  v_rugby_code text;
  v_tournament_id uuid;
begin
  select t.club_id, t.rugby_code into v_host_club_id, v_rugby_code from public.teams t where t.id = p_host_team_id;
  if v_host_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not internal.can_manage_team(p_host_team_id) then
    raise exception 'You are not authorised to create a tournament for this team.' using errcode = '42501';
  end if;

  select c.directory_id into v_host_directory_id from public.clubs c where c.id = v_host_club_id;

  insert into public.tournaments (
    host_club_id, host_team_id, host_directory_id, rugby_code, event_date, kickoff_time,
    pitch_id, competition_edition_id, venue_notes, notes, status, created_by, updated_by
  )
  values (
    v_host_club_id, p_host_team_id, v_host_directory_id, v_rugby_code, p_event_date, p_kickoff_time,
    p_pitch_id, p_competition_edition_id, p_venue_notes, p_notes, 'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournaments', v_tournament_id, 'insert', auth.uid(), jsonb_build_object('host_team_id', p_host_team_id, 'event_date', p_event_date));

  return v_tournament_id;
end;
$$;

revoke execute on function public.create_tournament(uuid, date, time, uuid, uuid, text, text) from public;
grant execute on function public.create_tournament(uuid, date, time, uuid, uuid, text, text) to authenticated;

-- ============================================================
-- 6. propose_tournament_at_host -- the away-initiated case. The proposed
--    host must already be an ACTIVATED Ovalball club (a tournament host
--    is different from a PARTICIPANT -- a host must be real and able to
--    eventually claim/manage the event; an unactivated club can never be
--    a host, only a participant). The proposing team is recorded as an
--    already-accepted participant (they proposed it -- that IS their
--    acceptance).
-- ============================================================

create or replace function public.propose_tournament_at_host(
  p_proposed_host_directory_id uuid, p_proposing_team_id uuid, p_event_date date,
  p_kickoff_time time default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposing_club_id uuid;
  v_rugby_code text;
  v_host_club_id uuid;
  v_tournament_id uuid;
  v_proposing_canonical_type_id uuid;
begin
  select t.club_id, t.rugby_code, t.canonical_team_type_id into v_proposing_club_id, v_rugby_code, v_proposing_canonical_type_id
  from public.teams t where t.id = p_proposing_team_id;
  if v_proposing_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not internal.can_manage_team(p_proposing_team_id) then
    raise exception 'You are not authorised to propose a tournament for this team.' using errcode = '42501';
  end if;

  select c.id into v_host_club_id from public.clubs c where c.directory_id = p_proposed_host_directory_id;
  if v_host_club_id is null then
    raise exception 'A tournament host must be an activated Ovalball club -- this club is not yet on Ovalball. It can still be invited as a PARTICIPANT once a host creates the tournament.' using errcode = 'P0001';
  end if;

  insert into public.tournaments (host_directory_id, rugby_code, event_date, kickoff_time, notes, status, created_by, updated_by)
  values (p_proposed_host_directory_id, v_rugby_code, p_event_date, p_kickoff_time, p_notes, 'pending_host_confirmation', auth.uid(), auth.uid())
  returning id into v_tournament_id;

  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, status, invited_by, responded_by, responded_at)
  select v_tournament_id, cd.id, v_proposing_club_id, p_proposing_team_id, v_proposing_canonical_type_id, 'accepted', auth.uid(), auth.uid(), now()
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = v_proposing_club_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_host_proposed', 'Tournament proposal for your club',
    format('A club has proposed hosting a tournament at your club on %s.', to_char(p_event_date, 'DD Mon YYYY')),
    jsonb_build_object('tournament_id', v_tournament_id)
  from public.club_memberships cm
  where cm.club_id = v_host_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournaments', v_tournament_id, 'insert', auth.uid(), jsonb_build_object('proposed_host_directory_id', p_proposed_host_directory_id, 'proposing_team_id', p_proposing_team_id));

  return v_tournament_id;
end;
$$;

revoke execute on function public.propose_tournament_at_host(uuid, uuid, date, time, text) from public;
grant execute on function public.propose_tournament_at_host(uuid, uuid, date, time, text) to authenticated;

-- ============================================================
-- 7. claim_tournament_host -- the proposed host accepts organiser
--    authority. Before this call, the proposing club cannot manage
--    participants or host fields (enforced by invite/remove/update below
--    all requiring host_team_id/host_club_id to already resolve to
--    something the caller controls -- a null host_club_id can never
--    satisfy can_manage_club_fixtures/can_manage_team, so those RPCs are
--    naturally unreachable pre-claim without any extra check).
-- ============================================================

create or replace function public.claim_tournament_host(p_tournament_id uuid, p_host_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.tournaments;
  v_host_club_id uuid;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found.'; end if;
  if v_t.status <> 'pending_host_confirmation' then
    raise exception 'This tournament is not awaiting host confirmation (status: %).', v_t.status;
  end if;

  select t.club_id into v_host_club_id from public.teams t where t.id = p_host_team_id;
  if v_host_club_id is null then raise exception 'Team not found.'; end if;

  if not exists (select 1 from public.clubs c where c.id = v_host_club_id and c.directory_id = v_t.host_directory_id) then
    raise exception 'That team does not belong to the club this tournament was proposed at.' using errcode = '23514';
  end if;

  if not internal.can_manage_team(p_host_team_id) then
    raise exception 'You are not authorised to claim this tournament on behalf of the host club.' using errcode = '42501';
  end if;

  update public.tournaments
  set host_club_id = v_host_club_id, host_team_id = p_host_team_id, status = 'confirmed', updated_by = auth.uid(), updated_at = now()
  where id = p_tournament_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_host_claimed', 'Tournament confirmed',
    'The host club has confirmed and now organises this tournament.',
    jsonb_build_object('tournament_id', p_tournament_id)
  from public.tournament_participants tp
  join public.team_permissions tperm on tperm.team_id = tp.team_id
  join public.club_memberships cm on cm.id = tperm.membership_id and cm.status = 'active'
  where tp.tournament_id = p_tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('tournaments', p_tournament_id, 'update', auth.uid(), jsonb_build_object('status', v_t.status), jsonb_build_object('status', 'confirmed', 'host_team_id', p_host_team_id));
end;
$$;

revoke execute on function public.claim_tournament_host(uuid, uuid) from public;
grant execute on function public.claim_tournament_host(uuid, uuid) to authenticated;

-- ============================================================
-- 8. invite_tournament_participant -- host-only.
-- ============================================================

create or replace function public.invite_tournament_participant(p_tournament_id uuid, p_club_directory_id uuid, p_canonical_team_type_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.tournaments;
  v_club_id uuid;
  v_team_id uuid;
  v_status text;
  v_participant_id uuid;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found.'; end if;

  if not (internal.is_site_admin()
          or (v_t.host_club_id is not null and internal.can_manage_club_fixtures(v_t.host_club_id))
          or (v_t.host_team_id is not null and internal.can_manage_team(v_t.host_team_id))) then
    raise exception 'Only the host club may invite tournament participants.' using errcode = '42501';
  end if;
  if v_t.status <> 'confirmed' then
    raise exception 'This tournament has no confirmed host yet -- it cannot invite participants until the host claims it.' using errcode = 'P0001';
  end if;

  select c.id into v_club_id from public.clubs c where c.directory_id = p_club_directory_id;

  if v_club_id is not null then
    select t.id into v_team_id from public.teams t
    where t.club_id = v_club_id and t.canonical_team_type_id = p_canonical_team_type_id and t.active
    limit 1;
    v_status := 'pending';
  else
    v_status := 'external_recorded';
  end if;

  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, status, invited_by)
  values (p_tournament_id, p_club_directory_id, v_club_id, v_team_id, p_canonical_team_type_id, v_status, auth.uid())
  returning id into v_participant_id;

  if v_status = 'pending' then
    if v_team_id is not null then
      -- Notify whoever is actually assigned to the resolved team, AND the
      -- club's own Club Admin/Fixtures Secretary as a fallback (a real
      -- club can have a team with no team-level permission holders
      -- assigned yet -- the club-level official must still hear about it,
      -- matching the "team not yet resolved" branch below).
      insert into public.notifications (user_id, type, title, body, data)
      select distinct cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
        format('Your team has been invited to a tournament on %s.', to_char(v_t.event_date, 'DD Mon YYYY')),
        jsonb_build_object('tournament_id', p_tournament_id, 'participant_id', v_participant_id)
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id = v_team_id
      union
      select distinct cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
        format('Your team has been invited to a tournament on %s.', to_char(v_t.event_date, 'DD Mon YYYY')),
        jsonb_build_object('tournament_id', p_tournament_id, 'participant_id', v_participant_id)
      from public.club_memberships cm
      where cm.club_id = v_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
    else
      insert into public.notifications (user_id, type, title, body, data)
      select cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
        format('Your club has been invited to a tournament on %s -- the specific team requested is not yet set up.', to_char(v_t.event_date, 'DD Mon YYYY')),
        jsonb_build_object('tournament_id', p_tournament_id, 'participant_id', v_participant_id)
      from public.club_memberships cm
      where cm.club_id = v_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournament_participants', v_participant_id, 'insert', auth.uid(), jsonb_build_object('club_directory_id', p_club_directory_id, 'canonical_team_type_id', p_canonical_team_type_id, 'status', v_status));

  return v_participant_id;
end;
$$;

revoke execute on function public.invite_tournament_participant(uuid, uuid, uuid) from public;
grant execute on function public.invite_tournament_participant(uuid, uuid, uuid) to authenticated;

comment on function public.invite_tournament_participant is
  'Host-only. An activated club operating the requested canonical team gets a real invitation (status pending, team_id set, notified). An activated club NOT operating that team yet still gets a real participant row (team_id null, canonical_team_type_id records what was asked for) -- never auto-invokes the missing-team creation flow, that stays a separate, deliberate action the invited club takes for itself. An unactivated club is recorded immediately as external_recorded -- never a fake pending/declined state, since there is no Ovalball account to ask.';

-- ============================================================
-- 9. respond_tournament_invitation -- the invited side accepts/declines.
-- ============================================================

create or replace function public.respond_tournament_invitation(p_participant_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;
  if v_p.status <> 'pending' then
    raise exception 'This invitation is not awaiting a response (status: %).', v_p.status;
  end if;

  if not (internal.is_site_admin()
          or (v_p.team_id is not null and internal.can_manage_team(v_p.team_id))
          or (v_p.club_id is not null and internal.can_manage_club_fixtures(v_p.club_id))) then
    raise exception 'You are not authorised to respond to this tournament invitation.' using errcode = '42501';
  end if;

  update public.tournament_participants
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_by = auth.uid(), responded_at = now(), updated_at = now()
  where id = p_participant_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_invitation_responded',
    case when p_accept then 'Tournament invitation accepted' else 'Tournament invitation declined' end,
    'A participating club has responded to your tournament invitation.',
    jsonb_build_object('tournament_id', v_p.tournament_id, 'participant_id', p_participant_id, 'accepted', p_accept)
  from public.tournaments t
  join public.club_memberships cm on cm.club_id = t.host_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  where t.id = v_p.tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('tournament_participants', p_participant_id, 'update', auth.uid(), jsonb_build_object('status', v_p.status), jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end));
end;
$$;

revoke execute on function public.respond_tournament_invitation(uuid, boolean) from public;
grant execute on function public.respond_tournament_invitation(uuid, boolean) to authenticated;

-- ============================================================
-- 10. remove_tournament_participant -- host-only, only before acceptance
--     (protects a team that has already committed).
-- ============================================================

create or replace function public.remove_tournament_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_t public.tournaments;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;
  select * into v_t from public.tournaments where id = v_p.tournament_id;

  if not (internal.is_site_admin()
          or (v_t.host_club_id is not null and internal.can_manage_club_fixtures(v_t.host_club_id))
          or (v_t.host_team_id is not null and internal.can_manage_team(v_t.host_team_id))) then
    raise exception 'Only the host club may remove tournament participants.' using errcode = '42501';
  end if;

  if v_p.status = 'accepted' then
    raise exception 'This team has already accepted -- it can no longer be removed unilaterally.' using errcode = 'P0001';
  end if;

  delete from public.tournament_participants where id = p_participant_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before)
  values ('tournament_participants', p_participant_id, 'delete', auth.uid(), jsonb_build_object('status', v_p.status, 'club_directory_id', v_p.club_directory_id));
end;
$$;

revoke execute on function public.remove_tournament_participant(uuid) from public;
grant execute on function public.remove_tournament_participant(uuid) to authenticated;

-- ============================================================
-- 11. reconcile_tournament_participant -- an external_recorded participant
--     whose club_directory_id has since activated on Ovalball. Deliberately
--     NOT an automatic trigger on clubs insert (would silently re-notify
--     for tournaments long past) -- a dedicated, explicit action the host
--     or Site Admin takes.
-- ============================================================

create or replace function public.reconcile_tournament_participant(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.tournament_participants;
  v_t public.tournaments;
  v_club_id uuid;
  v_team_id uuid;
begin
  select * into v_p from public.tournament_participants where id = p_participant_id for update;
  if not found then raise exception 'Tournament participant not found.'; end if;
  if v_p.status <> 'external_recorded' then
    raise exception 'This participant is not in an external/unreconciled state (status: %).', v_p.status;
  end if;
  select * into v_t from public.tournaments where id = v_p.tournament_id;

  if not (internal.is_site_admin()
          or (v_t.host_club_id is not null and internal.can_manage_club_fixtures(v_t.host_club_id))
          or (v_t.host_team_id is not null and internal.can_manage_team(v_t.host_team_id))) then
    raise exception 'Only the host club may reconcile tournament participants.' using errcode = '42501';
  end if;

  select c.id into v_club_id from public.clubs c where c.directory_id = v_p.club_directory_id;
  if v_club_id is null then
    raise exception 'This club has still not activated on Ovalball -- nothing to reconcile yet.' using errcode = 'P0001';
  end if;

  select t.id into v_team_id from public.teams t
  where t.club_id = v_club_id and t.canonical_team_type_id = v_p.canonical_team_type_id and t.active
  limit 1;

  update public.tournament_participants
  set club_id = v_club_id, team_id = v_team_id, status = 'pending', updated_at = now()
  where id = p_participant_id;

  if v_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select distinct cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
      format('Your team has been invited to a tournament on %s.', to_char(v_t.event_date, 'DD Mon YYYY')),
      jsonb_build_object('tournament_id', v_t.id, 'participant_id', p_participant_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_team_id
    union
    select distinct cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
      format('Your team has been invited to a tournament on %s.', to_char(v_t.event_date, 'DD Mon YYYY')),
      jsonb_build_object('tournament_id', v_t.id, 'participant_id', p_participant_id)
    from public.club_memberships cm
    where cm.club_id = v_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  else
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'tournament_invitation_received', 'Tournament invitation',
      format('Your club has been invited to a tournament on %s -- the specific team requested is not yet set up.', to_char(v_t.event_date, 'DD Mon YYYY')),
      jsonb_build_object('tournament_id', v_t.id, 'participant_id', p_participant_id)
    from public.club_memberships cm
    where cm.club_id = v_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('tournament_participants', p_participant_id, 'update', auth.uid(), jsonb_build_object('status', 'external_recorded'), jsonb_build_object('status', 'pending', 'club_id', v_club_id, 'team_id', v_team_id));
end;
$$;

revoke execute on function public.reconcile_tournament_participant(uuid) from public;
grant execute on function public.reconcile_tournament_participant(uuid) to authenticated;

-- ============================================================
-- 12. Calendar visibility query pattern -- a view, not a Calendar UI
--     component (that is a separately-scoped later pass). A club sees a
--     tournament if it is the host, or has an ACCEPTED participant row.
--     Pending/declined participants never show as confirmed
--     participation (Section CF).
-- ============================================================

create or replace view public.club_visible_tournaments
  with (security_invoker = true) as
select distinct t.*
from public.tournaments t
where t.status in ('confirmed', 'completed')
  and (
    (t.host_club_id is not null and internal.can_manage_club_fixtures(t.host_club_id))
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = t.id and tp.status = 'accepted'
        and ((tp.team_id is not null and internal.can_manage_team(tp.team_id))
             or (tp.club_id is not null and internal.can_manage_club_fixtures(tp.club_id)))
    )
  );

comment on view public.club_visible_tournaments is
  'The Calendar-visibility query pattern for tournaments (Section CF): host always sees it; a participant sees it only once ACCEPTED, never while still pending/declined. security_invoker so it respects the caller''s own real authority -- never a broader view than tournaments_select_scoped itself grants. The Calendar UI component that renders this is a separate, later pass -- this view exists so that pass has a ready query to build on.';
