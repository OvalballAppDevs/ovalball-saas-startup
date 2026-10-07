-- A TRI-FIXTURE IS THREE TEAMS, AND ITS TABLE IS A CHOICE.
--
-- Tri-Fixture has existed as a competition format since 20270599000000, described in that migration's
-- own words as "exactly three teams, each playing the other two". Nothing enforced it. The only
-- validation anywhere in the planning path is that a table needs at least two sides, so a Tri-Fixture
-- could be created with eleven clubs spread across five tables, generate fifty-five games, and still
-- be called a Tri-Fixture. The name was a label with no rule behind it.
--
-- TWO THINGS CHANGE, AND NOTHING ELSE DOES.
--
-- FIRST, THE THREE IS ENFORCED. A Tri-Fixture refuses to generate unless its competition holds exactly
-- three sides. The check is at GENERATION rather than at entry, because an organiser builds a field one
-- club at a time and a rule that fired on the second side would make the format unusable. It is the
-- same place the knockout's own field rules are enforced, for the same reason.
--
-- SECOND, THE TABLE BECOMES A CHOICE. A tri-fixture at a club is often three sides sharing a ground for
-- a morning rather than a competition anybody is winning, and a standings table is then a claim about
-- the day that nobody made. So `standings_enabled` records what the organiser actually wants. NULL
-- means "whatever this format does by default", which keeps every existing plan behaving exactly as it
-- does today: a Round Robin has always had a table and still does.
--
-- WHAT DOES NOT CHANGE: the generator, the results lifecycle, attendance, the Calendar, the Tournament
-- Centre and the standings arithmetic. A Tri-Fixture is a Round Robin with a constraint and a switch,
-- not a second competition product.

alter table public.tournament_plans
  add column if not exists standings_enabled boolean;

comment on column public.tournament_plans.standings_enabled is
  'Whether this competition keeps a table. NULL means the format''s own default -- a Round Robin keeps '
  'one, a Tri-Fixture does not unless the organiser asks. Never a second standings model: when it is '
  'on, the table is the ordinary calculated Round Robin table.';

-- ---- THE ONE AUTHORITY ON WHETHER A COMPETITION HAS A TABLE ----------------------------------------
--
-- Asked by the planning surfaces, the Tournament Centre's tabs and the standings read alike, so none of
-- them works it out for itself. A format with no table at all (a knockout, a Swiss) answers false
-- whatever the column says, because the column is a preference and the format is a fact.

create or replace function internal.tournament_plan_has_standings(p_plan_id uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    -- A KNOCKOUT HAS A DRAW, NOT A TABLE. No switch makes one appear.
    when coalesce(p.format, t.format) in ('knockout') then false
    -- THE ORGANISER'S OWN ANSWER, where they have given one.
    when p.standings_enabled is not null then p.standings_enabled
    -- THE FORMAT'S DEFAULT. A Round Robin has always kept a table. A Tri-Fixture is three sides sharing
    -- a morning until somebody says otherwise.
    when coalesce(p.format, t.format) = 'tri_fixture' then false
    when coalesce(p.format, t.format) = 'round_robin' then true
    else false
  end
  from public.tournament_plans p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;
$function$;

-- ---- HOW MANY SIDES THIS FORMAT ALLOWS -------------------------------------------------------------

create or replace function internal.tournament_format_side_limit(p_format text)
returns integer
language sql
immutable
as $function$
  -- Exactly three, each playing the other two. Null means the format does not constrain its field.
  select case when p_format = 'tri_fixture' then 3 end;
$function$;

-- ---- THE SETTING'S WRITE PATH ----------------------------------------------------------------------

create or replace function public.set_tournament_plan_standings(p_plan_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan public.tournament_plans; v_format text;
begin
  perform internal.require_live_session();

  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select coalesce(v_plan.format, t.format) into v_format
  from public.tournaments t where t.id = v_plan.tournament_id;

  -- A FORMAT WITHOUT A TABLE IS NOT GIVEN ONE BY A SWITCH. Refusing here rather than silently storing a
  -- preference nothing will read is the difference between a setting and a lie.
  if v_format = 'knockout' then
    raise exception 'A knockout has a draw rather than a table, so there is no table to turn on.'
      using errcode = '22023';
  end if;

  update public.tournament_plans
  set standings_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
end;
$function$;

revoke all on function public.set_tournament_plan_standings(uuid, boolean) from public;
grant execute on function public.set_tournament_plan_standings(uuid, boolean) to authenticated;

-- ---- THE THREE IS ENFORCED WHERE THE COMPETITION IS BUILT -------------------------------------------

create or replace function internal.refuse_if_field_is_not_the_format_s_size(p_plan_id uuid)
returns void
language plpgsql
stable
set search_path to ''
as $function$
declare v_format text; v_limit integer; v_sides integer;
begin
  select coalesce(p.format, t.format) into v_format
  from public.tournament_plans p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;

  v_limit := internal.tournament_format_side_limit(v_format);
  if v_limit is null then return; end if;

  v_sides := cardinality(internal.tournament_plan_sides(p_plan_id));
  if v_sides <> v_limit then
    raise exception
      'A Tri-Fixture is exactly % teams, each playing the other two. This competition has %.',
      v_limit, v_sides
      using errcode = '22023', hint = 'TOURNAMENT_FORMAT_FIELD_SIZE';
  end if;
end;
$function$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_tournament_plan_fixtures';

  if position('refuse_if_field_is_not_the_format_s_size' in v_src) = 0 then
    v_src := replace(
      v_src,
      'select min(day_date) into v_first_day from public.tournament_plan_days where plan_id = p_plan_id;',
      '-- THE FIELD MUST BE THE SHAPE THE FORMAT PROMISES. A Tri-Fixture with five sides is not a'
      || E'\n  -- Tri-Fixture, and generating one would put a name on a day that is not what happened.'
      || E'\n  perform internal.refuse_if_field_is_not_the_format_s_size(p_plan_id);'
      || E'\n\n  select min(day_date) into v_first_day from public.tournament_plan_days where plan_id = p_plan_id;');

    execute format(
      'create or replace function public.generate_tournament_plan_fixtures(p_plan_id uuid) returns integer language plpgsql security definer set search_path to ''public'' as %L',
      v_src);
  end if;
end $$;

-- THE REPLACEMENT IS A CLAIM, so prove it landed rather than trusting the string match.
do $$
begin
  if (select position('refuse_if_field_is_not_the_format_s_size' in prosrc) = 0
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'generate_tournament_plan_fixtures') then
    raise exception 'The field-size check was not wired into generate_tournament_plan_fixtures.';
  end if;
  if internal.tournament_format_side_limit('tri_fixture') <> 3 then
    raise exception 'A Tri-Fixture is no longer three teams.';
  end if;
  if internal.tournament_format_side_limit('round_robin') is not null then
    raise exception 'A Round Robin has acquired a field-size limit it should not have.';
  end if;
end $$;
