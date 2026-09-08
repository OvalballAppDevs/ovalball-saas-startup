-- A Mini-Rugby Group is a tag-rugby arrangement, and stays one.
--
-- WHAT WAS ON SCREEN
--
-- Club Admin -> Teams showed a group called "U8 Minis Tags" whose members
-- read "Under 9 Mixed, Under 9 Mixed B". Two things were wrong at once, and
-- only one of them was a display problem.
--
-- 1. THE RULE WAS ENFORCED AGAINST THE WRONG SEASON.
--
-- internal.validate_mini_rugby_team_set and internal.mini_rugby_display_tag
-- both already take an optional p_season_id, and both already contain the
-- correct season-aware branch: resolve each team's identity FOR THE SEASON THE
-- GROUP BELONGS TO, then apply the U6-U8 band and the two-different-ages rule
-- to that. Neither caller passed it. create_scheduling_group and
-- set_scheduling_group_members asked "what age is this team right now",
-- which is a different question from "what age is this team in the season
-- this group schedules", and the two answers diverge the moment a season
-- handover progresses the club. A correct season-aware answer that nothing
-- calls is exactly the hazard a second answer always is.
--
-- 2. THE RULE LIVED ONLY IN THE TWO FUNCTIONS THAT REMEMBERED TO CALL IT.
--
-- The group actually on screen was written by a local UAT seed inserting
-- straight into scheduling_group_members, so no validation ran at all. That is
-- seed data rather than a product bug, but it proves the shape of the hole: the
-- age band was a convention two functions observed, not an invariant the data
-- had to satisfy. It is now a constraint trigger, so no path -- a seed, a
-- direct statement, a function written next year -- can leave a group holding
-- a team that is not playing tag rugby in that group's own season.
--
-- 3. THERE WAS NO WAY TO REMOVE A GROUP.
--
-- A group could be deactivated and reactivated, and that was all. Deactivating
-- something a club created by mistake is not the same as removing it, and an
-- inactive row offering only "Reactivate" is an incomplete control. Deleting is
-- refused once a fixture has been played against the group, because at that
-- point the composition is history rather than an arrangement.

-- ---------------------------------------------------------------------------
-- 1. Both callers now ask about the group's own season
-- ---------------------------------------------------------------------------

create or replace function public.create_scheduling_group(p_club_id uuid, p_team_ids uuid[], p_season_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_tag text;
begin
  if not internal.has_capability('manage_mini_rugby_groups', 'club', p_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;
  perform internal.validate_scheduling_group_season(p_club_id, p_season_id);
  -- The season is part of the question, not context around it: these teams
  -- must be U6-U8 in THIS season, not in whichever one happens to be current.
  perform internal.validate_mini_rugby_team_set(p_club_id, p_team_ids, p_season_id);
  v_tag := internal.mini_rugby_display_tag(p_team_ids, p_season_id);

  insert into public.scheduling_groups (club_id, display_tag, season_id, created_by)
  values (p_club_id, v_tag, p_season_id, auth.uid())
  returning id into v_id;

  insert into public.scheduling_group_members (group_id, team_id)
  select v_id, unnest(p_team_ids);

  return v_id;
end;
$function$;

create or replace function public.set_scheduling_group_members(p_group_id uuid, p_team_ids uuid[])
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_season_id uuid;
  v_tag text;
  v_fixture_count integer;
begin
  select club_id, season_id into v_club_id, v_season_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  select count(*) into v_fixture_count from public.fixtures
   where (owning_scheduling_group_id = p_group_id or opponent_scheduling_group_id = p_group_id)
     and status <> 'Cancelled';
  if v_fixture_count > 0 then
    raise exception 'This Mini-Rugby Group already has a fixture booked against it -- its composition is now historical and cannot change. Create a new Mini-Rugby Group instead.';
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids, v_season_id);
  v_tag := internal.mini_rugby_display_tag(p_team_ids, v_season_id);

  delete from public.scheduling_group_members where group_id = p_group_id;
  insert into public.scheduling_group_members (group_id, team_id)
  select p_group_id, unnest(p_team_ids);

  update public.scheduling_groups set display_tag = v_tag, updated_by = auth.uid() where id = p_group_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The band becomes an invariant of the data
-- ---------------------------------------------------------------------------

create or replace function internal.enforce_mini_rugby_membership()
returns trigger
language plpgsql
security definer set search_path to 'public'
as $function$
declare
  v_group_id uuid;
  v_club_id uuid;
  v_season_id uuid;
  v_team_ids uuid[];
begin
  v_group_id := coalesce(new.group_id, old.group_id);

  -- The group itself may have just been deleted, cascading these rows away.
  -- There is nothing left to validate, and refusing here would make a group
  -- undeletable.
  select club_id, season_id into v_club_id, v_season_id
  from public.scheduling_groups where id = v_group_id;
  if v_club_id is null then
    return null;
  end if;

  select array_agg(team_id) into v_team_ids
  from public.scheduling_group_members where group_id = v_group_id;

  -- An emptied group is a group being torn down, not an invalid one.
  if v_team_ids is null then
    return null;
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, v_team_ids, v_season_id);
  return null;
end;
$function$;

comment on function internal.enforce_mini_rugby_membership() is
  'Mini-Rugby Groups are tag rugby (U6-U8) in the season the group belongs to. Enforced here rather than only in create_scheduling_group/set_scheduling_group_members, so no seed, migration or future function can leave a group holding a team that is not playing tag rugby in that group''s own season.';

drop trigger if exists scheduling_group_members_stay_mini_rugby on public.scheduling_group_members;

-- DEFERRABLE INITIALLY DEFERRED because a group is legitimately in an invalid
-- shape mid-transaction: set_scheduling_group_members deletes every row and
-- reinserts, and a two-team group is a single age after its first insert. The
-- rule is about the group at commit, not about each statement along the way.
create constraint trigger scheduling_group_members_stay_mini_rugby
after insert or update or delete on public.scheduling_group_members
deferrable initially deferred
for each row execute function internal.enforce_mini_rugby_membership();

-- ---------------------------------------------------------------------------
-- 3. A group can be removed
-- ---------------------------------------------------------------------------

create or replace function public.delete_scheduling_group(p_group_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_fixture_count integer;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  -- A group that has played is part of the record. Deactivating it takes it
  -- out of use without pretending those fixtures were arranged by something
  -- else.
  select count(*) into v_fixture_count from public.fixtures
   where owning_scheduling_group_id = p_group_id or opponent_scheduling_group_id = p_group_id;
  if v_fixture_count > 0 then
    raise exception 'This Mini-Rugby Group has fixtures recorded against it, so it is part of your club''s history and cannot be removed. Make it inactive instead.'
      using errcode = 'P0001';
  end if;

  delete from public.scheduling_groups where id = p_group_id;
end;
$function$;

comment on function public.delete_scheduling_group(uuid) is
  'Removes a Mini-Rugby Group a club created by mistake. Refused once any fixture -- cancelled or not -- references the group, because at that point its composition is history rather than an arrangement.';

revoke all on function public.delete_scheduling_group(uuid) from public;
grant execute on function public.delete_scheduling_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What is already in the database
-- ---------------------------------------------------------------------------
--
-- Reported, never quietly removed. A group that violates the band is a real
-- row a club can see, and deleting a club's data to make a report clean is not
-- this migration's decision to take -- the new Remove control is.

do $$
declare r record; v_n int := 0;
begin
  for r in
    select sg.id, sg.display_tag, s.name as season,
           string_agg(coalesce(i.age_group, t.age_group), ', ') as ages
    from public.scheduling_groups sg
    join public.seasons s on s.id = sg.season_id
    join public.scheduling_group_members m on m.group_id = sg.id
    join public.teams t on t.id = m.team_id
    left join lateral public.get_team_identity_for_season(t.id, sg.season_id) i on true
    group by sg.id, sg.display_tag, s.name
    having count(distinct coalesce(i.age_group, t.age_group)) < 2
        or bool_or(coalesce(i.age_group, t.age_group) not in ('U6','U7','U8'))
  loop
    v_n := v_n + 1;
    raise notice 'Mini-Rugby Group "%" (%) holds ages [%] and would not be creatable under the rule. A Club Admin can now remove it.', r.display_tag, r.season, r.ages;
  end loop;
  raise notice 'Pre-existing Mini-Rugby Groups outside the tag-rugby rule: %.', v_n;
end $$;
