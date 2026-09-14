-- A competition needs only a name (and which code it is played in).
--
-- 1. A FULL SITE ADMIN MANAGES COMPETITIONS. internal.can_manage_competitions
--    read only the per-person manage_competitions flag, so a Full Site Admin
--    -- who holds every other site capability -- could not add a competition
--    until somebody ticked a box for them. has_site_role_capability already
--    answers true for Full; this function now agrees.
--
-- 2. NAME + UNION/LEAGUE IS A COMPETITION. Areas and the National flag were
--    compulsory ("Select at least one county/area, or mark this competition
--    National"). They are optional metadata now. Rugby code stays required:
--    Union and League are strictly isolated, and a competition with no code
--    could not be kept out of the other sport's selectors.
--
-- 3. A NEW COMPETITION IS SELECTABLE STRAIGHT AWAY. Selectors read active
--    editions, and an edition belongs to a season. public.quick_create_competition
--    creates the competition and its edition for the code's CURRENT canonical
--    season (the seasons register -- never a computed date). Where no season
--    is current it uses the next one registered; where none is registered it
--    creates the competition alone and says the season register needs
--    attention, rather than inventing a season.
--
-- 4. OPTIONAL METADATA AND AN ORGANISER. Age/category (a canonical team type),
--    format, organiser body and an organising club. The organising club is what
--    lets a club run its own competition in the Competition Creator; it grants
--    authority over that competition only, never over anybody's fixtures.

create or replace function internal.can_manage_competitions()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_account_active(auth.uid()) and (
    internal.is_full_site_admin()
    or exists (
      select 1 from public.site_admins sa
      where sa.user_id = auth.uid() and sa.status = 'active' and sa.manage_competitions
    )
  );
$$;

alter table public.competitions
  add column if not exists canonical_team_type_id uuid references public.canonical_team_types(id),
  add column if not exists format text,
  add column if not exists organiser_name text,
  add column if not exists organiser_club_id uuid references public.clubs(id),
  add column if not exists team_count integer;

alter table public.competitions drop constraint if exists competitions_team_count_check;
alter table public.competitions
  add constraint competitions_team_count_check check (team_count is null or team_count between 2 and 128);

alter table public.competitions drop constraint if exists competitions_format_check;
alter table public.competitions
  add constraint competitions_format_check check (format is null or format in ('league', 'knockout', 'league_knockout'));

comment on column public.competitions.canonical_team_type_id is 'Optional age/category identity the competition is for (e.g. U12 Boys). Used to rank and filter participants; never required to create a competition.';
comment on column public.competitions.format is 'Optional: league, knockout or league_knockout. Set by the Competition Creator.';
comment on column public.competitions.organiser_name is 'Optional organiser or governing body, as the competition presents it.';
comment on column public.competitions.organiser_club_id is 'The Ovalball club that organises this competition, if a club does. Its club fixture administrators have organiser authority over THIS competition only (internal.can_organise_competition).';

-- ------------------------------------------------------------
-- Areas become optional.
-- ------------------------------------------------------------
create or replace function public.create_competition(p_name text, p_description text, p_rugby_code text, p_is_national boolean, p_area_ids uuid[] default array[]::uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_id uuid;
  v_slug text;
  v_normalized text;
  v_area_id uuid;
begin
  if not internal.can_manage_competitions() then
    raise exception 'Only a Site Admin with Competition management access may add a global competition.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'A competition name is required.';
  end if;
  if p_rugby_code is null or p_rugby_code not in ('union', 'league') then
    raise exception 'Choose Union or League for this competition.';
  end if;
  if coalesce(p_is_national, false) and coalesce(array_length(p_area_ids, 1), 0) > 0 then
    raise exception 'A National competition cannot also have specific county/area scope. Turn off National, or clear the selected areas.' using errcode = '23514';
  end if;

  v_normalized := trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || p_rugby_code;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || p_rugby_code;

  begin
    insert into public.competitions (name, slug, normalized_key, rugby_code, description, is_national, active, created_by, updated_by)
    values (trim(p_name), v_slug, v_normalized, p_rugby_code, nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_national, false), true, auth.uid(), auth.uid())
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', initcap(p_rugby_code), trim(p_name) using errcode = 'P0001';
  end;

  foreach v_area_id in array coalesce(p_area_ids, array[]::uuid[]) loop
    insert into public.competition_areas (competition_id, area_id) values (v_new_id, v_area_id)
    on conflict do nothing;
  end loop;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('competitions', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('name', trim(p_name), 'rugby_code', p_rugby_code, 'is_national', coalesce(p_is_national, false), 'area_ids', p_area_ids));

  return v_new_id;
end;
$function$;

-- ------------------------------------------------------------
-- The season a new competition's first edition belongs to.
-- ------------------------------------------------------------
create or replace function internal.edition_season_for_code(p_rugby_code text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    internal.resolve_season_for_date(p_rugby_code, current_date),
    (select s.id from public.seasons s
      where s.rugby_code = p_rugby_code and not s.is_regression_fixture
        and coalesce(s.pre_season_starts_on, s.starts_on) > current_date
      order by s.starts_on
      limit 1)
  );
$$;

create or replace function public.quick_create_competition(p_name text, p_rugby_code text)
returns table (competition_id uuid, edition_id uuid, season_id uuid, season_name text, needs_attention text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_competition uuid;
  v_season uuid;
  v_edition uuid;
begin
  v_competition := public.create_competition(p_name, null, p_rugby_code, false, array[]::uuid[]);
  v_season := internal.edition_season_for_code(p_rugby_code);

  if v_season is null then
    return query select v_competition, null::uuid, null::uuid, null::text,
      format('No current or upcoming %s season is registered, so this competition has no season yet. Add the season under Site Admin, Seasons, then add it here.', initcap(p_rugby_code));
    return;
  end if;

  v_edition := public.create_competition_edition(v_competition, v_season);
  return query select v_competition, v_edition, v_season, (select s.name from public.seasons s where s.id = v_season), null::text;
end;
$function$;

revoke execute on function public.quick_create_competition(text, text) from public;
revoke execute on function public.quick_create_competition(text, text) from anon;
grant  execute on function public.quick_create_competition(text, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Organiser authority: the one predicate the Competition Creator reads.
-- ------------------------------------------------------------
create or replace function internal.can_organise_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.competitions c
    where c.id = p_competition_id
      and (
        internal.can_manage_competitions()
        or (c.organiser_club_id is not null and internal.can_bulk_plan_fixtures(c.organiser_club_id))
      )
  );
$$;

comment on function internal.can_organise_competition(uuid) is
  'Competition organiser authority: Site Admins who manage competitions (Full, or with Competition management), or the club fixture administrators of the organising club. Governs Competition Matches only -- it grants nothing over any club''s fixtures.';

create or replace function public.can_organise_competition(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.can_organise_competition(p_competition_id);
$$;

revoke execute on function public.can_organise_competition(uuid) from public;
revoke execute on function public.can_organise_competition(uuid) from anon;
grant  execute on function public.can_organise_competition(uuid) to authenticated, service_role;

-- A club fixture administrator may create a competition their club organises.
create or replace function public.create_club_competition(p_name text, p_rugby_code text, p_organiser_club_id uuid)
returns table (competition_id uuid, edition_id uuid, season_id uuid, season_name text, needs_attention text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_competition uuid;
  v_season uuid;
  v_edition uuid;
  v_slug text;
  v_normalized text;
begin
  if not internal.can_bulk_plan_fixtures(p_organiser_club_id) then
    raise exception 'Only a club fixture administrator may create a competition for their club.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'A competition name is required.';
  end if;
  if p_rugby_code is null or p_rugby_code not in ('union', 'league') then
    raise exception 'Choose Union or League for this competition.';
  end if;
  if exists (
    select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
    where c.id = p_organiser_club_id and d.rugby_code <> p_rugby_code
  ) then
    raise exception 'A club can only organise a competition in its own rugby code.' using errcode = '23514';
  end if;

  v_normalized := trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || p_rugby_code;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || p_rugby_code;
  begin
    insert into public.competitions (name, slug, normalized_key, rugby_code, is_national, active, organiser_club_id, created_by, updated_by)
    values (trim(p_name), v_slug, v_normalized, p_rugby_code, false, true, p_organiser_club_id, auth.uid(), auth.uid())
    returning id into v_competition;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', initcap(p_rugby_code), trim(p_name) using errcode = 'P0001';
  end;

  v_season := internal.edition_season_for_code(p_rugby_code);
  if v_season is null then
    return query select v_competition, null::uuid, null::uuid, null::text,
      format('No current or upcoming %s season is registered, so this competition has no season yet.', initcap(p_rugby_code));
    return;
  end if;
  insert into public.competition_editions (competition_id, season_id, rugby_code, active, created_by, updated_by)
  values (v_competition, v_season, p_rugby_code, true, auth.uid(), auth.uid())
  returning id into v_edition;

  return query select v_competition, v_edition, v_season, (select s.name from public.seasons s where s.id = v_season), null::text;
end;
$function$;

revoke execute on function public.create_club_competition(text, text, uuid) from public;
revoke execute on function public.create_club_competition(text, text, uuid) from anon;
grant  execute on function public.create_club_competition(text, text, uuid) to authenticated, service_role;

-- Organisers may update their own competition's optional metadata.
drop function if exists public.update_competition_metadata(uuid, uuid, text, text);
create or replace function public.update_competition_metadata(
  p_competition_id uuid,
  p_canonical_team_type_id uuid,
  p_format text,
  p_organiser_name text,
  p_team_count integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not internal.can_organise_competition(p_competition_id) then
    raise exception 'You do not organise this competition.' using errcode = '42501';
  end if;
  update public.competitions
  set canonical_team_type_id = p_canonical_team_type_id,
      format = nullif(p_format, ''),
      organiser_name = nullif(trim(coalesce(p_organiser_name, '')), ''),
      team_count = p_team_count,
      updated_by = auth.uid()
  where id = p_competition_id;
end;
$function$;

revoke execute on function public.update_competition_metadata(uuid, uuid, text, text, integer) from public;
revoke execute on function public.update_competition_metadata(uuid, uuid, text, text, integer) from anon;
grant  execute on function public.update_competition_metadata(uuid, uuid, text, text, integer) to authenticated, service_role;
