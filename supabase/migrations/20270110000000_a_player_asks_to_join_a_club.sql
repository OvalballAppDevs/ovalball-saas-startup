-- One request to join a club, and whoever is authorised resolves it first.
--
-- WHY A NEW DOMAIN OBJECT, AND WHY IT IS NOT AN ADULT ONE
--
-- Ovalball could already express "this player is waiting to be accepted onto
-- THIS team": a player_team_memberships row with status 'pending'. That works
-- when there is one obvious team, which is how a child joining an age grade
-- arrives.
--
-- It cannot express an adult joining a Rugby Union club, because there is no
-- team to point at yet. The club runs a 1st, a 2nd and a 3rd XV, and which one
-- somebody plays in is decided by the club after seeing them, not by a date of
-- birth. Attaching the request to Men's 1st "for now" would be inventing a
-- selection decision and then asking a manager to rubber-stamp it.
--
-- So the request itself becomes the object: a player, a club, and a decision
-- the club has not made yet. It is deliberately NOT adult-specific -- nothing
-- in this table or these functions knows about age. A youth player whose club
-- runs three sides at their grade has exactly the same shape of problem, and
-- this is the same answer.
--
-- ONE REQUEST, SEVERAL POSSIBLE RESOLVERS
--
-- A club manager and a team manager are not two approvals. They are two people
-- who may resolve the same request, and the first legitimate one to do so
-- settles it. That is enforced by locking the row and refusing any transition
-- out of 'pending' -- so a second manager clicking Approve from a stale page
-- gets told it is already resolved rather than creating a second membership.

create table if not exists public.player_club_join_requests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  /** Who asked: the player themselves, or their guardian. */
  requested_by uuid not null references auth.users(id),
  /**
   * What Ovalball resolved AT THE TIME OF ASKING, recorded so the club sees the
   * same answer the player was shown. It is evidence, never authority: approval
   * re-derives everything and the membership guard has the final word.
   */
  resolved_category text,
  resolved_canonical_team_type_id uuid references public.canonical_team_types(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  /** Set on approval: the squad the club actually chose. */
  placed_team_id uuid references public.teams(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  /** Shown to the player, so it is written for them to read. */
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- EXACTLY ONE open request per player per club. This is what makes a double
-- submit, a refresh, a back button and a re-login all harmless.
create unique index if not exists player_club_join_requests_one_open
  on public.player_club_join_requests (player_id, club_id)
  where status = 'pending';

create index if not exists player_club_join_requests_club_pending
  on public.player_club_join_requests (club_id) where status = 'pending';

comment on table public.player_club_join_requests is
  'A player asking to join a club, where the club has not yet decided which squad. ONE row per open request: a club manager and a team manager are two possible resolvers of the same request, not two approvals.';

alter table public.player_club_join_requests enable row level security;

-- The applicant side: a player sees their own requests, a guardian sees their
-- children's. Nothing here exposes one club's applicants to another club.
create policy player_club_join_requests_select_own
  on public.player_club_join_requests for select
  using (
    exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid())
    or exists (select 1 from public.guardians g where g.player_id = player_club_join_requests.player_id
               and g.guardian_user_id = auth.uid() and g.status = 'active')
  );

-- The club side, by capability rather than by role name.
create policy player_club_join_requests_select_club
  on public.player_club_join_requests for select
  using (
    internal.has_capability('club.roster.manage', 'club', club_id, null)
    or internal.is_site_admin()
  );

-- Every write goes through the functions below, which carry the authority
-- checks and the state machine. No direct client writes.

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

create or replace function public.request_to_join_club(
  p_player_id uuid,
  p_club_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean;
  v_is_guardian boolean;
  v_existing uuid;
  v_active uuid;
  v_dob date;
  v_pathway text;
  v_code text;
  a record;
  v_season uuid;
  v_age record;
  v_category text;
  v_type_id uuid;
  v_id uuid;
begin
  select p.date_of_birth, p.playing_pathway into v_dob, v_pathway
  from public.players p where p.id = p_player_id;
  if not found then raise exception 'Player not found.'; end if;

  -- Authority comes from the relationship, never from knowing the id.
  v_is_self := exists (select 1 from public.players p where p.id = p_player_id and p.user_id = auth.uid());
  v_is_guardian := exists (select 1 from public.guardians g
                           where g.player_id = p_player_id and g.guardian_user_id = auth.uid() and g.status = 'active');
  if not (v_is_self or v_is_guardian) then
    raise exception 'Only this player, or their guardian, can ask to join a club for them.' using errcode = '42501';
  end if;

  -- Allocation needs both. Asking without them would send the club a request
  -- they cannot act on.
  if v_dob is null then
    raise exception 'A date of birth is needed before you can ask to join a club.' using errcode = '23514';
  end if;
  if v_pathway is null then
    raise exception 'Ovalball needs to know which pathway this player is registered in before asking a club to accept them.' using errcode = '23514';
  end if;

  select cd.rugby_code into v_code
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id and c.status = 'active';
  if v_code is null then raise exception 'Club not found.'; end if;

  -- Already a member here. Saying so is more useful than a second request.
  select ptm.id into v_active
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and t.club_id = p_club_id and ptm.status = 'active'
  limit 1;
  if v_active is not null then
    raise exception 'This player already plays for this club.' using errcode = '23505';
  end if;

  -- IDEMPOTENT. A refresh, a double click, or a return through a different
  -- sign-in method finds the request that already exists.
  select id into v_existing from public.player_club_join_requests
  where player_id = p_player_id and club_id = p_club_id and status = 'pending';
  if v_existing is not null then
    return v_existing;
  end if;

  -- Record what Ovalball resolved, so the club reads the same answer the player
  -- was shown. Youth and adult go through their own canonical resolvers.
  v_season := internal.resolve_season_for_date(v_code, current_date);
  if v_season is not null then
    select * into v_age from public.resolve_player_regulatory_age(v_code, v_season, v_dob);
    if v_age.status = 'ADULT' then
      select * into a from public.resolve_adult_category(v_code, v_pathway);
      v_category := a.display_label;
      v_type_id := a.canonical_team_type_id;
    else
      declare n record;
      begin
        select * into n from public.resolve_normal_operational_identity(v_code, v_season, v_dob, v_pathway);
        v_type_id := n.canonical_team_type_id;
        if v_type_id is not null then
          select ap.display_label into v_category from internal.allocation_presentation(v_type_id, v_code) ap;
        end if;
      end;
    end if;
  end if;

  insert into public.player_club_join_requests
    (player_id, club_id, requested_by, resolved_category, resolved_canonical_team_type_id)
  values (p_player_id, p_club_id, auth.uid(), v_category, v_type_id)
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.request_to_join_club(uuid, uuid) is
  'A player, or their guardian, asks a club to accept them. Idempotent: an open request is returned rather than duplicated, so a refresh or a re-login never produces a second one.';

-- ---------------------------------------------------------------------------
-- Resolving
-- ---------------------------------------------------------------------------

create or replace function internal.may_resolve_join_request(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Club-wide roster authority, or team roster authority over the specific
  -- squad being assigned. Both are capabilities, never job titles.
  select internal.has_capability('club.roster.manage', 'club', p_club_id, null)
      or (p_team_id is not null and internal.has_capability('team.roster.manage', 'team', p_club_id, p_team_id))
      or internal.is_site_admin();
$function$;

create or replace function public.approve_player_club_join_request(
  p_request_id uuid,
  p_team_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.player_club_join_requests;
  v_team public.teams;
  v_player public.players;
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
  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (r.player_id, p_team_id, 'active', auth.uid());

  update public.player_club_join_requests
  set status = 'approved', placed_team_id = p_team_id, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_club_join_requests', p_request_id, 'update', auth.uid(),
          jsonb_build_object('status', 'approved', 'placed_team_id', p_team_id));

  -- Tell whoever asked. A player with their own login hears it directly; a
  -- child's guardians hear it on their behalf.
  if v_player.user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_player.user_id, 'club_join_approved', 'You have been accepted',
            format('%s have accepted you. You are now in %s.',
              (select cd.name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = r.club_id),
              v_team.display_name),
            jsonb_build_object('player_id', r.player_id, 'team_id', p_team_id));
  end if;
  insert into public.notifications (user_id, type, title, body, data)
  select g.guardian_user_id, 'club_join_approved', 'Join request accepted',
         format('%s has been accepted into %s.', v_player.first_name, v_team.display_name),
         jsonb_build_object('player_id', r.player_id, 'team_id', p_team_id)
  from public.guardians g where g.player_id = r.player_id and g.status = 'active';
end;
$function$;

comment on function public.approve_player_club_join_request(uuid, uuid) is
  'Resolves a join request by placing the player in a squad the club chooses. Locks the request and refuses any transition out of pending, so the first legitimate approver settles it and a second, later click is told it is already resolved rather than creating a duplicate membership.';

create or replace function public.decline_player_club_join_request(
  p_request_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r public.player_club_join_requests; v_player public.players;
begin
  select * into r from public.player_club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0001';
  end if;
  if not internal.may_resolve_join_request(r.club_id, null) then
    raise exception 'You are not authorized to resolve this request.' using errcode = '42501';
  end if;

  select * into v_player from public.players where id = r.player_id;
  if v_player.user_id = auth.uid()
     or exists (select 1 from public.guardians g where g.player_id = r.player_id
                and g.guardian_user_id = auth.uid() and g.status = 'active') then
    raise exception 'You cannot decide a request for your own player.' using errcode = '42501';
  end if;

  update public.player_club_join_requests
  set status = 'declined', decided_by = auth.uid(), decided_at = now(),
      decline_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_request_id;
end;
$function$;

create or replace function public.withdraw_player_club_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r public.player_club_join_requests;
begin
  select * into r from public.player_club_join_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been resolved.' using errcode = 'P0001';
  end if;
  if not (
    exists (select 1 from public.players p where p.id = r.player_id and p.user_id = auth.uid())
    or exists (select 1 from public.guardians g where g.player_id = r.player_id
               and g.guardian_user_id = auth.uid() and g.status = 'active')
  ) then
    raise exception 'Only the player, or their guardian, can withdraw this request.' using errcode = '42501';
  end if;

  update public.player_club_join_requests
  set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = p_request_id;
end;
$function$;

revoke all on function public.request_to_join_club(uuid, uuid) from public;
revoke all on function public.approve_player_club_join_request(uuid, uuid) from public;
revoke all on function public.decline_player_club_join_request(uuid, text) from public;
revoke all on function public.withdraw_player_club_join_request(uuid) from public;
grant execute on function public.request_to_join_club(uuid, uuid) to authenticated;
grant execute on function public.approve_player_club_join_request(uuid, uuid) to authenticated;
grant execute on function public.decline_player_club_join_request(uuid, text) to authenticated;
grant execute on function public.withdraw_player_club_join_request(uuid) to authenticated;
