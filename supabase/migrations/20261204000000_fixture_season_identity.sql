-- What a team was called for the season a fixture belongs to.
--
-- WHAT THE HANDOVER DOES TO HISTORY
--
-- Run against the real RPCs, with one completed result from this season and
-- one friendly already booked for next:
--
--   team is now: U17
--   PAST fixture -- COMPLETED result, played 30 days ago in season 26/27:
--      app shows (joins teams.display_name) : U17
--      snapshot stored on the row          : U16
--   FUTURE fixture -- BOOKED for Oct 2027, next season:
--      app shows                           : U17
--      snapshot stored on the row          : U16
--
-- The future fixture is right: it will be played by the U17 side. The past one
-- is not. A result the Under-16s actually played is now attributed to the
-- Under-17s, everywhere a fixture is listed -- results history, Match Centre,
-- Calendar, Agenda, the public club page. Every season handover rewrites the
-- club's own record of what it did.
--
-- fixtures already carries owning_team_age_group_snapshot and
-- owning_team_display_name_snapshot, which look like the answer. They are not,
-- for two reasons. They are captured BEFORE INSERT and never refreshed, so the
-- future fixture above holds a stale "U16" -- the snapshot is only right for a
-- fixture created inside the season it is played in. And nothing reads them:
-- outside the generated database types, the columns have no consumer anywhere
-- in the application. The mechanism intended to protect historic identity is
-- inert.
--
-- WHERE THE CORRECT ANSWER ALREADY LIVES
--
-- team_season_identity is the Handover Register: the confirm path writes the
-- team's identity for the season it is leaving AND for the season it is
-- entering. Every fixture carries season_id. So the register already holds the
-- right label for both fixtures above -- U16 for 26/27, U17 for 27/28 -- and
-- neither a per-row snapshot nor a date comparison is needed to find it.
--
-- This adds the lookup as one canonical resolver, and a view over fixtures
-- that applies it. It deliberately does NOT change how any screen renders:
-- eleven files currently join teams.display_name for fixture display, across
-- Calendar, Agenda, Match Centre, Messages, the parent agenda, pitch
-- allocation and the public club page. Moving those onto the register is a
-- display change across surfaces that were verified in a browser, and it is
-- scoped separately rather than folded into a data fix.

-- ============================================================
-- 1. The resolver.
-- ============================================================

create or replace function internal.team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table (age_group text, display_name text, source text)
language sql stable
as $function$
  -- The register, when the handover has recorded this team for this season.
  select tsi.age_group, tsi.display_name, 'register'::text
  from public.team_season_identity tsi
  where tsi.team_id = p_team_id and tsi.season_id = p_season_id
  union all
  -- Otherwise the team as it stands. A club that has never run a handover has
  -- no register rows, and its current identity is the only identity it has
  -- ever had -- so this fallback is correct, not a guess.
  select t.age_group, t.display_name, 'current'::text
  from public.teams t
  where t.id = p_team_id
    and not exists (
      select 1 from public.team_season_identity tsi
      where tsi.team_id = p_team_id and tsi.season_id = p_season_id
    )
  limit 1;
$function$;

comment on function internal.team_identity_for_season(uuid, uuid) is
  'What a team was called in a given season, from the Handover Register, falling back to its current identity. Use this rather than teams.display_name wherever a past season is displayed -- otherwise a season handover relabels results the previous age grade actually played.';

-- ============================================================
-- 2. Fixtures, labelled by the season they belong to.
-- ============================================================

create or replace view public.fixture_season_identity as
select
  f.id as fixture_id,
  f.season_id,
  f.owning_team_id,
  own.age_group    as owning_team_age_group,
  own.display_name as owning_team_display_name,
  own.source       as owning_team_identity_source,
  f.opponent_team_id,
  opp.age_group    as opponent_team_age_group,
  opp.display_name as opponent_team_display_name,
  opp.source       as opponent_team_identity_source
from public.fixtures f
left join lateral internal.team_identity_for_season(f.owning_team_id, f.season_id) own on true
left join lateral internal.team_identity_for_season(f.opponent_team_id, f.season_id) opp on true;

comment on view public.fixture_season_identity is
  'Each fixture with the team names as they stood in that fixture''s own season. Reading teams.display_name directly attributes last season''s results to this season''s age grade.';

-- The view inherits the RLS of the tables underneath it.
alter view public.fixture_season_identity set (security_invoker = true);

grant select on public.fixture_season_identity to authenticated;

-- ============================================================
-- 3. Prove the resolver on the two cases that motivated it.
-- ============================================================

do $$
declare
  v_team uuid; v_from uuid; v_to uuid; v_label text; v_src text;
begin
  -- A team that has a register row for one season and not another must answer
  -- differently for each, without consulting dates.
  select tsi.team_id, tsi.season_id into v_team, v_from
  from public.team_season_identity tsi limit 1;

  if v_team is null then
    raise notice 'No register rows in this database yet -- resolver correctness is asserted by supabase/tests/fixture_season_identity.sql.';
    return;
  end if;

  select display_name, source into v_label, v_src
  from internal.team_identity_for_season(v_team, v_from);
  if v_src <> 'register' then
    raise exception 'The resolver ignored a register row that exists for this team and season.';
  end if;

  select id into v_to from public.seasons
  where id <> v_from and not exists (
    select 1 from public.team_season_identity x where x.team_id = v_team and x.season_id = seasons.id)
  limit 1;

  if v_to is not null then
    select source into v_src from internal.team_identity_for_season(v_team, v_to);
    if v_src <> 'current' then
      raise exception 'The resolver did not fall back to the team''s current identity for a season with no register row.';
    end if;
  end if;
end $$;
