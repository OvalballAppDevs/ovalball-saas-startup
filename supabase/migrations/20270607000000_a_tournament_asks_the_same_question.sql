-- =====================================================================================================
-- "ARE YOU COMING?" IS ONE QUESTION, AND A TOURNAMENT IS THE FOURTH THING THAT ASKS IT.
--
-- Ovalball already has exactly one attendance record: `player_fixture_attendance`, with a status of
-- ATTENDING / CANNOT_ATTEND / UNSURE, one nullable foreign key per kind of dated activity, and a CHECK
-- that insists on precisely one of them being set. A fixture, a training session and a club event each
-- took their turn. A tournament -- which is the single most attendance-shaped thing a club does all
-- season, because it needs numbers, transport and a squad list a fortnight out -- had no way to ask.
--
-- THE ALTERNATIVE WAS WORSE THAN DOING NOTHING. A tournament could have been modelled as a set of
-- fixtures and the existing question reused. It is not a set of fixtures: a child's parent would then
-- be asked four times for one Saturday, could answer yes to the first game and no to the third, and
-- the squad list would depend on which game you looked at. So the response attaches to the TOURNAMENT.
--
-- ONE TOURNAMENT, ONE ANSWER -- INCLUDING A MULTI-DAY ONE. The unique index is on (tournament_id,
-- player_id). A festival that runs Saturday and Sunday asks once, because a club taking a squad away
-- for a weekend takes the same squad on both days; per-day availability is a different question and
-- this migration deliberately does not invent it. If it is ever wanted, it is a new column on this row,
-- not a second row and not a second table.
--
-- NO STAFF OVERRIDE, HERE OR ANYWHERE. `internal.resolve_attendance_response_source` is the one
-- authority: an active guardian answers for a child, an adult player answers for themselves, a 16- or
-- 17-year-old answers only with recorded guardian consent, and nobody under 16 answers at all. A coach
-- cannot mark a child as attending on the child's behalf -- that is true of fixtures, training and
-- events today, and a tournament does not get to be the exception.
--
-- A RESPONSE IS NOT PUBLIC TO THE OTHER CLUBS. The row-level policy added here shows a named response
-- only to the player's own family and to staff holding `team.attendance.view` over the side that
-- player is entered with. A tournament has many clubs in it, and the host organising the day has a
-- legitimate need for NUMBERS; it has no business reading another club's roster. The count, and only
-- the count, is what the Tournament Centre's participant view exposes -- which is a read model, built
-- on top of this and deliberately not reachable by relaxing this.
-- =====================================================================================================

-- ---- the fourth activity --------------------------------------------------------------------------

alter table public.player_fixture_attendance
  add column if not exists tournament_id uuid references public.tournaments(id) on delete cascade;

-- The CHECK is restated rather than widened in place: "exactly one" is the whole point of the column
-- set, and a tournament response carrying a fixture id as well would be a response to two things.
alter table public.player_fixture_attendance
  drop constraint if exists player_fixture_attendance_activity_check;
alter table public.player_fixture_attendance
  add constraint player_fixture_attendance_activity_check
  check (num_nonnulls(fixture_id, training_session_id, event_id, tournament_id) = 1);

create unique index if not exists player_fixture_attendance_tournament_unique
  on public.player_fixture_attendance (tournament_id, player_id)
  where tournament_id is not null;

create index if not exists player_fixture_attendance_tournament_id_idx
  on public.player_fixture_attendance (tournament_id)
  where tournament_id is not null;

comment on column public.player_fixture_attendance.tournament_id is
  'The tournament this response is about. One row per player per tournament, however many days it runs '
  'and however many games their side plays: a club takes one squad away for the weekend.';

-- ---- who may READ a named response ----------------------------------------------------------------
--
-- Modelled on the training policy, with one deliberate difference: the staff branch is scoped to the
-- team the player is ENTERED with, not to the tournament. Several clubs are in the room.

drop policy if exists player_fixture_attendance_select_tournament_scoped on public.player_fixture_attendance;
create policy player_fixture_attendance_select_tournament_scoped
  on public.player_fixture_attendance
  for select
  using (
    tournament_id is not null
    and (
      internal.has_site_capability('site.fixtures.view')
      or internal.is_active_player_guardian(player_id)
      or internal.is_own_linked_player(player_id)
      -- The player's OWN side's staff. The join through tournament_participants is what keeps this
      -- to the club that entered them: another participating club's coach matches nothing here,
      -- however legitimately they can see the tournament itself.
      or exists (
        select 1
        from public.tournament_participants tp
        join public.player_team_memberships ptm
          on ptm.team_id = tp.team_id
         and ptm.player_id = player_fixture_attendance.player_id
         and ptm.status = 'active'
        where tp.tournament_id = player_fixture_attendance.tournament_id
          and tp.team_id is not null
          and tp.club_id is not null
          and (
            internal.has_capability('team.attendance.view', 'team', tp.club_id, tp.team_id)
            or internal.has_capability('team.attendance.view', 'club', tp.club_id, null)
          )
      )
    )
  );

-- ---- answering ------------------------------------------------------------------------------------

create or replace function public.respond_to_tournament_attendance(
  p_tournament_id uuid,
  p_player_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source text;
  v_tournament public.tournaments;
begin
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE session gate on the table never runs for this
  -- path and has to be asked for explicitly.
  perform internal.require_live_session();

  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Unknown response.' using errcode = '22023';
  end if;

  select * into v_tournament from public.tournaments where id = p_tournament_id;
  if v_tournament.id is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if v_tournament.cancelled_at is not null or v_tournament.status = 'cancelled' then
    raise exception 'This tournament has been cancelled, so no answer is needed.' using errcode = '22023';
  end if;

  -- The player must actually be in a side that is entered, or the response is about a relationship
  -- that does not exist. Entry is by TEAM, so a child at the club whose age group is not going is
  -- correctly refused rather than silently recorded.
  if not exists (
    select 1
    from public.tournament_participants tp
    join public.player_team_memberships ptm on ptm.team_id = tp.team_id
    where tp.tournament_id = p_tournament_id
      and tp.team_id is not null
      and ptm.player_id = p_player_id
      and ptm.status = 'active'
  ) then
    raise exception 'That player is not in a team entered in this tournament.' using errcode = '42501';
  end if;

  -- The one authority. It raises its own specific refusal for a 16-17 year old without consent and
  -- for anybody under 16, which is why its result is not merely tested for null.
  v_source := internal.resolve_attendance_response_source(p_player_id);
  if v_source is null then
    raise exception 'You cannot respond for this player.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (tournament_id, player_id, status, responded_by_user_id, response_source)
  values (p_tournament_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (tournament_id, player_id) where tournament_id is not null
  do update set
    status = excluded.status,
    responded_by_user_id = excluded.responded_by_user_id,
    response_source = excluded.response_source,
    updated_at = now();
end;
$function$;

comment on function public.respond_to_tournament_attendance(uuid, uuid, text) is
  'Records one player''s answer to one tournament. Authority comes from '
  'internal.resolve_attendance_response_source -- guardian, adult player, or a 16-17 year old with '
  'recorded consent -- and there is no staff override: a coach cannot answer for a child.';

revoke all on function public.respond_to_tournament_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.respond_to_tournament_attendance(uuid, uuid, text) to authenticated;
grant execute on function public.respond_to_tournament_attendance(uuid, uuid, text) to service_role;
