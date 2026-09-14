-- ONE FIXTURE EDITOR: ONE ANSWER TO "WHAT MAY I CHANGE ON THIS FIXTURE?"
--
-- A fixture was edited from Calendar, the Fixture Control Centre (row editor,
-- bulk planner, detail page) and the Site Admin form, and each surface decided
-- for itself which fields to show and wrote some of them straight to the table.
-- Two editors wiped the venue on every save; a Fixture Secretary could not save
-- the direct-write fields at all (fixtures RLS uses can_manage_team, which does
-- not include the role); and nothing could turn a TBD fixture into Home or Away.
--
-- 1. public.fixture_editable_fields(fixture) returns, per field group, whether
--    the signed-in person may change it and why not. It is computed from the
--    SAME predicates the writing functions enforce, so the editor offers exactly
--    what the database will accept, whichever surface opens it:
--      schedule (date, kick-off) and meet time -- update_fixture_schedule /
--        update_fixture_meet_time: internal.can_submit_fixture_result or Site Admin
--      venue and pitch -- the same, and only once the fixture has a home side
--      competition -- update_fixture_competition: the owning club's fixture
--        administrators or Site Admin
--      opposition and our team -- update_fixture_opposition /
--        update_fixture_owning_team: owning team staff, owning club's fixture
--        administrators, or Site Admin
--      details (fixture type, notes, status, home/away) -- update_fixture_details
--    A fixture scheduled by a competition keeps its competition-controlled fields
--    locked here too, with the competition named.
--
-- 2. public.update_fixture_details(fixture, patch) writes the fields that had no
--    function of their own. Authority: owning team staff, the owning club's
--    fixture administrators (Fixture Secretary included), or Site Admin.
--    Home/Away may be set from TBD or Not Applicable, and swapping it on a
--    fixture with a result swaps the scores with it. An Ovalball opponent is told
--    when the side or status of their shared fixture changes.
--
-- 3. public.bulk_update_fixtures (the Control Centre's Save) keeps the date on
--    a time-only change and the time on a date-only change. A time-only edit was
--    skipped while being reported as saved, and a date-only edit cleared the
--    kick-off.

insert into public.notification_types (type_key, topic_key) values
  ('fixture_details_changed', 'fixture_updates')
on conflict (type_key) do nothing;

create or replace function internal.can_edit_fixture_details(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.fixtures f
    where f.id = p_fixture_id
      and (
        internal.is_site_admin()
        or internal.can_manage_team(f.owning_team_id)
        or internal.can_manage_club_fixtures((select t.club_id from public.teams t where t.id = f.owning_team_id))
      )
  );
$$;

create or replace function public.fixture_editable_fields(p_fixture_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_schedule boolean;
  v_owning_side boolean;
  v_competition_name text;
  v_cancelled boolean;
  v_locked text;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;
  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  v_cancelled := f.status = 'Cancelled';
  v_schedule := internal.can_submit_fixture_result(f.id) or internal.is_site_admin();
  v_owning_side := internal.can_edit_fixture_details(f.id);

  select c.name into v_competition_name
  from public.competition_match_fixtures l
  join public.competition_matches m on m.id = l.match_id
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where l.fixture_id = f.id;
  v_locked := case when v_competition_name is not null then format('Set by the competition "%s". Ask the organiser to change it.', v_competition_name) end;

  return jsonb_build_object(
    'schedule', jsonb_build_object('editable', v_schedule and not v_cancelled and v_locked is null,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the date and kick-off.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'meetTime', jsonb_build_object('editable', v_schedule and not v_cancelled,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the meet time.' when v_cancelled then 'This fixture is cancelled.' end),
    -- Away with no Ovalball home team: the ground is recorded by name, by the owning club.
    'venue', jsonb_build_object('editable', not v_cancelled and ((v_schedule and f.home_team_id is not null) or (v_owning_side and f.home_away = 'Away' and f.home_team_id is null)),
      'reason', case when v_cancelled then 'This fixture is cancelled.'
        when f.home_team_id is null and f.home_away = 'Away' and not v_owning_side then 'Only the owning club records the other club''s ground.'
        when f.home_team_id is null and f.home_away <> 'Away' then 'Choose Home or Away first -- the venue belongs to the home club.'
        when not v_schedule then 'Only the two clubs'' fixture staff can change the venue.' end),
    'competition', jsonb_build_object('editable', (internal.can_manage_club_fixtures(v_owning_club) or internal.is_site_admin()) and v_locked is null,
      'reason', case when not (internal.can_manage_club_fixtures(v_owning_club) or internal.is_site_admin()) then 'Only the club''s fixture administrators can set the competition.' else v_locked end),
    'opposition', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change the opposition.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'ourTeam', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change its team.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'homeAway', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change Home or Away.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    -- The result: the same rule submit_fixture_result enforces.
    'result', jsonb_build_object('editable', internal.can_submit_fixture_result(f.id) and internal.fixture_result_eligible(f.id),
      'reason', case when not internal.can_submit_fixture_result(f.id) then 'Only the two clubs'' fixture staff can record the result.'
        when v_cancelled then 'A cancelled fixture has no result.'
        when not internal.fixture_result_eligible(f.id) then 'The result can be recorded once the match has kicked off.' end),
    'details', jsonb_build_object('editable', v_owning_side,
      'reason', case when not v_owning_side then 'Only the owning club can change the fixture type, status and notes.' end),
    'competitionName', v_competition_name
  );
end;
$function$;

revoke execute on function public.fixture_editable_fields(uuid) from public;
revoke execute on function public.fixture_editable_fields(uuid) from anon;
grant  execute on function public.fixture_editable_fields(uuid) to authenticated, service_role;

create or replace function public.update_fixture_details(p_fixture_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.fixtures;
  v_after public.fixtures;
  v_status text;
  v_home_away text;
  v_game_type text;
  v_swap boolean;
  v_opponent_club uuid;
  v_owning_club_name text;
  v_venue_text text;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if not internal.can_edit_fixture_details(f.id) then
    raise exception 'Only the owning club can change this fixture''s details.' using errcode = '42501';
  end if;

  if p_patch ? 'status' then
    v_status := nullif(p_patch->>'status', '');
    if v_status = 'Cancelled' then
      raise exception 'Cancel a fixture with Cancel Fixture, so the other side and the players are told why.' using errcode = '23514';
    end if;
    if v_status is not null and v_status not in ('Planned', 'Booked', 'To Be Determined', 'Completed') then
      raise exception 'That is not a fixture status that can be set here.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_status is distinct from 'Cancelled' then
      raise exception 'This fixture is cancelled. Restore it before changing its status.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'home_away' then
    v_home_away := nullif(p_patch->>'home_away', '');
    if v_home_away not in ('Home', 'Away', 'TBD', 'Not Applicable') then
      raise exception 'Home, Away, TBD or Not Applicable.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_home_away is distinct from f.home_away then
      raise exception 'This fixture is cancelled.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'game_type' then
    v_game_type := nullif(p_patch->>'game_type', '');
    if v_game_type is not null and v_game_type not in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match') then
      raise exception 'That is not a fixture type.' using errcode = '23514';
    end if;
  end if;

  -- An away ground at a club that is not on Ovalball has no venue record; its
  -- name is kept as text. Only an away fixture with no venue record takes
  -- one, and only from someone who may change the venue.
  if p_patch ? 'venue_text' then
    v_venue_text := nullif(trim(coalesce(p_patch->>'venue_text', '')), '');
    if not (internal.can_submit_fixture_result(f.id) or internal.is_site_admin()) then
      raise exception 'Only the two clubs'' fixture staff can change the venue.' using errcode = '42501';
    end if;
    if coalesce(v_home_away, f.home_away) <> 'Away' or (f.venue_id is not null and not (p_patch ? 'home_away' and v_home_away is distinct from f.home_away)) then
      raise exception 'A ground name is only recorded for an away fixture without a venue.' using errcode = '23514';
    end if;
  end if;

  v_swap := p_patch ? 'home_away' and f.home_away in ('Home', 'Away') and v_home_away in ('Home', 'Away') and v_home_away <> f.home_away;

  update public.fixtures
  set status = case when p_patch ? 'status' then coalesce(v_status, status) else status end,
      home_away = case when p_patch ? 'home_away' then v_home_away else home_away end,
      game_type = case when p_patch ? 'game_type' then v_game_type else game_type end,
      notes = case when p_patch ? 'notes' then nullif(trim(coalesce(p_patch->>'notes', '')), '') else notes end,
      home_score = case when v_swap then away_score else home_score end,
      away_score = case when v_swap then home_score else away_score end,
      -- The venue and pitch belong to the home club; when the home side
      -- changes they no longer apply.
      venue_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else venue_id end,
      pitch_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else pitch_id end,
      venue_address = case
        when p_patch ? 'venue_text' then v_venue_text
        when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null
        else venue_address end,
      updated_by = auth.uid()
  where id = f.id
  returning * into v_after;

  if f.opponent_team_id is not null
     and (v_after.home_away is distinct from f.home_away or v_after.status is distinct from f.status) then
    select club_id into v_opponent_club from public.teams where id = f.opponent_team_id;
    -- The recipient is the opposition: name the club that made the change, not them.
    select d.name into v_owning_club_name from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory d on d.id = c.directory_id where t.id = f.owning_team_id;
    insert into public.notifications (user_id, type, title, body, data)
    select distinct cm.user_id, 'fixture_details_changed', 'Fixture updated',
      format('Your fixture against %s on %s is now %s%s.',
        coalesce(v_owning_club_name, 'the other club'),
        to_char(f.kickoff_date, 'DD Mon YYYY'),
        case when v_after.home_away is distinct from f.home_away
          then case v_after.home_away when 'Home' then 'at their ground' when 'Away' then 'at your ground' else lower(v_after.home_away) end
          else lower(v_after.status) end,
        ''),
      jsonb_build_object('fixture_id', f.id)
    from public.club_memberships cm
    where cm.status = 'active' and cm.user_id is distinct from auth.uid()
      and (
        (cm.club_id = v_opponent_club and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY'))
        or exists (select 1 from public.team_permissions tp where tp.membership_id = cm.id and tp.team_id = f.opponent_team_id and tp.permission in ('team_admin', 'coach', 'manager'))
      );
  end if;
end;
$function$;

revoke execute on function public.update_fixture_details(uuid, jsonb) from public;
revoke execute on function public.update_fixture_details(uuid, jsonb) from anon;
grant  execute on function public.update_fixture_details(uuid, jsonb) to authenticated, service_role;

-- ============================================================
-- 3. Bulk save: date and kick-off change independently.
-- ============================================================

create or replace function public.bulk_update_fixtures(p_changes jsonb)
returns table (fixture_id uuid, ok boolean, error_message text)
language plpgsql
-- Deliberately INVOKER. See the header.
security invoker
set search_path = public, internal, pg_temp
as $$
declare
  v_change jsonb;
  v_id uuid;
  v_club uuid;
  v_team uuid;
  v_allowed boolean;
  v_current_date date;
  v_current_time time;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Expected an array of fixture changes.';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_id := (v_change ->> 'fixture_id')::uuid;
    fixture_id := v_id;
    ok := false;
    error_message := null;

    begin
      select f.owning_team_id, f.kickoff_date, f.kickoff_time into v_team, v_current_date, v_current_time from public.fixtures f where f.id = v_id;
      if v_team is null then
        raise exception 'Fixture not found.';
      end if;

      v_club := internal.caller_fixture_club_id(v_id);

      -- Bulk editing is its own grant, asked per fixture so a team-scoped
      -- holder cannot reach a team they do not run.
      v_allowed := internal.is_site_admin()
        or (v_club is not null and internal.has_capability('fixture.bulk_edit', 'club', v_club, null))
        or internal.has_capability('fixture.bulk_edit', 'team', v_club, v_team);

      if not v_allowed then
        raise exception 'You do not have permission to bulk edit this fixture.' using errcode = '42501';
      end if;

      -- Each field goes through its own canonical writer, so every rule
      -- that applies to editing one fixture applies here unchanged.
      -- A date-only change keeps the kick-off time, and a time-only change
      -- keeps the date. Both used to go wrong: a time-only edit was skipped
      -- while reporting success, and a date-only edit cleared the kick-off
      -- (and with it the meet time).
      if v_change ? 'kickoff_date' or v_change ? 'kickoff_time' then
        perform public.update_fixture_kickoff(
          v_id,
          case when v_change ? 'kickoff_date' then (v_change ->> 'kickoff_date')::date else v_current_date end,
          case when v_change ? 'kickoff_time' then nullif(v_change ->> 'kickoff_time', '')::time else v_current_time end
        );
      end if;

      if v_change ? 'meet_time' then
        perform public.update_fixture_meet_time(v_id, nullif(v_change ->> 'meet_time', '')::time);
      end if;

      if v_change ? 'venue_id' then
        perform public.update_fixture_venue(v_id, nullif(v_change ->> 'venue_id', '')::uuid);
      end if;

      if v_change ? 'pitch_id' then
        perform public.update_fixture_pitch(v_id, nullif(v_change ->> 'pitch_id', '')::uuid, null);
      end if;

      if v_change ? 'competition_edition_id' then
        perform public.update_fixture_competition(
          v_id,
          nullif(v_change ->> 'competition_edition_id', '')::uuid
        );
      end if;

      ok := true;
    exception
      when others then
        -- The inner writer's own sentence, which is written for a person.
        ok := false;
        error_message := sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

comment on function public.bulk_update_fixtures(jsonb) is
  'Applies a set of fixture edits in one call by delegating each field to its existing canonical writer, so authority, validation, conflict rules and audit are exactly those of a single-fixture edit. SECURITY INVOKER on purpose. A date-only change keeps the kick-off time and a time-only change keeps the date. Returns one row per fixture with its own success or refusal.';
