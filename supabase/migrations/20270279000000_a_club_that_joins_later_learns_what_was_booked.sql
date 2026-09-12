-- =====================================================================
-- A CLUB THAT JOINS LATER LEARNS WHAT WAS ALREADY BOOKED AGAINST IT
--
-- When a club activates on Ovalball, internal.reconcile_opponent_directory_
-- requests already reconnects the fixture REQUESTS other clubs sent to its
-- Club Directory entry before it existed here. That was the whole of
-- join-later, and it left a hole that the Mass Fixture Planner makes much
-- bigger.
--
-- A request is a negotiation. A FIXTURE is not: when the opponent is a
-- directory club rather than an Ovalball team, the arranging club simply
-- records the match, because there is nobody on the other side to ask.
-- Those fixtures are real, they are in the arranging club's calendar, and
-- their opponent has no idea. A season pasted into the planner creates
-- dozens of them in one action.
--
-- So when that opponent joins, they are TOLD. Once, per fixture, naming
-- the club and the date.
--
-- WHAT THIS DELIBERATELY DOES NOT DO IS LINK THEM.
--
-- Setting opponent_team_id would convert a booking somebody else made into
-- a confirmed two-sided Ovalball fixture that this club never agreed to,
-- appearing in their calendar and their parents' agendas on day one. The
-- platform rule is that an Ovalball opponent is ASKED, never booked, and a
-- club joining must not be the one moment that rule is suspended. Nothing
-- here writes to fixtures at all.
--
-- Past fixtures are skipped for the same reason the request path expires
-- them: a club joining today does not need a backlog of matches that have
-- already been played, and the arranging club's historical record is
-- theirs and stays as it is.
-- =====================================================================

create or replace function internal.reconcile_opponent_directory_requests()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_group record;
  v_request record;
  v_fixture record;
  v_recipient uuid;
  v_requesting_club_name text;
  v_is_future boolean;
begin
  -- ================================================================
  -- UNCHANGED: the fixture REQUESTS sent to this directory entry.
  -- ================================================================
  for v_group in
    select id, requesting_club_id, raw_opponent_text, proposed_date
    from public.fixture_request_groups
    where opponent_directory_id = new.directory_id and opponent_club_id is null
  loop
    update public.fixture_request_groups set opponent_club_id = new.id where id = v_group.id;

    v_is_future := v_group.proposed_date >= current_date;

    if not v_is_future then
      -- The proposed date has already passed and this negotiation was never
      -- accepted -- there is nothing left to accept. Quietly expire it
      -- (reusing the existing fixture_requests.status vocabulary) instead
      -- of surfacing it as a pending request and building a backlog for a
      -- club that just joined.
      update public.fixture_requests
      set status = 'expired', decided_at = now()
      where group_id = v_group.id and status = 'sent';
      continue;
    end if;

    select cd.name into v_requesting_club_name
    from public.clubs c join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id;

    for v_request in
      select id, requesting_team_id from public.fixture_requests where group_id = v_group.id and status = 'sent'
    loop
      for v_recipient in
        select cm.user_id
        from public.club_memberships cm
        where cm.club_id = new.id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_recipient,
          'fixture_request_received',
          'Outstanding fixture request',
          format('%s proposed a fixture on %s, from before your club activated Ovalball.', coalesce(v_requesting_club_name, 'A club'), to_char(v_group.proposed_date, 'DD Mon YYYY')),
          jsonb_build_object('fixture_request_id', v_request.id, 'group_id', v_group.id)
        );
      end loop;
    end loop;
  end loop;

  -- ================================================================
  -- NEW: the fixtures already RECORDED against this directory entry.
  --
  -- Read-only with respect to the fixture. The arranging club's record
  -- is not altered, and nothing becomes a confirmed Ovalball fixture
  -- for the joining club without them arranging it themselves.
  -- ================================================================
  for v_fixture in
    select f.id, f.kickoff_date, f.kickoff_time, t.display_name as their_team, cd.name as arranging_club
    from public.fixtures f
    join public.teams t on t.id = f.owning_team_id
    join public.clubs c on c.id = t.club_id
    left join public.club_directory cd on cd.id = c.directory_id
    where f.opponent_directory_id = new.directory_id
      and f.opponent_team_id is null
      and f.kickoff_date >= current_date
      and f.status <> 'Cancelled'
      -- A fixture this club's own new tenant row somehow owns is not news
      -- to them; only somebody else's booking is.
      and t.club_id <> new.id
    order by f.kickoff_date
  loop
    for v_recipient in
      select cm.user_id
      from public.club_memberships cm
      where cm.club_id = new.id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    loop
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_recipient,
        'fixture_request_received',
        'A fixture is already booked against your club',
        format(
          '%s has %s down to play you on %s. It was arranged before your club activated Ovalball, so it is their record rather than a fixture you have agreed — check it is right with them.',
          coalesce(v_fixture.arranging_club, 'Another club'),
          v_fixture.their_team,
          to_char(v_fixture.kickoff_date, 'DD Mon YYYY')
        ),
        jsonb_build_object('fixture_id', v_fixture.id)
      );
    end loop;
  end loop;

  return new;
end;
$function$;

comment on function internal.reconcile_opponent_directory_requests() is
  'When a club activates, reconnects fixture requests sent to its Club Directory entry and tells its fixture staff about future fixtures other clubs already recorded against it. Never links those fixtures to the new club: an Ovalball opponent is asked, never booked, and joining is not an exception to that.';
