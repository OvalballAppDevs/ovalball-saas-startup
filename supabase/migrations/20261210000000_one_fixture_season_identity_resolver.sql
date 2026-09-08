-- One season-aware team identity resolver, not two.
--
-- CORRECTING AN EARLIER MISTAKE IN THIS WORK
--
-- 20261204000000 added internal.team_identity_for_season and built
-- public.fixture_season_identity on it, on the finding that fixture surfaces
-- were joining teams.display_name and therefore relabelling history.
--
-- That finding was too crude. public.get_team_identity_for_season already
-- existed and is already consumed -- through
-- lib/mini-rugby/team-identity.server.ts -- by the Calendar, the Agenda, the
-- Match Centre and the Season Handover page. The teams.display_name joins on
-- those surfaces are FALLBACKS behind a season-aware lookup, not the primary
-- answer. What is genuinely missing is that several other surfaces never call
-- it, which is a wiring gap, not an absent resolver.
--
-- Worse, the resolver added here was a strictly poorer duplicate. It answered
-- "register row, else the team as it stands today", while the existing one
-- answers:
--
--   1. the stored season identity, which always wins -- the historical record
--      of what the team actually was, never re-derived;
--   2. otherwise, for a FUTURE season, a code-aware projection of what the
--      team will be, flagged is_projected;
--   3. otherwise the team's current identity.
--
-- Step 2 is the product rule for future fixtures: a fixture booked for next
-- season may already read U13 before the handover has run, because it belongs
-- to next season. The duplicate could not do that -- it would have shown U12
-- until the handover, then U13 after, which is precisely the label instability
-- the rule exists to prevent.
--
-- So the view is rebuilt on the existing resolver and the duplicate is
-- dropped. Introducing a second answer to a question the platform already
-- answered is the same mistake as a second team directory or a second season
-- calendar, and it is removed on the same principle.

create or replace view public.fixture_season_identity as
select
  f.id as fixture_id,
  f.season_id,
  f.owning_team_id,
  own.age_group    as owning_team_age_group,
  own.display_name as owning_team_display_name,
  case when own.is_projected then 'projected' else 'recorded' end as owning_team_identity_source,
  f.opponent_team_id,
  opp.age_group    as opponent_team_age_group,
  opp.display_name as opponent_team_display_name,
  case when opp.is_projected then 'projected' else 'recorded' end as opponent_team_identity_source
from public.fixtures f
left join lateral public.get_team_identity_for_season(f.owning_team_id, f.season_id) own on true
left join lateral public.get_team_identity_for_season(f.opponent_team_id, f.season_id) opp on true;

comment on view public.fixture_season_identity is
  'Each fixture with its teams named as they stood -- or will stand -- in that fixture''s own season, through the one canonical resolver public.get_team_identity_for_season. Reading teams.display_name directly attributes last season''s results to this season''s age grade.';

alter view public.fixture_season_identity set (security_invoker = true);
grant select on public.fixture_season_identity to authenticated;

drop function if exists internal.team_identity_for_season(uuid, uuid);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'team_identity_for_season'
  ) then
    raise exception 'The duplicate season identity resolver still exists.';
  end if;

  if (select view_definition from information_schema.views
      where table_schema = 'public' and table_name = 'fixture_season_identity')
     !~ 'get_team_identity_for_season' then
    raise exception 'The fixture identity view does not use the canonical resolver.';
  end if;

  -- Exactly one function answers "what was this team called in this season".
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','internal') and p.prokind = 'f'
        and p.proname ~ 'team_identit(y|ies)_for_season') <> 2 then
    -- get_team_identity_for_season and its batch wrapper, and nothing else.
    raise exception 'There is not exactly one team-season identity resolver (plus its batch wrapper).';
  end if;
end $$;
