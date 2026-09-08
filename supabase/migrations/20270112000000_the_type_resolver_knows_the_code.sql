-- A League club can create its own adult team.
--
-- FOUND WHILE BUILDING ADULT SELF-REGISTRATION
--
-- internal.resolve_canonical_team_type takes category, age group, gender and
-- squad designation -- and not the rugby code. For youth that has never
-- mattered, because both codes use the same age-grade labels. For adults it is
-- fatal:
--
--   Rugby Union    Men's 1st Team   fixed_squad_designation = '1st'
--   Rugby League   Men's Open Age   fixed_squad_designation = null
--
-- The senior branch matches either a designation equal to the one asked for
-- (defaulting to '1st') OR a null designation, so a League club creating its
-- men's side matched BOTH -- and sort order handed back Men's 1st Team, a Union
-- identity. validate_canonical_type_active_on_create then correctly refused the
-- insert, so nothing wrong was ever stored; the visible symptom was that a
-- Rugby League club simply could not create its adult team at all, with an
-- error naming an identity it had never asked for.
--
-- The fix is the one this codebase applies everywhere else: scope it in the
-- query. The resolver now takes the code and prefers an identity that code is
-- actually offered, falling back to the old behaviour only when no code is
-- supplied, so every existing caller keeps working unchanged.

create or replace function internal.resolve_canonical_team_type(
  p_category text,
  p_age_group text,
  p_gender text,
  p_squad_designation text,
  p_rugby_code text default null
)
returns uuid
language sql
stable
as $function$
  with normalised as (
    select
      case when p_age_group in ('JuniorColts','SeniorColts') then 'youth' else p_category end as category,
      case p_age_group when 'JuniorColts' then 'U17' when 'SeniorColts' then 'U18' else p_age_group end as age_group,
      case when p_age_group in ('JuniorColts','SeniorColts') then coalesce(nullif(p_gender,''), 'boys') else p_gender end as gender
  )
  select ctt.id
  from public.canonical_team_types ctt, normalised n
  where ctt.category = n.category
    and (
      (n.category = 'senior' and ctt.gender = n.gender
        and (ctt.fixed_squad_designation = coalesce(nullif(p_squad_designation, ''), '1st') or ctt.fixed_squad_designation is null))
      or (n.category = 'colts' and ctt.age_group = n.age_group)
      or (n.category = 'youth' and ctt.age_group = n.age_group
          and ctt.gender = case when n.gender = 'girls' then 'girls' else ctt.gender end)
    )
  -- An identity the CODE ACTUALLY OFFERS wins first. Without this a League
  -- men's side resolved to Union's Men's 1st Team purely because it sorts
  -- earlier, and the insert was then refused for naming an identity the club
  -- had never asked for. Null code keeps the previous ordering exactly.
  order by
    (p_rugby_code is not null and exists (
       select 1 from public.canonical_team_types_by_code v
       where v.id = ctt.id and v.rugby_code = p_rugby_code and v.is_offered)) desc,
    (ctt.gender is not distinct from n.gender) desc,
    ctt.is_active desc,
    ctt.sort_order
  limit 1;
$function$;

comment on function internal.resolve_canonical_team_type(text, text, text, text, text) is
  'Resolves the canonical identity for a set of structured team fields. Given a rugby code it prefers an identity that code is offered, which is what lets a Rugby League club create Men''s Open Age instead of matching Union''s Men''s 1st Team on sort order.';

-- The teams trigger has the code on the row it is validating, so it passes it.
create or replace function internal.teams_set_canonical_type()
returns trigger
language plpgsql
as $function$
declare
  v_mini boolean;
  v_stated text := new.gender;
  v_canonical_gender text;
begin
  v_mini := new.category = 'youth'
    and new.age_group in ('U6','U7','U8','U9','U10','U11');

  if new.gender is null and v_mini then
    new.gender := 'mixed';
  end if;

  if new.gender is null and new.category = 'youth' and not v_mini then
    raise exception 'An Under-12 or older team plays in the boys'' or the girls'' pathway, and Ovalball will not choose for you. Set the pathway on this team.'
      using errcode = '23514';
  end if;

  if new.gender is null and new.category = 'senior' then
    raise exception 'A senior team is a men''s or a women''s side. Set which one.'
      using errcode = '23514';
  end if;

  new.canonical_team_type_id := internal.resolve_canonical_team_type(
    new.category, new.age_group, new.gender, new.squad_designation, new.rugby_code);

  if new.canonical_team_type_id is not null then
    select ctt.gender into v_canonical_gender
    from public.canonical_team_types ctt where ctt.id = new.canonical_team_type_id;

    if v_stated is null then
      new.gender := coalesce(v_canonical_gender, new.gender);
    elsif v_canonical_gender is not null and v_stated is distinct from v_canonical_gender then
      raise exception 'There is no % team at % in the Team Directory. The closest identity Ovalball recognises is the % one, which is a different team.',
        v_stated, coalesce(new.age_group, new.category), v_canonical_gender
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

do $$
declare v_union uuid; v_league uuid;
begin
  select internal.resolve_canonical_team_type('senior', null, 'mens', null, 'union') into v_union;
  select internal.resolve_canonical_team_type('senior', null, 'mens', null, 'league') into v_league;
  raise notice 'union mens senior -> %', (select label from public.canonical_team_types where id = v_union);
  raise notice 'league mens senior -> %', (select label from public.canonical_team_types where id = v_league);
  if (select key from public.canonical_team_types where id = v_league) <> 'mens_open_age' then
    raise exception 'A League men''s senior side still does not resolve to Men''s Open Age.';
  end if;
  if (select key from public.canonical_team_types where id = v_union) <> 'mens_1st' then
    raise exception 'A Union men''s senior side no longer resolves to Men''s 1st Team.';
  end if;
end $$;

-- The check constraint re-resolved the identity WITHOUT the code, so a League
-- team that correctly resolved to Men's Open Age was then rejected for not
-- equalling Men's 1st Team. It asks the same question the trigger asks.
alter table public.teams drop constraint if exists teams_canonical_type_matches_fields;
alter table public.teams add constraint teams_canonical_type_matches_fields
  check (
    canonical_team_type_id is null
    or canonical_team_type_id = internal.resolve_canonical_team_type(
         category, age_group, gender, squad_designation, rugby_code)
  );

-- The four-argument version has to GO, not merely be superseded.
--
-- Adding p_rugby_code with a default created a second overload rather than
-- replacing the first, and Postgres then cannot choose between them: every
-- existing four-argument call became "function ... is not unique". Dropping
-- the old signature makes those calls resolve to the new function through its
-- default, which is what was intended.
drop function if exists internal.resolve_canonical_team_type(text, text, text, text);

do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'resolve_canonical_team_type';
  if v_n <> 1 then
    raise exception 'Expected exactly one resolve_canonical_team_type, found %.', v_n;
  end if;
end $$;
