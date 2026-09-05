-- SENIOR COHORT GRADUATION (Mini-Rugby / Team Administration / Season
-- Handover brief, amendment): Senior Colts and Girls U16 are the two
-- terminal youth/colts cohorts in this club structure -- there is no
-- mechanical "next age grade" for either of them (internal.
-- next_age_grade already returns null past U16, and Senior Colts sits
-- in category = 'colts', entirely outside generate_rollover_proposal's
-- own `category = 'youth'` loop). Left alone, a Club Admin has no
-- structured way to close out that cohort at all -- this migration
-- adds one: ARCHIVE the cohort as its own permanent historical team
-- (never silently reused as "Men's 1st" or any other adult team), and
-- put its players into a genuine holding workflow state rather than a
-- fake team, so which real adult team (if any) each graduate joins
-- remains an explicit, later, human decision -- never automatic, and
-- staff/coach records on the graduating team are never carried forward
-- with them.

alter table public.teams add column archived_at timestamptz;
alter table public.teams add column archived_by uuid references auth.users(id);
comment on column public.teams.archived_at is
  'Set only by graduate_team() -- distinct from folded_at (a team discontinued mid-life, e.g. for lack of players): an archived team reached the natural end of its cohort''s life (Senior Colts / Girls U16 graduating), keeps its full fixture history exactly as it was, and is never reactivated or reused as a different team''s identity.';

create table public.player_graduation_queue (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id),
  source_team_id uuid not null references public.teams(id),
  club_id uuid not null references public.clubs(id),
  status text not null default 'pending_placement' check (status in ('pending_placement', 'placed', 'left_club')),
  placed_team_id uuid references public.teams(id),
  placed_by uuid references auth.users(id),
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, source_team_id)
);

comment on table public.player_graduation_queue is
  'The GRADUATING PLAYERS holding workflow state -- one row per player whose Senior Colts / Girls U16 team was just archived. pending_placement is the default and can persist indefinitely; placed_team_id is set ONLY by an explicit later human action (place_graduating_player), never automatically and never defaulted to any particular adult team. This table, not a fake team, is what "graduating players" means in this product -- a player here is not a member of any team until placed.';

alter table public.player_graduation_queue enable row level security;

create policy player_graduation_queue_select on public.player_graduation_queue
  for select using (internal.can_manage_club_fixtures(club_id) or internal.is_site_admin());

-- graduate_team: archives a Senior Colts or Girls U16 team and queues
-- its currently-active players for placement. Deliberately narrow --
-- only these two specific terminal cohorts qualify, matching exactly
-- what this brief names; any other team should use the ordinary
-- rollover Confirm/Adjust/Fold/Defer flow or plain fold_team instead.
create or replace function public.graduate_team(p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.teams;
  v_season_name text;
  v_archive_label text;
  v_queued_count integer := 0;
begin
  select * into t from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found.';
  end if;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may graduate a cohort.' using errcode = '42501';
  end if;
  if not t.active then
    raise exception 'This team is already inactive.';
  end if;
  if not ((t.category = 'colts' and t.age_group = 'SeniorColts') or (t.category = 'youth' and t.age_group = 'U16' and t.gender = 'girls')) then
    raise exception 'Only a Senior Colts or Girls U16 team can be graduated this way. Every other team should use the ordinary Season Rollover decision (Confirm/Adjust/Fold/Defer).';
  end if;

  select name into v_season_name from public.seasons where id = internal.resolve_season_for_date(t.rugby_code, current_date);
  v_archive_label := trim(t.display_name) || coalesce(' (' || v_season_name || ')', '') || ' Archive';

  update public.teams
  set active = false, archived_at = now(), archived_by = auth.uid(), display_name = v_archive_label
  where id = p_team_id;

  insert into public.player_graduation_queue (player_id, source_team_id, club_id)
  select ptm.player_id, t.id, t.club_id
  from public.player_team_memberships ptm
  where ptm.team_id = t.id and ptm.status = 'active' and ptm.ended_at is null
  on conflict (player_id, source_team_id) do nothing;
  get diagnostics v_queued_count = row_count;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('event', 'graduated', 'archive_label', v_archive_label, 'players_queued', v_queued_count));

  return v_queued_count;
end;
$$;

grant execute on function public.graduate_team(uuid) to authenticated;

-- place_graduating_player: the explicit, later, one-player-at-a-time
-- human decision this whole holding state exists to require. Never
-- called automatically by graduate_team or anything else -- a Club
-- Admin (or the target team's own manager/coach) chooses, per player,
-- whether and where they continue, on their own timeline.
create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q public.player_graduation_queue;
  v_target_club_id uuid;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select club_id into v_target_club_id from public.teams where id = p_target_team_id;
  if v_target_club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.can_manage_team(p_target_team_id) or internal.can_manage_club_fixtures(q.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (q.player_id, p_target_team_id, 'active', auth.uid());

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$$;

grant execute on function public.place_graduating_player(uuid, uuid) to authenticated;

-- mark_graduating_player_left: the honest alternative to placement --
-- records that a graduate is not continuing at this club at all,
-- again as an explicit human decision, never inferred from silence.
create or replace function public.mark_graduating_player_left(p_queue_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q public.player_graduation_queue;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  if not (internal.can_manage_club_fixtures(q.club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to update this player''s graduation status.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  update public.player_graduation_queue set status = 'left_club', updated_at = now() where id = p_queue_id;
end;
$$;

grant execute on function public.mark_graduating_player_left(uuid) to authenticated;
