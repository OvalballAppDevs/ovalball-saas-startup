-- Slice 4C -- part 3: retire the direct fixture-creation bypass (Phase 2 AA.3 row 4c
-- "direct fixture writes"; J.6 line 457 "MERGE (removes the direct-insert bypass)").
--
-- WHAT WAS WRONG
--
-- "An Ovalball opponent is asked, never booked" is a product invariant: a fixture against
-- another Ovalball club goes through fixture_requests and that club's Confirm / Request Change /
-- Decline. Until now that invariant lived only in the createFixture server action. The database
-- did not enforce it, and `authenticated` held a direct INSERT grant on public.fixtures, so a
-- REST client could write the fixture itself. Measured, as a Team Manager holding legitimate
-- team-scoped fixture.fixture.create:
--
--   direct insert naming another ACTIVE Ovalball club's team  -> INSERTED, no request, no verification
--
-- The other club received a fixture it never agreed to and had nothing to answer.
--
-- WHAT THIS MIGRATION DOES
--
-- This migration adds public.create_fixture: the canonical creation contract. It derives the club
-- and the opposition's Ovalball status server-side, requires canonical fixture.fixture.create, and
-- routes an Ovalball opposition into the request flow instead of writing a fixture.
--
-- The revoke that actually closes the bypass is deliberately NOT here. It is the next migration,
-- 20270361000000, because it is a contract step: it removes a privilege the currently deployed
-- application still uses. This migration is pure expand -- it only adds the function -- so it is
-- safe to apply while the old application is still serving, and it must be, because the new
-- application calls public.create_fixture the moment it deploys.
--
-- SELECT and UPDATE are deliberately left alone: they are reading and editing, separate operations
-- with their own policies and their own Phase 2 owners. This migration retires creation only.
--
-- The other three creation paths are unchanged and keep their own contracts:
-- accept_fixture_request (creates the fixture only after the other club accepts),
-- publish_import_row (fixture.import.run), and internal.project_competition_match, which is the
-- Competition Match projection and belongs to 4D.

create or replace function public.create_fixture(
  p_owning_team_id uuid,
  p_home_away text,
  p_raw_opposition_text text,
  p_kickoff_date date,
  p_status text,
  p_opponent_team_id uuid default null,
  p_opponent_directory_id uuid default null,
  p_kickoff_time time default null,
  p_game_type text default null,
  p_venue_id uuid default null,
  p_pitch_id uuid default null,
  p_notes text default null,
  p_competition_edition_id uuid default null,
  -- Central Fixture Participant Resolution: when the opposition is a claimed Ovalball club that has
  -- not named a team yet, the request still has to say WHICH side is being asked for, or the other
  -- club receives a request it cannot answer. These describe the team being asked for, never the
  -- caller's own authority, so they are safe to accept as arguments -- and they are ignored outright
  -- when p_opponent_team_id already names a real team.
  p_target_team_age_group text default null,
  p_target_team_gender text default null,
  p_target_team_squad_designation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
  v_opponent_club_id uuid;
  v_opponent_directory_id uuid;
  v_fixture_id uuid;
  v_group_id uuid;
  v_venue_pref text;
  v_hosting boolean;
  v_club_authorised boolean;
  v_source text;
begin
  -- 1. Scope is derived from the resource, never taken from the caller.
  select club_id into v_club_id from public.teams where id = p_owning_team_id and active;
  if v_club_id is null then
    raise exception 'That team does not exist or is not active.' using errcode = '22023';
  end if;

  -- 2. Authority. fixture.fixture.create at the owning team, or club-wide. Creating a fixture
  --    never implies Planner, Import, bulk edit or competition generation: those are separate
  --    keys with no team bundle at all.
  --
  --    Which of the three answers granted the call is also the honest provenance of the row.
  --    fixtures.source distinguishes 'club_created' from 'site_admin_manual' and the Site Admin
  --    fixtures list filters on it, so the value has to keep meaning what it says. It is derived
  --    here rather than accepted as an argument, because a caller must not be able to describe
  --    their own fixture as somebody else's work -- but "derived" has to mean derived correctly,
  --    not fixed to one constant.
  v_club_authorised := internal.can('fixture.fixture.create', 'team', v_club_id, p_owning_team_id, null)
                       or internal.can('fixture.fixture.create', 'club', v_club_id, null, null);
  if not (v_club_authorised or internal.has_site_capability('site.fixtures.support')) then
    raise exception 'You are not authorised to create a fixture for this team.' using errcode = '42501';
  end if;
  v_source := case when v_club_authorised then 'club_created' else 'site_admin_manual' end;

  if coalesce(trim(p_raw_opposition_text), '') = '' then
    raise exception 'An opponent (resolved team, or a description) is required.' using errcode = '22023';
  end if;
  if p_kickoff_date is null then
    raise exception 'A kickoff date is required to publish a scheduled fixture.' using errcode = '22023';
  end if;

  -- 3. Is the opposition another Ovalball club? Decided here, from the resource, so that a caller
  --    cannot make an Ovalball opponent look external by withholding or altering a field.
  if p_opponent_team_id is not null then
    select t.club_id, c.directory_id into v_opponent_club_id, v_opponent_directory_id
    from public.teams t join public.clubs c on c.id = t.club_id
    where t.id = p_opponent_team_id and c.status = 'active';
  elsif p_opponent_directory_id is not null then
    select c.id, c.directory_id into v_opponent_club_id, v_opponent_directory_id
    from public.clubs c where c.directory_id = p_opponent_directory_id and c.status = 'active';
  end if;

  -- 4. An Ovalball opponent is ASKED, never booked. The fixture is not created here; a request is,
  --    and the other club answers it. This is the invariant that used to live only in the
  --    application and could be walked around with a direct insert.
  if v_opponent_club_id is not null and v_opponent_club_id is distinct from v_club_id then
    v_venue_pref := case p_home_away when 'Home' then 'home' when 'Away' then 'away' else 'either' end;
    v_hosting := v_venue_pref = 'home';

    insert into public.fixture_request_groups
      (requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text,
       proposed_date, notes, game_type, competition_edition_id, created_by)
    values
      (v_club_id, v_opponent_club_id, v_opponent_directory_id, trim(p_raw_opposition_text),
       p_kickoff_date, nullif(trim(coalesce(p_notes, '')), ''), p_game_type, p_competition_edition_id, auth.uid())
    returning id into v_group_id;

    insert into public.fixture_requests
      (group_id, requesting_team_id, target_team_id, venue_preference, preferred_kickoff_time,
       pitch_id, venue_id, target_team_age_group, target_team_gender, target_team_squad_designation,
       created_by)
    values
      (v_group_id, p_owning_team_id, p_opponent_team_id, v_venue_pref, p_kickoff_time,
       case when v_hosting then p_pitch_id end, case when v_hosting then p_venue_id end,
       case when p_opponent_team_id is null then p_target_team_age_group end,
       case when p_opponent_team_id is null then p_target_team_gender end,
       case when p_opponent_team_id is null then p_target_team_squad_designation end,
       auth.uid());

    return jsonb_build_object('pendingRequest', true, 'fixtureId', null, 'requestGroupId', v_group_id);
  end if;

  -- 5. External or unclaimed opposition: recorded directly, because nobody on the other side can
  --    answer. source records which authority granted the call, and is never accepted from the
  --    caller: a club person's fixture is 'club_created', and one created purely on the site
  --    capability is 'site_admin_manual', which is what the Site Admin list's filter means.
  insert into public.fixtures
    (owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
     kickoff_date, kickoff_time, game_type, status, venue_id, pitch_id, notes,
     competition_edition_id, source)
  values
    (p_owning_team_id, p_home_away, p_opponent_team_id, p_opponent_directory_id, trim(p_raw_opposition_text),
     p_kickoff_date, p_kickoff_time, p_game_type, p_status, p_venue_id, p_pitch_id,
     nullif(trim(coalesce(p_notes, '')), ''), p_competition_edition_id, v_source)
  returning id into v_fixture_id;

  return jsonb_build_object('pendingRequest', false, 'fixtureId', v_fixture_id);
end;
$$;

comment on function public.create_fixture(uuid, text, text, date, text, uuid, uuid, time, text, uuid, uuid, text, uuid, text, text, text) is
  'Slice 4C canonical fixture creation. Derives club and opposition status from the resource, requires '
  'fixture.fixture.create at the owning team or its club, and routes an Ovalball opposition into the '
  'request/verification flow instead of writing a fixture. Replaces the direct INSERT bypass.';

revoke all on function public.create_fixture(uuid, text, text, date, text, uuid, uuid, time, text, uuid, uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.create_fixture(uuid, text, text, date, text, uuid, uuid, time, text, uuid, uuid, text, uuid, text, text, text) to authenticated;
