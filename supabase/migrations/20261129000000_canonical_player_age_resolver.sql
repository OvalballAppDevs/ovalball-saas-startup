-- ONE canonical Player regulatory-age resolver.
--
-- WHAT WAS THERE
--
-- internal.resolve_player_age_grade was the only age resolver, and it was
-- wrong in four ways at once:
--
--   * it returned 'JuniorColts' and 'SeniorColts' for U17/U18 -- identities
--     retired when Colts converged onto the canonical U17/U18;
--   * it used ONE cutoff, make_date(season_year_start, 8, 31), for both codes;
--   * it was gender-blind, so a union girl resolved to "U13", an identity
--     union does not have; and
--   * it returned STRINGS, so every consumer rebuilt an identity by hand --
--     the hidden second catalogue this architecture exists to abolish.
--
-- THE CODE-SPECIFIC ANCHOR, WHICH IS THE PART THAT MATTERS
--
-- Both governing bodies express age grades against the SCHOOL year:
-- RFU Regulation 15.6 lists "U12s (Yr 7)" through "U18s (Yr 13)", and RFL
-- Operational Rules Section F13 lists "Under 12s | Year 7 | 1.09.13-31.08.14".
-- So the age formula is shared. What differs is WHICH school year a season
-- corresponds to, because the codes play in different halves of the year:
--
--   RFU season 2026/27 (Sep 2026 - May 2027)  ->  school year 2026-27
--   RFL season 2026     (Feb 2026 - Oct 2026)  ->  school year 2025-26
--
-- The consequence is concrete and easy to get wrong: the SAME label means a
-- different birth cohort in each code. RFL 2026 U12 is born 2013/14; RFU
-- 2026/27 U12 is born 2014/15. Anyone deriving one code's ages from the
-- other's rule is a full year out.
--
-- DERIVATION, NOT A HARDCODED TABLE
--
-- For school year starting Y, age grade U(n) is school Year (n-5), and a
-- pupil in Year N was born between 1 September (Y-N-5) and 31 August (Y-N-4).
-- Substituting: U(n) is born [1 Sep (Y-n), 31 Aug (Y-n+1)].
--
-- Verified against every published RFL F13 window: U6 1.09.19-31.08.20,
-- U12 1.09.13-31.08.14, U18 1.09.07-31.08.08 -- all reproduced exactly with
-- Y = 2025 for the RFL 2026 season.

-- ============================================================
-- 1. The code-specific school-year anchor.
-- ============================================================

create or replace function internal.regulatory_school_year_start(p_rugby_code text, p_season_id uuid)
returns integer
language plpgsql
stable
as $$
declare v_season public.seasons;
begin
  select * into v_season from public.seasons where id = p_season_id and rugby_code = p_rugby_code;
  if not found then return null; end if;

  -- Union is a winter game: its season opens inside the school year it
  -- belongs to. League is a summer game: its season runs across the SECOND
  -- half of the school year that names its age grades.
  if p_rugby_code = 'union' then
    return v_season.season_year_start;
  else
    return v_season.season_year_start - 1;
  end if;
end;
$$;

comment on function internal.regulatory_school_year_start(text, uuid) is
  'The school year a season''s age grades are measured against. Union: the season''s own start year (2026/27 -> 2026-27 school year). League: one year earlier, because a summer season runs across the back half of the school year that names its grades (RFL season 2026 -> 2025-26 school year, which is what reproduces the published F13 windows). This single offset is why RFL 2026 U12 is born 2013/14 while RFU 2026/27 U12 is born 2014/15.';

-- ============================================================
-- 2. The canonical regulatory-age resolver.
-- ============================================================

create or replace function public.resolve_player_regulatory_age(
  p_rugby_code text,
  p_season_id uuid,
  p_date_of_birth date
)
returns table (
  rugby_code text,
  season_id uuid,
  school_year_start integer,
  regulatory_age_number integer,
  regulatory_age_label text,
  school_year integer,
  window_starts_on date,
  window_ends_on date,
  governing_reference text,
  status text,
  reason text
)
language plpgsql
stable
as $function$
declare
  v_y integer;
  v_birth_school_year integer;
  v_n integer;
  v_ref text;
begin
  if p_rugby_code not in ('union','league') then
    raise exception 'rugby_code must be union or league.' using errcode = '22023';
  end if;

  v_y := internal.regulatory_school_year_start(p_rugby_code, p_season_id);
  if v_y is null then
    return query select p_rugby_code, p_season_id, null::integer, null::integer, null::text, null::integer,
      null::date, null::date, null::text, 'SEASON_NOT_FOUND'::text,
      'No season of that id exists for this rugby code, so there is no school year to measure against.';
    return;
  end if;

  -- DOB is required. Never inferred, never guessed from a team name.
  if p_date_of_birth is null then
    return query select p_rugby_code, p_season_id, v_y, null::integer, null::text, null::integer,
      null::date, null::date, null::text, 'DOB_REQUIRED'::text,
      'This player has no recorded date of birth. Regulatory age cannot be established without one, and must never be inferred from the team they currently play for.';
    return;
  end if;
  if p_date_of_birth > current_date then
    return query select p_rugby_code, p_season_id, v_y, null::integer, null::text, null::integer,
      null::date, null::date, null::text, 'INVALID_DOB'::text, 'Date of birth is in the future.';
    return;
  end if;

  -- The school year a child born on this date belongs to: 1 September starts it.
  v_birth_school_year := case
    when extract(month from p_date_of_birth) >= 9 then extract(year from p_date_of_birth)::integer
    else extract(year from p_date_of_birth)::integer - 1
  end;

  v_n := v_y - v_birth_school_year;

  v_ref := case p_rugby_code
    when 'union' then 'RFU Regulation 15.2(1) and 15.6 (age grade by school year; age fixed at midnight on 1 September)'
    else 'RFL Operational Rules 2026, Section F13 (RFL Age Ranges)'
  end;

  if v_n < 6 then
    return query select p_rugby_code, p_season_id, v_y, v_n, null::text, null::integer,
      make_date(v_y - v_n, 9, 1), make_date(v_y - v_n + 1, 8, 31), v_ref, 'TOO_YOUNG'::text,
      format('This player would be age grade U%s in the %s-%s school year, which is below the youngest supported grade.', v_n, v_y, v_y + 1);
    return;
  end if;

  if v_n > 19 then
    return query select p_rugby_code, p_season_id, v_y, v_n, null::text, null::integer,
      make_date(v_y - v_n, 9, 1), make_date(v_y - v_n + 1, 8, 31), v_ref, 'ADULT'::text,
      'This player is beyond the youth age grades for this season; adult eligibility is a separate question governed by its own rules.';
    return;
  end if;

  return query select
    p_rugby_code, p_season_id, v_y, v_n, 'U' || v_n::text, (v_n - 5),
    make_date(v_y - v_n, 9, 1), make_date(v_y - v_n + 1, 8, 31), v_ref, 'RESOLVED'::text,
    format('Age grade U%s (school Year %s) for the %s-%s school year: born between %s and %s.',
      v_n, v_n - 5, v_y, v_y + 1,
      to_char(make_date(v_y - v_n, 9, 1), 'DD Mon YYYY'),
      to_char(make_date(v_y - v_n + 1, 8, 31), 'DD Mon YYYY'));
end;
$function$;

comment on function public.resolve_player_regulatory_age(text, uuid, date) is
  'THE canonical regulatory-age resolver. Derives age grade from date of birth and the code-specific school year, never from the Ovalball operational handover date -- those are separate concepts. Returns structured domain data with the governing reference and the exact DOB window, so a caller can show its working. Returns DOB_REQUIRED rather than guessing when no date of birth is recorded; regulatory placement must never be inferred from the team a player currently sits in.';

grant execute on function public.resolve_player_regulatory_age(text, uuid, date) to authenticated;

-- ============================================================
-- 3. Regulatory age -> NORMAL OPERATIONAL IDENTITY, by canonical ID.
--
--    Never by building a key like 'girls_u' || age. The candidate set is read
--    from the canonical directory, filtered by what the code actually offers.
-- ============================================================

create or replace function public.resolve_normal_operational_identity(
  p_rugby_code text,
  p_season_id uuid,
  p_date_of_birth date,
  p_gender text
)
returns table (
  regulatory_age_label text,
  regulatory_status text,
  canonical_team_type_id uuid,
  canonical_key text,
  canonical_label text,
  allocation_status text,
  reason text
)
language plpgsql
stable
as $function$
declare
  r record;
  v_gender text := coalesce(nullif(p_gender, ''), 'boys');
  v_id uuid; v_key text; v_label text; v_age_group text;
begin
  select * into r from public.resolve_player_regulatory_age(p_rugby_code, p_season_id, p_date_of_birth);

  if r.status <> 'RESOLVED' then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      case r.status when 'DOB_REQUIRED' then 'DOB_REQUIRED' else 'NEEDS_ATTENTION' end, r.reason;
    return;
  end if;

  -- Mixed rugby: both codes end it at U12, so below that a mixed identity is
  -- the normal one and at U12 and above the player needs a sexed identity.
  if v_gender = 'mixed' and r.regulatory_age_number >= 12 then
    return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
      'NEEDS_ATTENTION'::text,
      'Mixed rugby ends at U12 in both codes, so this player needs a boys or girls identity from this age grade onward. That is a decision, not something Ovalball should pick.';
    return;
  end if;

  -- EXACT match first, in every code and for every sex.
  select v.id, v.key, v.label into v_id, v_key, v_label
  from public.canonical_team_types_by_code v
  where v.rugby_code = p_rugby_code and v.is_offered
    and v.category = 'youth' and v.age_group = r.regulatory_age_label
    and coalesce(v.gender, '') = case when v_gender = 'girls' then 'girls' else coalesce(v.gender, '') end
    and (v_gender <> 'girls' or v.gender = 'girls')
    and (v_gender = 'girls' or v.gender is distinct from 'girls')
  order by v.sort_order
  limit 1;

  if v_id is not null then
    return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
      format('%s is the normal operational team for a %s player in this season.', v_label, r.regulatory_age_label);
    return;
  end if;

  -- UNION GIRLS ONLY: dual age bands. RFU Regulation 15.6 defines U12/U11,
  -- U14/U13, U16/U15 and U18/U17, so a girl whose regulatory age has no
  -- identity of its own belongs in the band named by the NEXT age up. This
  -- banding is evidenced; it is not applied to any other code or sex.
  if p_rugby_code = 'union' and v_gender = 'girls' then
    select v.id, v.key, v.label, v.age_group into v_id, v_key, v_label, v_age_group
    from public.canonical_team_types_by_code v
    where v.rugby_code = 'union' and v.is_offered and v.category = 'youth' and v.gender = 'girls'
      and substring(v.age_group from 2)::integer >= r.regulatory_age_number
    order by substring(v.age_group from 2)::integer
    limit 1;

    if v_id is not null then
      return query select r.regulatory_age_label, r.status, v_id, v_key, v_label, 'NORMAL_PLACEMENT'::text,
        format('%s is the normal operational team: RFU Regulation 15.6 puts a %s girl in the %s/%s dual age band.',
          v_label, r.regulatory_age_label, v_age_group, r.regulatory_age_label);
      return;
    end if;
  end if;

  -- No identity, and no evidenced rule for widening the search. This is the
  -- League Girls U17 case: the regulatory age exists (RFL F13 lists Under 17s)
  -- but the 2026 Girls League has no U17 division, and eligibility to play up
  -- is NOT the same as automatic placement. Say so; do not invent a team.
  return query select r.regulatory_age_label, r.status, null::uuid, null::text, null::text,
    'NEEDS_ATTENTION'::text,
    format('This player''s regulatory age is %s, but %s rugby offers no operational team at that age grade for this player. A placement decision is required -- Ovalball will not manufacture an identity the competition does not run, nor silently place the player in a different age grade.',
      r.regulatory_age_label, case p_rugby_code when 'union' then 'Union' else 'League' end);
end;
$function$;

comment on function public.resolve_normal_operational_identity(text, uuid, date, text) is
  'Maps a resolved regulatory age onto the NORMAL operational team identity, by canonical id read from the directory -- never by constructing a key like ''girls_u'' || age, which would be a hidden second catalogue. Union girls widen to the dual age band above (RFU Regulation 15.6); no other code or sex widens, because no other widening is evidenced. Where a regulatory age exists but the code offers no team at it -- League Girls U17 in 2026 -- it returns NEEDS_ATTENTION rather than inventing an identity or silently reassigning the player.';

grant execute on function public.resolve_normal_operational_identity(text, uuid, date, text) to authenticated;

-- ============================================================
-- 4. Retire the old resolver's Colts output: delegate to the canonical one.
-- ============================================================

create or replace function internal.resolve_player_age_grade(p_rugby_code text, p_season_id uuid, p_date_of_birth date)
returns table(rugby_code text, season_id uuid, date_of_birth date, age_grade_cutoff_date date, age_at_cutoff integer,
              school_year integer, canonical_category text, canonical_age_group text, status text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  select * into r from public.resolve_player_regulatory_age(p_rugby_code, p_season_id, p_date_of_birth);
  if r.status = 'SEASON_NOT_FOUND' then
    raise exception 'Season not found for this rugby code.' using errcode = '22023';
  end if;
  if r.status = 'DOB_REQUIRED' then
    raise exception 'Date of birth is required to resolve an age grade.' using errcode = '22023';
  end if;
  if r.status = 'INVALID_DOB' then
    raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
  end if;

  return query select
    r.rugby_code, r.season_id, p_date_of_birth,
    -- The cutoff this grade was measured against: 31 August closing the
    -- school year the season belongs to.
    make_date(r.school_year_start + 1, 8, 31),
    r.regulatory_age_number - 1,
    r.school_year,
    case when r.status = 'RESOLVED' then 'youth' else null end,
    r.regulatory_age_label,
    case r.status when 'ADULT' then 'OUT_OF_YOUTH_RANGE' else r.status end;
end;
$function$;

comment on function internal.resolve_player_age_grade(text, uuid, date) is
  'Backwards-compatible shape over the canonical resolver. It no longer returns JuniorColts/SeniorColts -- those identities were retired when Colts converged onto U17/U18 -- and it is now code-aware, where before it applied one cutoff to both codes. New callers should use public.resolve_player_regulatory_age, or public.resolve_normal_operational_identity when they need an operational team rather than an age.';

-- ============================================================
-- 5. Guards: reproduce the published windows exactly.
-- ============================================================

do $$
declare
  v_league uuid; v_union uuid; r record; v_bad text := '';
begin
  select id into v_league from public.seasons where rugby_code='league' and season_year_start=2026 and not is_regression_fixture limit 1;
  select id into v_union  from public.seasons where rugby_code='union'  and season_year_start=2026 and not is_regression_fixture limit 1;
  if v_league is null or v_union is null then
    raise notice 'Skipping window checks: no 2026 season rows present.';
    return;
  end if;

  -- Every published RFL F13 window for season 2026 must be reproduced.
  for r in select * from (values
    (6,'2019-09-01','2020-08-31'), (7,'2018-09-01','2019-08-31'), (9,'2016-09-01','2017-08-31'),
    (10,'2015-09-01','2016-08-31'), (11,'2014-09-01','2015-08-31'), (12,'2013-09-01','2014-08-31'),
    (13,'2012-09-01','2013-08-31'), (14,'2011-09-01','2012-08-31'), (15,'2010-09-01','2011-08-31'),
    (16,'2009-09-01','2010-08-31'), (17,'2008-09-01','2009-08-31'), (18,'2007-09-01','2008-08-31')
  ) as t(n, lo, hi)
  loop
    if (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, r.lo::date)) <> r.n
       or (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, r.hi::date)) <> r.n then
      v_bad := v_bad || format(' U%s(%s..%s)', r.n, r.lo, r.hi);
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'RFL F13 windows not reproduced for:%', v_bad;
  end if;

  -- The one-year code offset, stated as an assertion rather than a comment.
  if (select regulatory_age_number from public.resolve_player_regulatory_age('league', v_league, date '2013-09-01')) <> 12
     or (select regulatory_age_number from public.resolve_player_regulatory_age('union', v_union, date '2013-09-01')) <> 13 then
    raise exception 'The union/league school-year offset is wrong: the same DOB must be U12 in RFL 2026 and U13 in RFU 2026/27.';
  end if;

  -- No retired identity may come back out of the resolver.
  if exists (
    select 1 from public.resolve_player_regulatory_age('union', v_union, date '2008-09-01')
    where regulatory_age_label in ('JuniorColts','SeniorColts')
  ) then
    raise exception 'The age resolver still emits a retired Colts identity.';
  end if;
end $$;
