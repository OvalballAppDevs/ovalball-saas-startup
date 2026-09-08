-- One structured source for what a team is called, everywhere.
--
-- WHAT WAS WRONG
--
-- Ovalball wrote team names in four places -- the canonical directory label,
-- teams.display_name, the signup wizard's phrasing and Calendar's compact
-- label -- each with its own hand-written rules for the Girls prefix, the
-- Men's/Women's forms and the age grade. They agreed today only because
-- somebody kept them in step by hand, and the previous audit found nothing
-- enforcing that.
--
-- They also all said the same unhelpful thing. "U12" is a rugby identifier,
-- not a name: it does not say whether the side is boys, girls or mixed, so a
-- club running both U12 and Girls U12 sees one of them described by what it is
-- and the other by what it is not.
--
-- THE RULE
--
--   compact   U12              the rugby identifier, for dense surfaces
--   display   Under 12 Boys    what the team is CALLED, everywhere else
--
-- Both come from one function over the structured identity -- rugby code,
-- category, age grade, pathway, squad. The display form is the site-wide
-- display name: team management, fixtures, signup, handover, Match Centre.
-- Calendar lanes and filter chips may still use the compact form, because
-- density is a deliberate design decision there, but it is a variant of this
-- source rather than a second naming rule.
--
-- WHAT THE PATHWAY WORD DOES NOT DO
--
-- A team whose gender is not recorded gets NO pathway word -- "Under 14", not
-- "Under 14 Boys". Ovalball never assumes a pathway it has not been told, and
-- a display name is not the place to start.

create or replace function internal.canonical_team_presentation(
  p_category text, p_age_group text, p_gender text, p_squad_designation text,
  p_rugby_code text default 'union'
) returns table(compact text, display text)
language sql immutable
as $function$
  with n as (
    select
      -- "A" is never a real squad letter: the primary, unlettered squad IS
      -- "A" conceptually, whatever a legacy row happens to store.
      case when p_squad_designation is null or upper(p_squad_designation) in ('', 'A')
           then null else p_squad_designation end as squad,
      case p_gender when 'girls' then 'Girls' when 'mixed' then 'Mixed'
                    when 'boys' then 'Boys' else null end as pathway,
      nullif(regexp_replace(coalesce(p_age_group, ''), '^U', ''), '') as age_number
  )
  select
    case
      when p_category = 'colts' then
        (case when p_age_group = 'SeniorColts' then 'Senior Colts' else 'Junior Colts' end)
      when p_category = 'senior' then
        (case when p_gender = 'womens' then 'Women''s' else 'Men''s' end)
          || (case when p_rugby_code = 'league' then ' Open Age'
                   else ' ' || coalesce(n.squad, '1st') || ' Team' end)
      else
        (case when p_gender = 'girls' then 'Girls ' else '' end)
          || coalesce(p_age_group, 'Team')
          || coalesce(' ' || n.squad, '')
    end,
    case
      when p_category = 'colts' then
        (case when p_age_group = 'SeniorColts' then 'Senior Colts' else 'Junior Colts' end)
      when p_category = 'senior' then
        (case when p_gender = 'womens' then 'Women''s' else 'Men''s' end)
          || (case when p_rugby_code = 'league' then ' Open Age'
                   else ' ' || coalesce(n.squad, '1st') || ' Team' end)
          || coalesce(case when p_rugby_code = 'league' then ' ' || n.squad end, '')
      when n.age_number is null then coalesce(p_age_group, 'Team') || coalesce(' ' || n.squad, '')
      else
        'Under ' || n.age_number
          || coalesce(' ' || n.pathway, '')
          || coalesce(' ' || n.squad, '')
    end
  from n;
$function$;

comment on function internal.canonical_team_presentation(text, text, text, text, text) is
  'The one place a team''s name is decided. compact is the rugby identifier (U12) for dense surfaces; display is what the team is CALLED site-wide (Under 12 Boys). A team with no recorded pathway gets no pathway word -- Ovalball never assumes one.';

-- ---------------------------------------------------------------------------
-- The site-wide display name
-- ---------------------------------------------------------------------------
--
-- compute_team_display_name keeps its name and its callers; what changes is
-- that it now delegates rather than restating the rules, and returns the
-- human form. The rugby code is needed because a senior side is "Men's 1st
-- Team" in union and "Men's Open Age" in league -- the old signature could not
-- tell those apart and would have called a league Open Age side "Men's 1st".

drop function if exists internal.compute_team_display_name(text, text, text, text);

create or replace function internal.compute_team_display_name(
  p_category text, p_age_group text, p_gender text, p_squad_designation text,
  p_rugby_code text default 'union'
) returns text
language sql immutable
as $function$
  select display from internal.canonical_team_presentation(
    p_category, p_age_group, p_gender, p_squad_designation, p_rugby_code);
$function$;

create or replace function internal.compute_team_compact_label(
  p_category text, p_age_group text, p_gender text, p_squad_designation text,
  p_rugby_code text default 'union'
) returns text
language sql immutable
as $function$
  select compact from internal.canonical_team_presentation(
    p_category, p_age_group, p_gender, p_squad_designation, p_rugby_code);
$function$;

-- The directory's own label is the same compact identifier, from the same
-- source. It was a separate hand-written copy of these rules.
create or replace function internal.compute_canonical_type_label(
  p_category text, p_age_group text, p_gender text, p_fixed_squad_designation text
) returns text
language sql immutable
as $function$
  select compact from internal.canonical_team_presentation(
    p_category, p_age_group, p_gender, p_fixed_squad_designation,
    case when p_category = 'senior' and p_fixed_squad_designation is null then 'league' else 'union' end);
$function$;

create or replace function internal.teams_set_display_name()
returns trigger
language plpgsql
as $function$
begin
  new.display_name := internal.compute_team_display_name(
    new.category, new.age_group, new.gender, new.squad_designation, new.rugby_code);
  new.slug := trim(both '-' from regexp_replace(lower(new.display_name), '[^a-z0-9]+', '-', 'g'));
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Everything that names a team now names it the same way
-- ---------------------------------------------------------------------------

create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table(category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql stable
as $function$
declare
  v_team public.teams;
  v_current_season_id uuid;
  v_current_starts_on date;
  v_target_starts_on date;
  v_seasons_ahead integer;
  v_projected_age text;
  v_is_deterministic boolean;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then return; end if;

  -- A stored season identity always wins: it is the historical record of what
  -- this team actually was in that season, and must never be re-derived.
  return query
    select tsi.category, tsi.age_group, tsi.squad_designation, tsi.gender, tsi.display_name, false
    from public.team_season_identity tsi
    where tsi.team_id = p_team_id and tsi.season_id = p_season_id;
  if found then return; end if;

  select id into v_current_season_id
  from public.seasons
  where rugby_code = v_team.rugby_code and starts_on < current_date
  order by starts_on desc, is_regression_fixture asc, id asc limit 1;

  if v_current_season_id is null or v_current_season_id = p_season_id or v_team.category <> 'youth' or v_team.age_group is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select starts_on into v_current_starts_on from public.seasons where id = v_current_season_id;
  select starts_on into v_target_starts_on from public.seasons where id = p_season_id;
  if v_current_starts_on is null or v_target_starts_on is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_seasons_ahead := (extract(year from age(v_target_starts_on, v_current_starts_on)))::integer;
  if v_seasons_ahead <= 0 then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select p.projected_age_group, p.is_deterministic into v_projected_age, v_is_deterministic
  from internal.project_team_identity(v_team.age_group, v_team.gender, v_team.rugby_code, v_seasons_ahead) p;

  if not coalesce(v_is_deterministic, false) or v_projected_age is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender,
    internal.compute_team_display_name(v_team.category, v_projected_age, v_team.gender, v_team.squad_designation, v_team.rugby_code),
    true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Existing rows
-- ---------------------------------------------------------------------------
--
-- Display names are derived, so the stored values are a cache and re-deriving
-- them is not a data change in any meaningful sense. Team ids, canonical
-- identities, memberships and fixtures are all untouched.
--
-- team_season_identity is deliberately NOT rewritten: those rows record what a
-- team WAS called in a season that has already happened, and history is not
-- re-spelled because presentation improved.

do $$
declare v_teams int; v_types int;
begin
  update public.teams
  set display_name = internal.compute_team_display_name(category, age_group, gender, squad_designation, rugby_code)
  where display_name is distinct from internal.compute_team_display_name(category, age_group, gender, squad_designation, rugby_code);
  get diagnostics v_teams = row_count;

  update public.canonical_team_types
  set label = internal.compute_canonical_type_label(category, age_group, gender, fixed_squad_designation)
  where label is distinct from internal.compute_canonical_type_label(category, age_group, gender, fixed_squad_designation);
  get diagnostics v_types = row_count;

  raise notice 'Canonical presentation: % team display name(s) and % directory label(s) re-derived from the one source. Historical season identities left as recorded.',
    v_teams, v_types;
end $$;

do $$
begin
  if internal.compute_team_display_name('youth','U12','boys',null,'union') <> 'Under 12 Boys'
     or internal.compute_team_display_name('youth','U9','mixed',null,'union') <> 'Under 9 Mixed'
     or internal.compute_team_display_name('youth','U14','girls','B','union') <> 'Under 14 Girls B'
     or internal.compute_team_display_name('senior',null,'mens','1st','union') <> 'Men''s 1st Team'
     or internal.compute_team_display_name('senior',null,'womens',null,'league') <> 'Women''s Open Age' then
    raise exception 'The canonical display name is not what the standard says it is.';
  end if;
  if internal.compute_team_compact_label('youth','U12','boys',null,'union') <> 'U12'
     or internal.compute_team_compact_label('youth','U14','girls','B','union') <> 'Girls U14 B' then
    raise exception 'The compact rugby identifier is wrong.';
  end if;
  -- A pathway nobody recorded is never invented.
  if internal.compute_team_display_name('youth','U14',null,null,'union') <> 'Under 14' then
    raise exception 'A display name asserted a playing pathway that was never recorded.';
  end if;
end $$;
