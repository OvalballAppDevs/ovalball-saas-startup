-- Site Admin Seasons CRUD -- Master Architecture Pass reconciliation:
-- "Complete Site Admin Season CRUD: real Edit controls, safe Delete/
-- Archive/Deactivate with a full cross-reference audit... before allowing
-- hard delete, gated by a new narrow SITE-scoped capability (not blanket
-- is_site_admin())." Previously Seasons was create-only, gated by raw
-- is_site_admin() on the RLS write policies -- no Edit, no Archive, no
-- Delete, and no way for a Full Site Admin to delegate season management
-- narrowly the way Competitions/Lookups/Team Catalogue already can.

-- 1. The narrow per-person flag, following the exact existing pattern
-- (site_admins.manage_competitions / manage_global_lookups / ...).
alter table public.site_admins add column manage_seasons boolean not null default false;

-- 2. The capability itself, site-scoped only -- seasons are a single
-- global reference-data table, never club- or team-scoped.
insert into public.capabilities (key, label, category, applicable_scopes)
values ('site.seasons.manage', 'Manage seasons', 'site', array['site'])
on conflict (key) do nothing;

-- 3. Role-bundle wiring: a Full Site Admin always has it; a narrow Site
-- Admin only with the new flag set, matching every sibling site.* case.
create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when internal.is_full_site_admin() then true
    when p_capability_key = 'site.permissions.manage' then coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.lookups.manage' then coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.team_catalogue.manage' then coalesce((select manage_team_catalogue from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.competitions.manage' then coalesce((select manage_competitions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.fixture_support.manage' then coalesce((select manage_fixture_support from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.diagnostic.access' then coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.seasons.manage' then coalesce((select manage_seasons from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    else internal.is_site_admin()
  end;
$$;

-- 4. Grant/revoke RPC for a Full Site Admin to delegate this flag,
-- mirroring set_site_admin_competitions_capability exactly.
create or replace function public.set_site_admin_seasons_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke Seasons management access.' using errcode = '42501';
  end if;

  update public.site_admins
  set manage_seasons = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_seasons_access_changed',
    case when p_enabled then 'Seasons management access granted' else 'Seasons management access revoked' end,
    case
      when p_enabled then 'You can now edit, archive, and delete seasons from Site Admin Seasons.'
      else 'Your Seasons management access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

-- 5. Re-point the existing RLS write policies at the new capability
-- (insert stays available to any account able to create a season; update
-- likewise) -- was blanket internal.is_site_admin(), now specifically
-- gated, matching the central-mutation-capabilities pattern the rest of
-- this pass already established. Both policies keep their existing name
-- and command so no policy-drop/dependent-grant churn is needed.
drop policy if exists seasons_write_admin on public.seasons;
create policy seasons_write_admin on public.seasons
  for insert
  with check (internal.has_capability('site.seasons.manage', 'site'));

drop policy if exists seasons_update_admin on public.seasons;
create policy seasons_update_admin on public.seasons
  for update
  using (internal.has_capability('site.seasons.manage', 'site'));

-- 6. archive_season(): the safe "delete" for any season that already has
-- real downstream references -- flips `active` off, edits nothing else.
-- No DELETE RLS policy exists on seasons (never did), so hard delete is
-- reachable ONLY through delete_season_safe() below, never a raw client
-- DELETE.
create or replace function public.archive_season(p_season_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.has_capability('site.seasons.manage', 'site') then
    raise exception 'Not authorized to manage seasons.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.seasons where id = p_season_id) then
    raise exception 'Season not found.';
  end if;
  update public.seasons set active = p_active, updated_by = auth.uid() where id = p_season_id;
end;
$$;

-- 7. delete_season_safe(): hard delete, permitted only when NOTHING
-- references this season across every real FK (competition_editions,
-- fixtures, tournaments, age_grade_rollovers.from/to) -- audited fresh on
-- every call, never trusting a client-side "I checked already" claim.
-- Raises a specific, itemised error naming exactly what still references
-- the season when blocked, so the caller can direct the Site Admin to
-- Archive instead.
create or replace function public.delete_season_safe(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_competition_editions int;
  v_fixtures int;
  v_tournaments int;
  v_rollovers_from int;
  v_rollovers_to int;
  v_blockers text[] := array[]::text[];
begin
  if not internal.has_capability('site.seasons.manage', 'site') then
    raise exception 'Not authorized to manage seasons.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.seasons where id = p_season_id) then
    raise exception 'Season not found.';
  end if;

  select count(*) into v_competition_editions from public.competition_editions where season_id = p_season_id;
  select count(*) into v_fixtures from public.fixtures where season_id = p_season_id;
  select count(*) into v_tournaments from public.tournaments where season_id = p_season_id;
  select count(*) into v_rollovers_from from public.age_grade_rollovers where from_season_id = p_season_id;
  select count(*) into v_rollovers_to from public.age_grade_rollovers where to_season_id = p_season_id;

  if v_competition_editions > 0 then v_blockers := v_blockers || format('%s competition edition(s)', v_competition_editions); end if;
  if v_fixtures > 0 then v_blockers := v_blockers || format('%s fixture(s)', v_fixtures); end if;
  if v_tournaments > 0 then v_blockers := v_blockers || format('%s tournament(s)', v_tournaments); end if;
  if v_rollovers_from > 0 then v_blockers := v_blockers || format('%s rollover(s) FROM this season', v_rollovers_from); end if;
  if v_rollovers_to > 0 then v_blockers := v_blockers || format('%s rollover(s) TO this season', v_rollovers_to); end if;

  if array_length(v_blockers, 1) > 0 then
    raise exception 'Cannot delete: this season is still referenced by %. Archive it instead.', array_to_string(v_blockers, ', ');
  end if;

  delete from public.seasons where id = p_season_id;
end;
$$;
