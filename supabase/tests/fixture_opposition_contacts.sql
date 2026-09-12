-- Fixture -> Message opposition (20270258000000).
--
-- The resolver behind the fixture's messaging action. It is deliberately thin
-- -- authority is internal.may_direct_message, unchanged -- so this file
-- proves the four things that are actually ITS responsibility, and does not
-- restate the 28-case direct-messaging matrix.
--
--   1  an internal opponent with eligible adult staff yields contacts
--   2  a Club Directory opponent yields nothing, so the action never appears
--      on a fixture where there is nobody to message
--   3  somebody not involved in the fixture gets nothing, and learns nothing
--   4  policy OFF and U18 are refused here too, because the authority is
--      shared rather than reimplemented
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_opposition_contacts.sql
--
-- The cross-club fixture is built inside the transaction: every fixture in
-- this database names its opponent from the Club Directory, so no existing
-- row can exercise the internal-opponent path. Rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_coach uuid;       -- staffs our side
  v_outsider uuid;    -- will staff the opposing side
  v_uninvolved uuid;
  v_minor uuid;
  v_club uuid;
  v_club2 uuid;
  v_team1 uuid;
  v_team2 uuid;
  v_fixture uuid;
  v_external uuid;
  n integer;
begin
  select id into v_coach      from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_outsider   from auth.users where email = 'uat.unrelated@ovalball.test';
  select id into v_uninvolved from auth.users where email = 'uat.guardian.three@ovalball.test';
  select id into v_minor      from auth.users where email = 'uat.player.self@ovalball.test';

  if v_coach is null or v_outsider is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  select club_id into v_club from public.club_memberships where user_id = v_coach and status = 'active' limit 1;

  -- Two teams of the same age grade at different clubs -- age eligibility is
  -- a real product guard and a mismatched pair cannot be put in a fixture.
  select a.id, b.id, b.club_id into v_team1, v_team2, v_club2
  from public.teams a
  join public.teams b on b.display_name = a.display_name and b.club_id <> a.club_id
  where a.club_id = v_club
  limit 1;

  if v_team2 is null then
    raise notice 'SKIP: this database has no second club with a matching age-grade team';
    return;
  end if;

  -- The outsider becomes a club official at the opposing club, which is what
  -- makes them staff of the opposing team.
  insert into public.club_memberships (user_id, club_id, role, status)
  values (v_outsider, v_club2, 'CLUB_ADMIN', 'active') on conflict do nothing;

  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_team1, v_team2, 'Home',
          (select display_name from public.teams where id = v_team2),
          current_date + 7, 'Booked', 'club_created')
  returning id into v_fixture;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- 1. AN INTERNAL OPPONENT YIELDS THE PEOPLE RUNNING THAT TEAM
  -- =================================================================
  select count(*) into n from public.fixture_opposition_contacts(v_fixture) where user_id = v_outsider;
  if n = 1 then
    raise notice 'PASS 1: the opposing team''s staff are offered as fixture contacts';
  else
    raise notice 'FAIL 1: the opposition contact was not resolved (% rows)', n;
  end if;

  -- And the row carries the context a person needs to recognise a stranger.
  if exists (
    select 1 from public.fixture_opposition_contacts(v_fixture)
    where user_id = v_outsider and team_label is not null and club_label is not null
  ) then
    raise notice 'PASS 2: each contact names the opposing team and club';
  else
    raise notice 'FAIL 2: contacts arrived without team/club context';
  end if;

  -- =================================================================
  -- 3. A CLUB DIRECTORY OPPONENT YIELDS NOTHING
  -- There is no one to message, so the action must not appear at all.
  -- =================================================================
  select id into v_external from public.fixtures where opponent_team_id is null limit 1;
  if v_external is null then
    raise notice 'SKIP 3: no directory-opponent fixture present';
  else
    select count(*) into n from public.fixture_opposition_contacts(v_external);
    if n = 0 then
      raise notice 'PASS 3: a fixture whose opponent is a directory name offers nobody';
    else
      raise notice 'FAIL 3: an external-opponent fixture produced % contact(s)', n;
    end if;
  end if;

  -- =================================================================
  -- 4. SOMEBODY NOT IN THE FIXTURE GETS NOTHING
  -- =================================================================
  if v_uninvolved is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uninvolved, 'role', 'authenticated')::text, true);
    select count(*) into n from public.fixture_opposition_contacts(v_fixture);
    if n = 0 then
      raise notice 'PASS 4: somebody not involved in the fixture is offered nobody';
    else
      raise notice 'FAIL 4: an uninvolved user read % opposition contact(s)', n;
    end if;
  end if;

  -- =================================================================
  -- 5. THE SHARED AUTHORITY STILL APPLIES HERE
  -- Policy off must close the fixture route too, or the fixture becomes a
  -- way around the policy.
  -- =================================================================
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = false where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  select count(*) into n from public.fixture_opposition_contacts(v_fixture);
  if n = 0 then
    raise notice 'PASS 5: direct messaging off closes the fixture route as well';
  else
    raise notice 'FAIL 5: the fixture route bypassed the policy (% contacts)', n;
  end if;

  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = true where club_id is null;

  -- 6. And one club objecting closes it, with the site switch still on.
  insert into public.message_policies (club_id, allow_direct_messaging)
  values (v_club2, false)
  on conflict (club_id) where club_id is not null do update set allow_direct_messaging = false;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  select count(*) into n from public.fixture_opposition_contacts(v_fixture);
  if n = 0 then
    raise notice 'PASS 6: the opposing club switching it off closes the fixture route';
  else
    raise notice 'FAIL 6: one club''s objection did not close the fixture route';
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.message_policies where club_id = v_club2;

  -- =================================================================
  -- 7. A U18 IS NEVER A FIXTURE CONTACT
  -- =================================================================
  if v_minor is not null then
    insert into public.club_memberships (user_id, club_id, role, status)
    values (v_minor, v_club2, 'CLUB_ADMIN', 'active') on conflict do nothing;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

    select count(*) into n from public.fixture_opposition_contacts(v_fixture) where user_id = v_minor;
    if n = 0 then
      raise notice 'PASS 7: a U18 is never offered as a fixture contact, even as opposing staff';
    else
      raise notice 'FAIL 7: a minor was offered through the fixture route';
    end if;
  end if;
end $$;

rollback;
