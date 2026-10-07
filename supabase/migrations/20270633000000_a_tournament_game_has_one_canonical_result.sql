-- =====================================================================================================
-- A TOURNAMENT GAME HAS ONE CANONICAL RESULT.
--
-- Ovalball already has a mature result lifecycle, on fixtures, and this is the same one. It is not a
-- second results architecture: it is the SAME methodology applied to the other kind of game, because a
-- tournament game is a game.
--
-- WHAT IS BORROWED, DELIBERATELY AND LINE FOR LINE WHERE IT FITS:
--
--   a STATUS on the game itself        `fixtures.result_status` -> `tournament_games.result_status`,
--                                      with the same vocabulary: none / awaiting_confirmation / final /
--                                      disputed / amendment_pending.
--   an APPEND-ONLY audit of every      `fixture_result_submissions` ->
--   claim anybody ever made            `tournament_game_result_submissions`. Nothing is overwritten.
--                                      Both sides' versions stay available to the host for ever.
--   the SAME transitions               first submission -> awaiting_confirmation; the same club
--                                      resubmitting replaces its own proposal; the other side matching
--                                      -> final; the other side differing -> disputed; a change after
--                                      final -> amendment_pending.
--
-- WHAT IS DIFFERENT, AND WHY:
--
--   NO HOME AND AWAY. A tournament game is between side A and side B; both have travelled to somebody
--   else's ground. `tournament_games` already carries `side_a_score` and `side_b_score`, and this uses
--   them. Calling them home and away to reuse a column name would be describing the game wrongly.
--
--   THE HOST IS THE FINAL AUTHORITY, not a Site Admin. A tournament is run by a club, and the organiser
--   is the person standing on the touchline who can settle a disagreement about their own festival.
--   `tournament.tournament.manage` is that authority, and it already exists.
--
--   A SIDE THAT IS NOT ON OVALBALL CANNOT SUBMIT. A directory-only side has no members, so there is
--   nobody to authorise -- the host records that game's result themselves, which is what the host
--   resolution path is for.
-- =====================================================================================================

alter table public.tournament_games
  add column if not exists result_status text not null default 'none',
  add column if not exists result_submitted_by uuid references auth.users(id),
  add column if not exists result_submitted_by_participant_id uuid references public.tournament_participants(id),
  add column if not exists result_submitted_at timestamptz,
  add column if not exists result_confirmed_by uuid references auth.users(id),
  add column if not exists result_confirmed_at timestamptz,
  add column if not exists result_resolved_by uuid references auth.users(id),
  add column if not exists result_resolved_at timestamptz,
  add column if not exists result_resolution_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_games_result_status_check') then
    alter table public.tournament_games add constraint tournament_games_result_status_check
      check (result_status in ('none', 'awaiting_confirmation', 'final', 'disputed', 'amendment_pending'));
  end if;
  -- A CONFIRMED RESULT HAS A SCORE. The shape is stated rather than assumed, so a status and a score
  -- can never disagree about whether this game was played.
  if not exists (select 1 from pg_constraint where conname = 'tournament_games_result_shape') then
    alter table public.tournament_games add constraint tournament_games_result_shape
      check (result_status = 'none' or (side_a_score is not null and side_b_score is not null));
  end if;
end $$;

comment on column public.tournament_games.result_status is
  'The canonical result lifecycle, the same vocabulary fixtures use: none / awaiting_confirmation / '
  'final / disputed / amendment_pending. Only `final` is consumed by standings.';

-- ---- every claim anybody ever made ------------------------------------------------------------------

create table if not exists public.tournament_game_result_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tournament_games(id) on delete cascade,
  kind text not null check (kind in ('initial', 'confirmation', 'dispute', 'amendment_proposal', 'host_resolution')),
  side_a_score integer not null check (side_a_score >= 0),
  side_b_score integer not null check (side_b_score >= 0),
  submitted_by uuid not null references auth.users(id),
  -- WHICH SIDE SAID IT. Null for a host resolution, which is not one of the sides speaking.
  submitted_by_participant_id uuid references public.tournament_participants(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists tournament_game_result_submissions_game_idx
  on public.tournament_game_result_submissions (game_id, created_at);

comment on table public.tournament_game_result_submissions is
  'Append-only. Every score anybody ever claimed for a tournament game, with who said it and when. '
  'A contest never overwrites the submission it disagrees with: both stay here so the host resolves a '
  'disagreement by reading it rather than by guessing.';

-- ---- who may say what -------------------------------------------------------------------------------

/**
 * WHICH SIDE THIS PERSON SPEAKS FOR IN THIS GAME, or null.
 *
 * The same shape as `internal.can_submit_fixture_result`: `fixture.result.record` at the side's team
 * scope, or at its club's. A directory-only side has no club on Ovalball and therefore nobody who can
 * speak for it -- which is a fact about that side, not a hole in the authority model.
 */
create or replace function internal.tournament_game_side_for_caller(p_game_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare g record; r record;
begin
  select side_a_id, side_b_id into g from public.tournament_games where id = p_game_id;
  if not found then return null; end if;

  for r in
    select tp.id, tp.club_id, tp.team_id
    from public.tournament_participants tp
    where tp.id in (g.side_a_id, g.side_b_id) and tp.club_id is not null
  loop
    if internal.can('fixture.result.record', 'club', r.club_id, null, null)
       or (r.team_id is not null and internal.can('fixture.result.record', 'team', r.club_id, r.team_id, null)) then
      return r.id;
    end if;
  end loop;
  return null;
end;
$function$;

comment on function internal.tournament_game_side_for_caller(uuid) is
  'The participating side this caller may speak for in this game, or null. Mirrors '
  'internal.can_submit_fixture_result: fixture.result.record at the side''s team or club scope.';

/** Whether this caller is the organiser of the tournament the game belongs to. */
create or replace function internal.can_resolve_tournament_result(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_games g
    where g.id = p_game_id and internal.can_manage_tournament(g.tournament_id)
  );
$function$;

/**
 * A GAME THAT HAS NOT HAPPENED HAS NO RESULT.
 *
 * `internal.fixture_result_eligible` refuses a fixture that has not kicked off and one that is
 * cancelled, and the same two rules apply here. A game with no kick-off time has not been scheduled
 * yet, so it cannot have been played either.
 */
create or replace function internal.tournament_game_result_eligible(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_games g
    where g.id = p_game_id
      and g.status <> 'CANCELLED'
      and g.start_time is not null
      and (g.game_date + g.start_time) <= (now() at time zone 'Europe/London')
  );
$function$;

-- ---- RLS: the audit trail is the two sides' and the host's ------------------------------------------

alter table public.tournament_game_result_submissions enable row level security;

drop policy if exists tournament_game_result_submissions_select_scoped on public.tournament_game_result_submissions;
create policy tournament_game_result_submissions_select_scoped
on public.tournament_game_result_submissions for select
using (
  internal.tournament_game_side_for_caller(game_id) is not null
  or internal.can_resolve_tournament_result(game_id)
);

-- THE SESSION GATE, like every other table. Writes go through the governed functions below, which are
-- SECURITY DEFINER; there is deliberately no INSERT, UPDATE or DELETE policy at all.
drop policy if exists session_ok_required on public.tournament_game_result_submissions;
create policy session_ok_required on public.tournament_game_result_submissions
as restrictive to authenticated using ((select internal.session_ok()));

revoke all on public.tournament_game_result_submissions from anon;
grant select on public.tournament_game_result_submissions to authenticated;
