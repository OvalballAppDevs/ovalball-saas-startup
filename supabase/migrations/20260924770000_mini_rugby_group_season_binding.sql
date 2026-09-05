-- MINI-RUGBY GROUP MODEL: season-binding + alias.
--
-- Root problem this fixes (Section 13/14/64 of the Mini-Rugby / Team
-- Administration / Season Handover brief): scheduling_groups previously had
-- no season_id at all, so a group's own identity could be silently mutated
-- across a season boundary just by calling set_scheduling_group_members
-- again with different team_ids -- there was nothing stopping "2026/27
-- U7/U8 Falcons" from quietly becoming "2027/28 U8/U9 Falcons" in place.
-- That is the exact staff-authority-leakage / historical-ambiguity risk the
-- brief calls out. The fix: a group belongs to exactly one season for its
-- whole life; a new season's grouping is always a NEW group_id (created via
-- create_scheduling_group with that season's id), never a mutation of an
-- old one. display_tag remains the auto-derived structural label
-- ("U7/U8"); alias is a new, separate, purely cosmetic club-chosen suffix
-- ("Falcons") -- Section 16: alias never redefines identity or age
-- coverage, both stay independently visible.

alter table public.scheduling_groups add column season_id uuid references public.seasons(id);
alter table public.scheduling_groups add column alias text;

comment on column public.scheduling_groups.season_id is
  'The one season this group belongs to, for its whole life -- never reassigned. A new season''s equivalent grouping is always a new scheduling_groups row with a new id, never this row mutated (Section 13/14/64).';
comment on column public.scheduling_groups.alias is
  'Optional club-chosen cosmetic suffix (e.g. "Falcons"). Never redefines structural age coverage -- display is always derived as "{display_tag} {alias}" when set, "{display_tag}" otherwise (Section 16).';

-- Backfill: the one legitimate live group (Burnley U7/U8, real fixture
-- history) belongs to the season its actual fixtures fall in -- resolved
-- here from the club's rugby_code + season date range containing those
-- fixtures' kickoff dates, the same signal a human would use, rather than
-- guessing "whichever season is marked active" (multiple rows can be).
update public.scheduling_groups sg
set season_id = (
  select s.id
  from public.seasons s
  join public.clubs c on c.id = sg.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where s.rugby_code = cd.rugby_code
    and exists (
      select 1 from public.fixtures f
      where (f.owning_scheduling_group_id = sg.id or f.owning_team_id in (select team_id from public.scheduling_group_members where group_id = sg.id))
        and f.kickoff_date between s.starts_on and s.ends_on
    )
  order by s.starts_on desc
  limit 1
)
where sg.season_id is null;

-- Any remaining group with no fixture history to infer a season from (none
-- exist locally at migration time, but defensively) falls back to the
-- earliest currently-active season for the club's rugby code -- never left
-- null, since every group must belong to exactly one season going forward.
update public.scheduling_groups sg
set season_id = (
  select s.id
  from public.seasons s
  join public.clubs c on c.id = sg.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where s.rugby_code = cd.rugby_code and s.active
  order by s.starts_on asc
  limit 1
)
where sg.season_id is null;

alter table public.scheduling_groups alter column season_id set not null;

-- ============================================================
-- Season/club/rugby-code consistency (Section 78): a group's season must
-- genuinely belong to the same club and rugby code, never a mismatched
-- pairing reachable by a crafted RPC call.
-- ============================================================

create or replace function internal.validate_scheduling_group_season(p_club_id uuid, p_season_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match_count integer;
begin
  select count(*) into v_match_count
  from public.seasons s
  join public.clubs c on c.id = p_club_id
  join public.club_directory cd on cd.id = c.directory_id
  where s.id = p_season_id and s.rugby_code = cd.rugby_code;

  if v_match_count = 0 then
    raise exception 'That season does not belong to this club''s rugby code.';
  end if;
end;
$$;

-- validate_mini_rugby_team_set: same rules as before, PLUS Section 78's
-- "inactive/folded teams cannot be newly added" -- the one real gap in the
-- original version (it never checked team.active at all).
create or replace function internal.validate_mini_rugby_team_set(p_club_id uuid, p_team_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bad_club_count integer;
  v_bad_age_count integer;
  v_inactive_count integer;
  v_distinct_age_count integer;
begin
  if array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) < 1 then
    raise exception 'Select at least one team.';
  end if;

  select count(*) into v_bad_club_count from public.teams where id = any(p_team_ids) and club_id <> p_club_id;
  if v_bad_club_count > 0 then
    raise exception 'Every team in a Mini-Rugby Group must belong to this club.';
  end if;

  if (select count(*) from public.teams where id = any(p_team_ids)) <> array_length(p_team_ids, 1) then
    raise exception 'One or more selected teams could not be found.';
  end if;

  select count(*) into v_inactive_count from public.teams where id = any(p_team_ids) and not active;
  if v_inactive_count > 0 then
    raise exception 'An inactive or folded team cannot be added to a Mini-Rugby Group.';
  end if;

  select count(*) into v_bad_age_count from public.teams where id = any(p_team_ids) and age_group not in ('U6', 'U7', 'U8');
  if v_bad_age_count > 0 then
    raise exception 'Mini-Rugby Groups only support U6, U7, and U8 -- never U9 or above.';
  end if;

  select count(distinct age_group) into v_distinct_age_count from public.teams where id = any(p_team_ids);
  if v_distinct_age_count < 2 then
    raise exception 'A Mini-Rugby Group must combine at least two different ages within U6-U8 (e.g. U7/U8).';
  end if;
end;
$$;

-- Drop the old 2-arg signature entirely -- a season-less create path must
-- not keep existing as a second, non-canonical way to form a group
-- (Section 79: no duplicate product path, including at the RPC layer).
drop function if exists public.create_scheduling_group(uuid, uuid[]);

-- create_scheduling_group: now takes the season explicitly (the caller
-- already resolved "current season" via the one shared calendar-season
-- resolver the app uses everywhere else -- lib/calendar/season-context.ts
-- -- so this function is never a second place season gets guessed).
create or replace function public.create_scheduling_group(p_club_id uuid, p_team_ids uuid[], p_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tag text;
begin
  if not internal.can_manage_club_fixtures(p_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;
  perform internal.validate_mini_rugby_team_set(p_club_id, p_team_ids);
  perform internal.validate_scheduling_group_season(p_club_id, p_season_id);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  insert into public.scheduling_groups (club_id, display_tag, season_id, created_by)
  values (p_club_id, v_tag, p_season_id, auth.uid())
  returning id into v_id;

  insert into public.scheduling_group_members (group_id, team_id)
  select v_id, unnest(p_team_ids);

  return v_id;
end;
$$;

-- set_scheduling_group_members: composition may still be corrected WITHIN
-- a season (e.g. fixing a mis-added team before any fixture exists), but
-- Section 43/64's "never change old group components" invariant is now
-- enforced here at the DB boundary, not just by convention: once any real
-- fixture has been booked through this group, membership freezes for good.
-- A genuinely different arrangement -- including "the same teams, next
-- season" -- always means create_scheduling_group with a new season_id,
-- never editing this row.
create or replace function public.set_scheduling_group_members(p_group_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_tag text;
  v_fixture_count integer;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  select count(*) into v_fixture_count from public.fixtures where owning_scheduling_group_id = p_group_id and status <> 'Cancelled';
  if v_fixture_count > 0 then
    raise exception 'This Mini-Rugby Group already has a fixture booked against it -- its composition is now historical and cannot change. Create a new Mini-Rugby Group instead.';
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  delete from public.scheduling_group_members where group_id = p_group_id;
  insert into public.scheduling_group_members (group_id, team_id)
  select p_group_id, unnest(p_team_ids);

  update public.scheduling_groups set display_tag = v_tag, updated_by = auth.uid() where id = p_group_id;
end;
$$;

-- set_scheduling_group_alias: the ONE thing a Club Admin can always change
-- on a group regardless of fixture history -- purely cosmetic, never
-- structural, so it carries none of set_scheduling_group_members' freeze
-- rule (Section 16/42: alias is presentation, changing it never touches
-- composition, season, or any fixture row -- the display resolver reads it
-- fresh every time).
create or replace function public.set_scheduling_group_alias(p_group_id uuid, p_alias text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  update public.scheduling_groups
  set alias = nullif(trim(p_alias), ''), updated_by = auth.uid()
  where id = p_group_id;
end;
$$;

revoke execute on function public.create_scheduling_group(uuid, uuid[], uuid) from public;
grant execute on function public.create_scheduling_group(uuid, uuid[], uuid) to authenticated;
revoke execute on function public.set_scheduling_group_alias(uuid, text) from public;
grant execute on function public.set_scheduling_group_alias(uuid, text) to authenticated;
