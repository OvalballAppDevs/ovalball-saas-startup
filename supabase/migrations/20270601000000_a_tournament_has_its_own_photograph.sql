-- =====================================================================================================
-- A TOURNAMENT HAS ITS OWN PHOTOGRAPH.
--
-- Every tournament currently shows the SAME stock photograph in the list, so a club running a minis
-- festival, a youth cup day and a senior sevens sees three identical cards. The photograph is doing no
-- work: it cannot tell one tournament from another, which is the only job a thumbnail has.
--
-- THE SHAPE IS THE ONE ALREADY ESTABLISHED, not a second one invented for tournaments. Teams, venues,
-- pitches and changing rooms all carry exactly this pair:
--
--   cover_image_path  -- an upload, in the shared `club-news-media` bucket
--   cover_stock_key   -- a deliberate Ovalball Image Library selection
--
-- resolved by one contract function into a discriminated union, written by one governed RPC that
-- refuses both at once and revalidates the stock key against its own server-side allow-list. Storing a
-- raw URL on the row, or a second bucket, or a separate thumbnail column beside a hero column, would
-- each be a new source of truth for a problem four entities have already solved.
--
-- ONE SELECTION, EVERY SURFACE. There is deliberately no thumbnail column and no hero column: the list
-- card, the detail hero and anything built later all resolve the SAME pair, so changing the photograph
-- once changes it everywhere by construction rather than by remembering to.
--
-- NULL IS THE DEFAULT, AND STAYS NULL. A tournament with no cover resolves to the canonical Ovalball
-- default in the client. Writing the default's key into every existing row would turn "nobody has
-- chosen" into "somebody chose this", and the next time the default changes those rows would be left
-- behind holding a decision no one made. So this migration adds columns and changes no data.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. The columns.
-- -----------------------------------------------------------------------------------------------------

alter table public.tournaments add column if not exists cover_image_path text;
alter table public.tournaments add column if not exists cover_stock_key text;

comment on column public.tournaments.cover_image_path is
  'Storage path of a cover photo uploaded for this tournament, in the shared club-news-media bucket, '
  'shaped {club_id}/tournament-{tournament_id}/{uuid}.{ext}. Null when none was uploaded. Never a URL: '
  'the public URL is derived, so moving or re-signing the bucket does not rewrite rows.';

comment on column public.tournaments.cover_stock_key is
  'A deliberate Ovalball Image Library selection for this tournament. Null when none was chosen. '
  'Mutually exclusive with cover_image_path, enforced by set_tournament_cover and by the constraint '
  'below. Both null means the client resolves the canonical Ovalball default.';

-- A cover is one thing or the other. Enforced on the table as well as in the RPC, so no future writer
-- can leave a row holding two answers for one question.
alter table public.tournaments drop constraint if exists tournaments_cover_single_source;
alter table public.tournaments
  add constraint tournaments_cover_single_source
  check (cover_image_path is null or cover_stock_key is null);

-- -----------------------------------------------------------------------------------------------------
-- 2. Who may change a tournament's photograph.
--
-- The SAME authority that manages the tournament itself -- `tournament.tournament.manage` at the
-- hosting club -- and nothing wider. A tournament's cover is not separate media with its own
-- permission: whoever may rename the tournament may re-photograph it, and nobody else may do either.
-- -----------------------------------------------------------------------------------------------------

create or replace function internal.may_manage_tournament_media(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_club_id uuid;
  v_tournament_id uuid;
  v_owner uuid;
begin
  -- The path IS the claim, so it is parsed strictly rather than trusted: a club id, the tournament it
  -- belongs to, and a uuid filename with an image extension. Anything else is refused outright.
  m := regexp_match(
    coalesce(p_name, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/tournament-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
  if m is null then
    return false;
  end if;
  v_club_id := m[1]::uuid;
  v_tournament_id := m[2]::uuid;

  -- The club named in the path must actually host that tournament, so a club cannot write into its own
  -- folder a file claiming to belong to somebody else's tournament.
  select host_club_id into v_owner from public.tournaments where id = v_tournament_id;
  if v_owner is null or v_owner <> v_club_id then
    return false;
  end if;

  return internal.can('tournament.tournament.manage', 'club', v_club_id, null, null);
end;
$$;

revoke execute on function internal.may_manage_tournament_media(text) from public, anon;
grant execute on function internal.may_manage_tournament_media(text) to authenticated;

drop policy if exists club_news_media_tournament_insert on storage.objects;
drop policy if exists club_news_media_tournament_select on storage.objects;
drop policy if exists club_news_media_tournament_update on storage.objects;
drop policy if exists club_news_media_tournament_delete on storage.objects;

create policy club_news_media_tournament_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-news-media' and internal.may_manage_tournament_media(name));
create policy club_news_media_tournament_select on storage.objects for select to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_tournament_media(name));
create policy club_news_media_tournament_update on storage.objects for update to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_tournament_media(name))
  with check (bucket_id = 'club-news-media' and internal.may_manage_tournament_media(name));
create policy club_news_media_tournament_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-news-media' and internal.may_manage_tournament_media(name));

-- -----------------------------------------------------------------------------------------------------
-- 3. The one governed write.
--
-- Mirrors `set_venue_cover` exactly, including the three refusals that matter: both sources at once, an
-- uploaded path that was not uploaded for THIS tournament, and a stock key that is not one Ovalball
-- actually ships. The last is why the allow-list lives here and not only in the app: a client is free
-- to send any string, and a key with no asset behind it renders as the default while the row insists
-- somebody chose something.
-- -----------------------------------------------------------------------------------------------------

create or replace function public.set_tournament_cover(
  p_tournament_id uuid,
  p_storage_path text,
  p_stock_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;

  select host_club_id into v_club_id from public.tournaments where tournaments.id = p_tournament_id;
  if v_club_id is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;

  if not internal.can('tournament.tournament.manage', 'club', v_club_id, null, null) then
    raise exception 'You do not have permission to change this tournament''s photo.' using errcode = '42501';
  end if;

  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;

  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/tournament-' || p_tournament_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this tournament.' using errcode = '22023';
  end if;

  -- THE OVALBALL IMAGE LIBRARY, server side. Kept in step with
  -- `apps/mobile/src/tournaments/cover-library.ts`, which is keyed on these exact strings. Stable keys,
  -- never array positions, so reordering the picker cannot re-point existing rows at a different photo.
  if p_stock_key is not null and not (p_stock_key = any(array[
    'tournament-minis-festival-01',
    'tournament-festival-pitches-01',
    'tournament-match-action-01',
    'tournament-club-festival-day-01',
    'tournament-touchline-crowd-01',
    'tournament-posts-morning-01',
    'tournament-minis-tag-01',
    'tournament-trophy-table-01',
    'tournament-age-grade-festival-01',
    'tournament-setup-morning-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.tournaments
  set cover_image_path = p_storage_path,
      cover_stock_key = p_stock_key,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_tournament_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('tournaments', p_tournament_id, 'update', auth.uid(),
          jsonb_build_object('cover_image_path', p_storage_path, 'cover_stock_key', p_stock_key));
end;
$$;

revoke all on function public.set_tournament_cover(uuid, text, text) from public, anon;
grant execute on function public.set_tournament_cover(uuid, text, text) to authenticated;
grant execute on function public.set_tournament_cover(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------------------------------
-- 4. Choosing the photograph while creating the tournament.
--
-- The wizard offers the Ovalball Image Library on Basic Details, so the choice has to survive into the
-- one transactional create rather than becoming a second write that can fail on its own and leave a
-- tournament looking like every other one.
--
-- AN UPLOAD IS DELIBERATELY NOT A PARAMETER HERE. An uploaded cover's storage path contains the
-- tournament's id, which does not exist until this function returns -- so an upload chosen in the
-- wizard is uploaded and set immediately AFTER creation, through the same `set_tournament_cover` every
-- later change uses. Inventing a second path shape so the upload could happen first would give
-- tournaments two kinds of cover path and the storage policy two things to recognise.
-- -----------------------------------------------------------------------------------------------------

create or replace function public.create_tournament_with_teams(
  p_club_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_kickoff_time time without time zone,
  p_format text,
  p_visibility text,
  p_venue_id uuid,
  p_notes text,
  p_age_groups text[],
  p_our_team_ids uuid[],
  p_participants jsonb default '[]'::jsonb,
  p_swiss_rounds integer default null,
  p_cover_stock_key text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_directory uuid; v_code text; v_season uuid; v_grade text; v_team record; v_p jsonb;
  v_dir uuid; v_name text; v_team_id uuid; v_grade_p text; v_label text; v_type uuid;
  v_participant_club uuid; v_filled int; v_format text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to manage this club''s tournaments.' using errcode = '42501';
  end if;

  select c.directory_id, d.rugby_code into v_directory, v_code
  from public.clubs c join public.club_directory d on d.id = c.directory_id
  where c.id = p_club_id;
  if v_directory is null then
    raise exception 'That club could not be found.' using errcode = 'P0002';
  end if;

  v_format := coalesce(p_format, 'round_robin');

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'A tournament needs a start date.' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A tournament cannot end before it starts.' using errcode = '22023';
  end if;
  if v_format not in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid') then
    raise exception 'Unknown tournament format.' using errcode = '22023';
  end if;
  if coalesce(p_visibility, 'private') not in ('public', 'private') then
    raise exception 'Unknown tournament visibility.' using errcode = '22023';
  end if;
  if p_venue_id is null then
    raise exception 'A tournament needs a venue.' using errcode = '22023';
  end if;
  if p_age_groups is null or array_length(p_age_groups, 1) is null then
    raise exception 'A tournament needs at least one age group.' using errcode = '22023';
  end if;

  foreach v_grade in array p_age_groups loop
    select count(*) into v_filled from public.teams t
    where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[])) and t.age_group = v_grade;
    if v_filled = 0 then
      select count(*) into v_filled from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) e
      where e->>'age_group' = v_grade;
    end if;
    if v_filled = 0 then
      raise exception '% has no teams. Add at least one team to every age group.', v_grade using errcode = '22023';
    end if;
  end loop;

  -- A COVER CHOSEN IN THE WIZARD IS VALIDATED HERE TOO. `set_tournament_cover` is not on this path, so
  -- without this a create could plant a key with no asset behind it -- which renders as the default
  -- while the row insists somebody chose something.
  if p_cover_stock_key is not null and not (p_cover_stock_key = any(array[
    'tournament-minis-festival-01', 'tournament-festival-pitches-01', 'tournament-match-action-01',
    'tournament-club-festival-day-01', 'tournament-touchline-crowd-01', 'tournament-posts-morning-01',
    'tournament-minis-tag-01', 'tournament-trophy-table-01', 'tournament-age-grade-festival-01',
    'tournament-setup-morning-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  -- THE SEASON COMES FROM THE CANONICAL REGISTER. This function was written without it, so every
  -- tournament the mobile create wizard made was filed under no season at all -- invisible to any
  -- season-scoped view, and not something the organiser could see was missing. A gap in the register
  -- stays a null rather than becoming a month boundary invented here.
  select s.id into v_season from public.seasons s
  where s.rugby_code = v_code and p_starts_on between s.starts_on and s.ends_on
  order by s.starts_on desc limit 1;

  insert into public.tournaments (
    host_club_id, host_directory_id, name, event_date, ends_on, kickoff_time, rugby_code, season_id,
    venue_id, notes, format, visibility, swiss_rounds, cover_stock_key, status, created_by, updated_by
  ) values (
    p_club_id, v_directory, btrim(p_name), p_starts_on, coalesce(p_ends_on, p_starts_on), p_kickoff_time, v_code, v_season,
    p_venue_id, nullif(btrim(coalesce(p_notes, '')), ''), v_format, coalesce(p_visibility, 'private'),
    case when v_format = 'swiss' then coalesce(p_swiss_rounds, 4) else null end,
    p_cover_stock_key,
    'confirmed', auth.uid(), auth.uid()
  )
  returning id into v_id;

  insert into public.tournament_age_groups (tournament_id, age_group, created_by)
  select v_id, ag, auth.uid() from unnest(p_age_groups) as ag
  on conflict (tournament_id, age_group) do nothing;

  for v_team in select t.id, t.club_id, t.age_group from public.teams t where t.id = any(coalesce(p_our_team_ids, '{}'::uuid[]))
  loop
    if v_team.club_id <> p_club_id then
      raise exception 'A team that is not this club''s cannot be entered as one of its own.' using errcode = '22023';
    end if;
    if v_team.age_group is not null and not (v_team.age_group = any(p_age_groups)) then
      raise exception 'A team was entered at an age group this tournament does not run.' using errcode = '22023';
    end if;
    insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by)
    values (v_id, v_team.id, v_team.club_id, auth.uid())
    on conflict (tournament_id, team_id) do nothing;
  end loop;

  for v_p in select * from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    v_dir := nullif(v_p->>'directory_id', '')::uuid;
    v_name := nullif(btrim(coalesce(v_p->>'club_name', '')), '');
    v_team_id := nullif(v_p->>'team_id', '')::uuid;
    v_grade_p := nullif(btrim(coalesce(v_p->>'age_group', '')), '');
    v_label := nullif(btrim(coalesce(v_p->>'squad_label', '')), '');

    if v_grade_p is null or not (v_grade_p = any(p_age_groups)) then
      raise exception 'A team was added at an age group this tournament does not run.' using errcode = '22023';
    end if;

    if v_dir is null then
      if v_name is null then
        raise exception 'An external club needs a name.' using errcode = '22023';
      end if;
      select id into v_dir from public.club_directory
      where lower(btrim(name)) = lower(v_name) and rugby_code = v_code and active limit 1;
      if v_dir is null then
        insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key, created_by)
        values (v_name, v_code, 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry',
                'tme-' || substr(md5(lower(v_name) || v_code), 1, 16), auth.uid())
        returning id into v_dir;
      end if;
    end if;

    if v_dir = v_directory then
      raise exception 'The host club is entered through its own teams, not as a participating club.' using errcode = '22023';
    end if;

    select c.id into v_participant_club from public.clubs c where c.directory_id = v_dir;

    v_type := null;
    if v_team_id is not null then
      select t.canonical_team_type_id, t.age_group into v_type, v_grade_p
      from public.teams t join public.clubs c on c.id = t.club_id
      where t.id = v_team_id and c.directory_id = v_dir;
      if not found then
        raise exception 'A team was added under a club it does not belong to.' using errcode = '22023';
      end if;
      v_label := null;
    end if;

    insert into public.tournament_participants (
      tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group,
      status, invited_by, invited_at
    ) values (
      v_id, v_dir, v_participant_club, v_team_id, v_type, v_label, v_grade_p,
      case when v_participant_club is null then 'external_recorded' else 'added' end,
      auth.uid(), now()
    )
    on conflict do nothing;
  end loop;

  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------------------------------
-- 5. The superseded signature.
--
-- `create or replace function` with a NEW TRAILING PARAMETER does not replace anything -- it creates a
-- second overload beside the first. Both then have defaults covering a 12-argument call, so every
-- existing positional caller breaks with:
--
--   function public.create_tournament_with_teams(uuid, unknown, date, …) is not unique
--
-- which is a failure of the whole function rather than of the new argument. The old signature is
-- therefore dropped explicitly, exactly as 20270599 dropped the one before it, and the grants are
-- restated against the signature that now exists.
-- -----------------------------------------------------------------------------------------------------

drop function if exists public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer);

revoke all on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text) from public, anon;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text) to authenticated;
grant execute on function public.create_tournament_with_teams(uuid, text, date, date, time without time zone, text, text, uuid, text, text[], uuid[], jsonb, integer, text) to service_role;
