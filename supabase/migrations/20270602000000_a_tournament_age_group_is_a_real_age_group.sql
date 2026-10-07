-- =====================================================================================================
-- A TOURNAMENT AGE GROUP IS A REAL AGE GROUP.
--
-- `tournament_age_groups.age_group` and `tournament_participants.age_group` were plain `text` with no
-- vocabulary behind them. Only the mobile wizard's own list stood between the database and nonsense,
-- and the canonical RPC would take anything:
--
--   select public.set_tournament_age_groups(t, array['U99','BANANA','under twelve']);
--   -- 3 rows written
--
-- A client-side list is not a constraint. Anything else that writes -- the website, a future import, a
-- script, a Site Admin repair, or simply a newer app than the one this check was written against --
-- reaches the same table without passing that list, and a grade like 'under twelve' then sorts wrongly,
-- groups wrongly, and matches nothing when a team's real grade is compared against it.
--
-- THE VOCABULARY IS THE ONE THE SCHEMA ALREADY ESTABLISHES, not a new list invented here.
-- `canonical_team_types_structure_check` is where Ovalball says what an age grade is:
--
--   youth   U6 … U19
--   colts   JuniorColts, SeniorColts
--   senior  no age grade at all
--
-- and `internal.fill_tournament_participant_age_group` derives a senior side's grade as the literal
-- 'SENIOR'. So the accepted set is those three things together. Narrowing it to U6-U19 -- which is all
-- the mobile wizard currently offers, and all the data currently holds -- would refuse a colts or
-- open-age tournament the participant model already supports, which is a product decision rather than
-- a data-integrity one, and not this migration's to take.
--
-- ONE DEFINITION, TWO TABLES. The vocabulary lives in a single IMMUTABLE function that both checks
-- call, so the two columns cannot drift apart and a future widening is one edit rather than three.
-- =====================================================================================================

create or replace function internal.is_tournament_age_group(p_age_group text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_age_group is not null and p_age_group = any (array[
    -- Youth, exactly as canonical_team_types_structure_check lists them and as
    -- packages/contracts/src/teams/age-groups.ts re-exports them to every client.
    'U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16', 'U17', 'U18', 'U19',
    -- Colts, which carry a grade of their own rather than a number.
    'JuniorColts', 'SeniorColts',
    -- Open age. `internal.fill_tournament_participant_age_group` derives this literal for a side whose
    -- canonical type has no age grade, so it is a value the database itself produces.
    'SENIOR'
  ]::text[]);
$$;

comment on function internal.is_tournament_age_group(text) is
  'The one vocabulary for a tournament age grade: the youth grades U6-U19, the two colts grades, and '
  'SENIOR for open age. Taken from canonical_team_types_structure_check and from what '
  'internal.fill_tournament_participant_age_group can derive -- never a list invented for one table. '
  'Both tournament_age_groups and tournament_participants check against this, so they cannot drift.';

-- -----------------------------------------------------------------------------------------------------
-- The guard that reports a bad row rather than failing with a constraint name.
--
-- If any existing row holds something outside the vocabulary, the ALTER below would fail with
-- `check constraint ... is violated by some row`, which does not say WHICH row or WHAT value. This
-- names them first, so the failure is actionable instead of a puzzle.
-- -----------------------------------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  select string_agg(distinct quote_literal(age_group), ', ') into v_bad
  from (
    select age_group from public.tournament_age_groups
    union all
    select age_group from public.tournament_participants
  ) g
  where not internal.is_tournament_age_group(age_group);

  if v_bad is not null then
    raise exception 'Tournament age grades outside the canonical vocabulary are already stored: %. Correct them before this constraint can be added.', v_bad;
  end if;
end $$;

alter table public.tournament_age_groups drop constraint if exists tournament_age_groups_age_group_vocabulary;
alter table public.tournament_age_groups
  add constraint tournament_age_groups_age_group_vocabulary
  check (internal.is_tournament_age_group(age_group));

alter table public.tournament_participants drop constraint if exists tournament_participants_age_group_vocabulary;
alter table public.tournament_participants
  add constraint tournament_participants_age_group_vocabulary
  check (internal.is_tournament_age_group(age_group));
