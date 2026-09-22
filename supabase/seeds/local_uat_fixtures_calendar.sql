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

  -- ---------------------------------------------------------------- pitches at our own ground
  -- WITHOUT THESE THE CONSOLE HAS NO PITCH TO SHOW. The club had a ground and no playing areas, which
  -- is a legitimate state and an unreviewable one: "Pitch — Not set" with an empty selector proves
  -- nothing about whether the selector works.
  if v_venue is not null then
    insert into public.club_pitches (club_id, venue_id, display_name, sort_order, active, created_by)
    select v_club, v_venue, name, ord, true, v_admin
    from (values ('Pitch 1', 1), ('Pitch 2', 2)) as p(name, ord)
    where not exists (
      select 1 from public.club_pitches cp where cp.venue_id = v_venue and cp.display_name = p.name
    );
    raise notice 'local_uat_fixtures_calendar: playing areas recorded at the ground';
  end if;

  -- ---------------------------------------------------------------- an away ground we can route to
  -- An AWAY fixture's ground belongs to the other club, so Ovalball has no venue record for it and the
  -- canonical shape is an address recorded as text by the owning club. Without one, Directions has
  -- nothing to route to and the action correctly does not appear -- which is right, and unreviewable.
  update public.fixtures
     set venue_address = 'Ovalball UAT Opposition RFC, Lightfoot Lane, Preston, PR4 0TA',
         pitch_allocation = coalesce(pitch_allocation, 'Pitch 3')
   where owning_team_id = v_u12
     and raw_opposition_text = 'Ovalball UAT Opposition RFC'
     and venue_address is null;

  -- ---------------------------------------------------------------- a fixture against a real Ovalball club
  -- THE OTHER HALF OF THE REVIEW. Every fixture in the world so far names its opposition from the
  -- Directory or as free text, so "On Ovalball" and Message Opposition could never be seen. Preston
  -- Grasshoppers is a claimed club with a real Under 12 side; this puts the two in a fixture.
  --
  -- ONE ROW WITH AN OPPONENT TEAM, which is exactly what `accept_fixture_request` writes: a single
  -- fixture naming the opposing side. The first attempt here wrote a mirror pair by hand and was
  -- correctly refused by `enforce_shared_team_fixture_capacity` -- a team may hold one match per day,
  -- and the second row counted the first. The platform's own acceptance path does not do that, so
  -- neither does this.
  declare
    v_preston_club uuid;
    v_preston_u12 uuid;
    v_preston_admin uuid;
    v_preston_membership uuid;
    v_ours uuid;
  begin
    select c.id into v_preston_club
      from public.clubs c join public.club_directory d on d.id = c.directory_id
     where d.name = 'Preston Grasshoppers RFC';
    select id into v_preston_u12 from public.teams
     where club_id = v_preston_club and display_name = 'Under 12 Boys';
    select id into v_preston_admin from auth.users where email = 'uat.preston.admin@ovalball.test';

    if v_preston_u12 is not null and v_u12 is not null and v_preston_admin is not null then
      -- SOMEBODY HAS TO STAFF THE OTHER SIDE. `fixture_opposition_contacts` returns people who staff
      -- the opposing TEAM, not merely people who belong to its club -- so a club admin with no team
      -- assignment is correctly nobody to message.
      -- A NAME, so "Message Opposition" names somebody rather than "Ovalball user". Supplied as input
      -- to `internal.normalise_person_name`, which decides the stored form.
      update public.profiles
         set first_name = 'Gareth', surname = 'Hollins'
       where id = v_preston_admin and coalesce(first_name, '') = '';

      select id into v_preston_membership from public.club_memberships
       where club_id = v_preston_club and user_id = v_preston_admin and status = 'active';
      if v_preston_membership is not null then
        insert into public.team_permissions (team_id, membership_id, permission)
        values (v_preston_u12, v_preston_membership, 'coach')
        on conflict do nothing;
      end if;

      if not exists (
        select 1 from public.fixtures
         where owning_team_id = v_u12 and opponent_team_id = v_preston_u12
      ) then
        insert into public.fixtures (owning_team_id, opponent_team_id, kickoff_date, kickoff_time, meet_time,
          home_away, status, raw_opposition_text, season_id, created_by, game_type, venue_id)
        values (v_u12, v_preston_u12, current_date + 10, '10:30', '09:45', 'Home', 'Booked',
          'Preston Grasshoppers RFC', v_season, v_admin, 'League Fixture', v_venue)
        returning id into v_ours;

        -- The named pitch, which only a home fixture may carry.
        update public.fixtures
           set pitch_id = (select id from public.club_pitches where venue_id = v_venue and display_name = 'Pitch 1'),
               pitch_allocation = 'Pitch 1'
         where id = v_ours;

        raise notice 'local_uat_fixtures_calendar: two-sided fixture against a real Ovalball club added';
      end if;
    end if;
  end;

  raise notice 'local_uat_fixtures_calendar: review schedule ready';
end $$;
