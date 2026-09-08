-- A Mini-Rugby Group lists the teams as they were in the group's own season.
--
-- The Teams page read a group's membership as `scheduling_group_members ->
-- teams -> display_name`, which is the team's identity RIGHT NOW. A group is
-- season-bound, so once a season handover progresses the club, a perfectly
-- valid "U7/U8 Minis" from 26/27 starts listing "Under 9 Mixed" -- describing a
-- 26/27 arrangement with 27/28 names. The group tag and the membership then
-- disagree on screen, and the group looks like a rule violation when it is
-- only a stale read.
--
-- The season-correct identity already exists as get_team_identity_for_season.
-- This exposes it as a view so the app reads it the same way everywhere,
-- rather than each surface reaching for whichever team fields it happens to
-- have loaded.

create or replace view public.scheduling_group_membership as
select
  m.group_id,
  m.team_id,
  sg.club_id,
  sg.season_id,
  i.category,
  i.age_group,
  i.gender,
  i.squad_designation,
  i.display_name,
  t.rugby_code,
  t.active as team_active
from public.scheduling_group_members m
join public.scheduling_groups sg on sg.id = m.group_id
join public.teams t on t.id = m.team_id
left join lateral public.get_team_identity_for_season(m.team_id, sg.season_id) i on true;

comment on view public.scheduling_group_membership is
  'A Mini-Rugby Group''s members carrying their identity IN THAT GROUP''S SEASON -- category/age_group/gender/squad_designation to run through fullTeamLabel, never the team''s present-day fields, which drift the moment a season handover progresses the club.';

alter view public.scheduling_group_membership set (security_invoker = on);

grant select on public.scheduling_group_membership to authenticated;
