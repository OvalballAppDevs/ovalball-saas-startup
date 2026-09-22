-- LOCAL UAT: ENOUGH RUGBY IN THE DIARY TO REVIEW FIXTURES AND CALENDAR WITH.
--
-- The review world had two fixtures and one training session, both in the future and both for one
-- team. That is enough to prove a list renders and nothing else: no past rugby, so the Past segment was
-- empty and a result had never been drawn; no cancelled fixture, so the struck-through treatment was
-- never seen; nothing for the second child, so the Family calendar could not show two children or a
-- clash between them; and nobody without create authority, so "the button is hidden when you may not"
-- could not be looked at.
--
-- WHAT THIS ADDS, and every item is here because a specific thing could not otherwise be reviewed:
--
--   * a PAST fixture with a canonical result, so Past has rugby in it and a scoreline renders
--   * a CANCELLED fixture with a reason, so the struck row and the reason banner are visible
--   * a fixture whose home/away is Away, so both badges can be compared side by side
--   * TRAINING for the second child's team, at the same time as the first child's, so a family clash
--     shows itself without any conflict engine having been written
--   * a TEAM STAFF PERSONA WITHOUT CREATE -- the team admin, with an explicit team-scoped deny -- so the
--     difference between "may manage" and "may look" is reviewable rather than asserted
--
-- Deterministic and idempotent: re-running changes nothing. It never recreates an identity, a club or a
-- team; it only adds rugby to the ones the persistent review world already has.

do $$
declare
  v_club uuid;
  v_u12 uuid;
  v_u8 uuid;
  v_season uuid;
  v_admin uuid;
  v_team_admin uuid;
  v_membership uuid;
  v_fixture uuid;
  v_venue uuid;
begin
  select id into v_admin from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_team_admin from auth.users where email = 'uat.team.admin@ovalball.test';
  select c.id into v_club
    from public.clubs c join public.club_directory d on d.id = c.directory_id
   where d.name = 'Ovalball UAT RUFC';

  if v_admin is null or v_club is null then
    raise notice 'local_uat_fixtures_calendar: review world not present, nothing seeded';
    return;
  end if;

  select id into v_u12 from public.teams where club_id = v_club and display_name = 'Under 12 Boys';
  select id into v_u8 from public.teams where club_id = v_club and display_name = 'Under 8 Mixed';
  select id into v_season from public.seasons order by starts_on desc limit 1;
  select id into v_venue from public.venues where club_id = v_club limit 1;

  -- ---------------------------------------------------------------- past, with a result
  -- A SCORELINE NEEDS BOTH HALVES. The agenda shows a result only where both scores exist, because
  -- half a scoreline is not a result -- so both are written or neither is.
  if v_u12 is not null and not exists (
    select 1 from public.fixtures
     where owning_team_id = v_u12 and raw_opposition_text = 'Fylde RFC' and kickoff_date < current_date
  ) then
    insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, season_id, created_by, home_score, away_score, game_type, venue_id)
    values (v_u12, current_date - 14, '10:30', 'Home', 'Completed',
      'Fylde RFC', v_season, v_admin, 24, 12, 'Friendly', v_venue);
    raise notice 'local_uat_fixtures_calendar: past fixture with a result added';
  end if;

  -- ---------------------------------------------------------------- an away fixture, so both badges show
  if v_u12 is not null and not exists (
    select 1 from public.fixtures where owning_team_id = v_u12 and raw_opposition_text = 'Vale of Lune RUFC'
  ) then
    insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, season_id, created_by, game_type)
    values (v_u12, current_date + 14, '11:00', 'Away', 'Booked', 'Vale of Lune RUFC', v_season, v_admin, 'League Fixture');
    raise notice 'local_uat_fixtures_calendar: away fixture added';
  end if;

  -- ---------------------------------------------------------------- cancelled, with a reason
  -- CANCELLED THROUGH THE CANONICAL PATH would need a session; this is seed data, so the row is written
  -- in the state `cancel_fixture` produces -- including the reason, which is the part that makes the
  -- cancellation useful rather than merely visible.
  if v_u12 is not null and not exists (
    select 1 from public.fixtures where owning_team_id = v_u12 and raw_opposition_text = 'Kirkby Lonsdale RUFC'
  ) then
    insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, season_id, created_by, cancelled_at, cancelled_by, cancellation_reason, game_type)
    values (v_u12, current_date + 21, '10:00', 'Home', 'Cancelled', 'Kirkby Lonsdale RUFC', v_season, v_admin,
      now(), v_admin, 'Pitch waterlogged — inspection failed on Friday evening.', 'Friendly');
    raise notice 'local_uat_fixtures_calendar: cancelled fixture added';
  end if;

  -- ---------------------------------------------------------------- the second child's training, clashing
  -- DELIBERATELY AT THE SAME TIME as the Under 12s' session. A parent with children in two age groups
  -- has this problem every week, and the agenda has to make it obvious by simply showing both rather
  -- than by detecting anything.
  if v_u8 is not null and not exists (
    select 1 from public.training_sessions where team_id = v_u8 and session_date = current_date + 1
  ) then
    insert into public.training_sessions (team_id, club_id, session_date, start_time, end_time, created_by)
    values (v_u8, v_club, current_date + 1, '18:00', '19:00', v_admin);
    raise notice 'local_uat_fixtures_calendar: clashing training for the second child added';
  end if;

  -- ---------------------------------------------------------------- team staff WITHOUT create
  -- The review model needs both halves. The team manager keeps whatever their role bundle grants; the
  -- team admin is given the same team assignment and then an explicit team-scoped DENY on creation, so
  -- the two personas differ in exactly one capability and the interface difference is attributable.
  if v_team_admin is not null and v_u12 is not null then
    select id into v_membership from public.club_memberships
     where club_id = v_club and user_id = v_team_admin and status = 'active';

    if v_membership is not null then
      insert into public.team_permissions (team_id, membership_id, permission)
      values (v_u12, v_membership, 'coach')
      on conflict do nothing;

      if not exists (
        select 1 from public.capability_overrides
         where user_id = v_team_admin and capability_key = 'fixture.fixture.create'
           and team_id = v_u12 and status = 'active'
      ) then
        insert into public.capability_overrides
          (user_id, capability_key, scope_type, club_id, team_id, effect, granted_level, granted_by, reason, status)
        values (v_team_admin, 'fixture.fixture.create', 'team', v_club, v_u12, 'deny', 'TEAM', v_admin,
          'Review persona: team staff who may look after fixtures but not create them.', 'active');
        raise notice 'local_uat_fixtures_calendar: team staff without create prepared';
      end if;
    end if;
  end if;

  raise notice 'local_uat_fixtures_calendar: review schedule ready';
end $$;
