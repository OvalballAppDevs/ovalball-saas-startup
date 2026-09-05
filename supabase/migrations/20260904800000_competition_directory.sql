-- Competition Directory: a controlled, capability-gated Site Admin
-- mechanism to manage the GLOBAL competition catalogue (`competitions`),
-- which already existed (20260830143505...sql) but had no management UI,
-- no capability gate, no geography model, and no duplicate protection.
-- competitions -> competition_editions -> fixtures.competition_edition_id
-- was already correctly layered (one enduring competition, many per-
-- season editions) -- this migration extends the TOP layer only, mirroring
-- 20260904500000_site_admin_team_directory.sql's exact pattern for the
-- same reason: a narrow, audited, per-person Site Admin capability, never
-- a hard delete, never a free-text scope field.

-- ============================================================
-- 1. Geography reference table. No county/region model existed anywhere
--    in the schema before this. Seeded from the REAL, already-loaded
--    club_directory.county values (distinct nation/county pairs actually
--    present in the real 1385-club dataset) rather than an invented list,
--    so competition area selection lines up exactly with real club
--    locations. Two obviously-synthetic local test values present in the
--    live query ("Nowhereshire", "Testshire" -- test-fixture artifacts,
--    not real UK/ROI places) are deliberately excluded from this
--    permanent seed data. Republic of Ireland has zero club_directory
--    rows today (nation check constraint below didn't even allow it) but
--    the brief explicitly requires ROI support, so it's seeded with a
--    standard real county list ahead of any ROI club actually existing.
-- ============================================================

create table public.geographic_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nation text not null check (nation in ('England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland')),
  sort_order integer not null,
  unique (nation, name)
);

comment on table public.geographic_areas is
  'Canonical UK+ROI counties/areas a Competition can be scoped to (competition_areas join table below). Seeded once from real club_directory.county values -- never a comma-separated string, never admin-freeform.';

-- club_directory.nation predates Republic of Ireland support -- widen it
-- to the same 5-nation vocabulary this table now uses, since a
-- competition's geography should be able to reference the same nation set
-- the club directory itself uses (no ROI clubs exist locally yet, but the
-- constraint must not block one being added).
alter table public.club_directory drop constraint club_directory_nation_check;
alter table public.club_directory add constraint club_directory_nation_check
  check (nation in ('England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland'));

insert into public.geographic_areas (name, nation, sort_order) values
  ('Bedfordshire', 'England', 1), ('Berkshire', 'England', 2), ('Bristol', 'England', 3),
  ('Buckinghamshire', 'England', 4), ('Cambridgeshire', 'England', 5), ('Cheshire', 'England', 6),
  ('Cornwall', 'England', 7), ('County Durham', 'England', 8), ('Cumbria', 'England', 9),
  ('Derbyshire', 'England', 10), ('Devon', 'England', 11), ('Dorset', 'England', 12),
  ('East Riding of Yorkshire', 'England', 13), ('East Sussex', 'England', 14), ('Essex', 'England', 15),
  ('Gloucestershire', 'England', 16), ('Greater London', 'England', 17), ('Greater Manchester', 'England', 18),
  ('Hampshire', 'England', 19), ('Herefordshire', 'England', 20), ('Hertfordshire', 'England', 21),
  ('Isle of Wight', 'England', 22), ('Kent', 'England', 23), ('Lancashire', 'England', 24),
  ('Leicestershire', 'England', 25), ('Lincolnshire', 'England', 26), ('Merseyside', 'England', 27),
  ('Norfolk', 'England', 28), ('North Yorkshire', 'England', 29), ('Northamptonshire', 'England', 30),
  ('Northumberland', 'England', 31), ('Nottinghamshire', 'England', 32), ('Oxfordshire', 'England', 33),
  ('Rutland', 'England', 34), ('Shropshire', 'England', 35), ('Somerset', 'England', 36),
  ('South Gloucestershire', 'England', 37), ('South Yorkshire', 'England', 38), ('Staffordshire', 'England', 39),
  ('Suffolk', 'England', 40), ('Surrey', 'England', 41), ('Tyne and Wear', 'England', 42),
  ('Warwickshire', 'England', 43), ('West Midlands', 'England', 44), ('West Sussex', 'England', 45),
  ('West Yorkshire', 'England', 46), ('Wiltshire', 'England', 47), ('Worcestershire', 'England', 48),
  ('Belfast', 'Northern Ireland', 1), ('County Antrim', 'Northern Ireland', 2), ('County Armagh', 'Northern Ireland', 3),
  ('County Down', 'Northern Ireland', 4), ('County Londonderry', 'Northern Ireland', 5), ('County Tyrone', 'Northern Ireland', 6),
  ('Aberdeen City', 'Scotland', 1), ('Aberdeenshire', 'Scotland', 2), ('Angus', 'Scotland', 3),
  ('Argyll & Bute', 'Scotland', 4), ('Clackmannanshire', 'Scotland', 5), ('Dumfries & Galloway', 'Scotland', 6),
  ('Dundee City', 'Scotland', 7), ('East Ayrshire', 'Scotland', 8), ('East Dunbartonshire', 'Scotland', 9),
  ('East Lothian', 'Scotland', 10), ('East Renfrewshire', 'Scotland', 11), ('Edinburgh City', 'Scotland', 12),
  ('Falkirk', 'Scotland', 13), ('Fife', 'Scotland', 14), ('Glasgow City', 'Scotland', 15),
  ('Highland', 'Scotland', 16), ('Inverclyde', 'Scotland', 17), ('Midlothian', 'Scotland', 18),
  ('Moray', 'Scotland', 19), ('North Ayrshire', 'Scotland', 20), ('North Lanarkshire', 'Scotland', 21),
  ('Perth & Kinross', 'Scotland', 22), ('Renfrewshire', 'Scotland', 23), ('Scottish Borders', 'Scotland', 24),
  ('South Ayrshire', 'Scotland', 25), ('South Lanarkshire', 'Scotland', 26), ('Stirling', 'Scotland', 27),
  ('West Dunbartonshire', 'Scotland', 28), ('West Lothian', 'Scotland', 29),
  ('Cardiff', 'Wales', 1), ('Carmarthenshire', 'Wales', 2), ('Conwy', 'Wales', 3),
  ('Gwent', 'Wales', 4), ('Swansea', 'Wales', 5), ('Wrexham', 'Wales', 6),
  ('Dublin', 'Republic of Ireland', 1), ('Cork', 'Republic of Ireland', 2), ('Galway', 'Republic of Ireland', 3),
  ('Limerick', 'Republic of Ireland', 4), ('Waterford', 'Republic of Ireland', 5), ('Kilkenny', 'Republic of Ireland', 6),
  ('Wexford', 'Republic of Ireland', 7), ('Cavan', 'Republic of Ireland', 8), ('Sligo', 'Republic of Ireland', 9);

alter table public.geographic_areas enable row level security;
create policy geographic_areas_select_all on public.geographic_areas for select to anon, authenticated using (true);

-- ============================================================
-- 2. Competitions gains lifecycle-consistent scope fields:
--    description (metadata only, never logic), is_national. Area scope
--    lives in the join table below, never a comma-separated string.
-- ============================================================

alter table public.competitions
  add column description text,
  add column is_national boolean not null default false;

comment on column public.competitions.is_national is
  'A competition is either national OR scoped to specific geographic_areas (competition_areas below), never both -- enforced by trigger, not just UI, matching this session''s "the constraint answers IS THIS VALID" principle. Existing rows default false (area-scoped/unset), never guessed into national.';

create table public.competition_areas (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  area_id uuid not null references public.geographic_areas(id),
  primary key (competition_id, area_id)
);

comment on table public.competition_areas is
  'Many-to-many: a competition may span multiple counties/areas. Never populated for an is_national=true competition (see competition_areas_national_guard below).';

create index competition_areas_area_id_idx on public.competition_areas (area_id);

alter table public.competition_areas enable row level security;
create policy competition_areas_select_all on public.competition_areas for select to anon, authenticated using (true);

create or replace function internal.guard_competition_area_scope() returns trigger
language plpgsql
as $$
declare
  v_is_national boolean;
begin
  if tg_table_name = 'competition_areas' then
    select is_national into v_is_national from public.competitions where id = new.competition_id;
    if v_is_national then
      raise exception 'This competition is marked National -- it cannot also have specific county/area scope. Turn off National first.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- tg_table_name = 'competitions', firing on is_national flipping to true.
  if new.is_national and exists (select 1 from public.competition_areas where competition_id = new.id) then
    raise exception 'This competition already has specific county/area scope -- remove those areas before marking it National.' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function internal.guard_competition_area_scope is
  'Cross-table invariant a plain CHECK constraint cannot express: is_national and competition_areas rows are mutually exclusive, checked from both directions so neither write order can create the ambiguous "National + specific counties" combination the brief explicitly warns against.';

create trigger competition_areas_national_guard
  before insert on public.competition_areas
  for each row execute function internal.guard_competition_area_scope();

create trigger competitions_national_guard
  before update of is_national on public.competitions
  for each row when (new.is_national = true) execute function internal.guard_competition_area_scope();

-- ============================================================
-- 3. Rugby-code compatibility, defense in depth. Two of the three
--    checkpoints this domain needs already existed as real BEFORE
--    triggers (not just RPC-layer checks) before this migration --
--    verified by reading 20260830143512_rls_policies_and_triggers.sql
--    directly, not assumed: enforce_competition_edition_rugby_code
--    (competition_editions.rugby_code vs its own competitions.rugby_code)
--    and enforce_edition_team_rugby_code (competition_edition_teams vs
--    the edition). Only the THIRD checkpoint -- fixtures.
--    competition_edition_id vs the owning team's own rugby_code -- had
--    exclusively an RPC-layer check (update_fixture_competition), no
--    trigger. That's the one genuine gap; added below.
-- ============================================================

create or replace function internal.validate_fixture_competition_rugby_code() returns trigger
language plpgsql
as $$
declare
  v_team_rugby_code text;
  v_edition_rugby_code text;
begin
  if new.competition_edition_id is null then
    return new;
  end if;
  select rugby_code into v_team_rugby_code from public.teams where id = new.owning_team_id;
  select rugby_code into v_edition_rugby_code from public.competition_editions where id = new.competition_edition_id;
  if v_edition_rugby_code is not null and v_team_rugby_code is not null and v_edition_rugby_code <> v_team_rugby_code then
    raise exception 'That competition (%) is for a different rugby code than this fixture (%).', v_edition_rugby_code, v_team_rugby_code using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists fixtures_competition_rugby_code_check on public.fixtures;
create trigger fixtures_competition_rugby_code_check
  before insert or update of competition_edition_id, owning_team_id on public.fixtures
  for each row execute function internal.validate_fixture_competition_rugby_code();

-- ============================================================
-- 4. manage_competitions capability -- exactly the diagnostic_club_access
--    / manage_team_catalogue template: off by default for every Site
--    Admin including Full, granted/revoked per-person only.
-- ============================================================

alter table public.site_admins
  add column manage_competitions boolean not null default false;

comment on column public.site_admins.manage_competitions is
  'Whether this specific Site Admin has been granted the capability to create/edit/deactivate global competitions. Granted/revoked only via set_site_admin_competitions_capability, never a direct table write from the app layer.';

create or replace function public.set_site_admin_competitions_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke Competition management access.' using errcode = '42501';
  end if;

  update public.site_admins
  set manage_competitions = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_competitions_access_changed',
    case when p_enabled then 'Competition management access granted' else 'Competition management access revoked' end,
    case
      when p_enabled then 'You can now add and deactivate global competitions from Competition Management.'
      else 'Your Competition management access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

revoke execute on function public.set_site_admin_competitions_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_competitions_capability(uuid, boolean) to authenticated;

create or replace function internal.can_manage_competitions()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.site_admins sa
    where sa.user_id = auth.uid() and sa.status = 'active' and sa.manage_competitions
  );
$$;

comment on function internal.can_manage_competitions is
  'A genuine Site Admin product-level capability: Club Admin/Fixtures Secretary select from the Competition Directory, they never create or edit it. Mirrors internal.can_manage_team_catalogue exactly.';

-- ============================================================
-- 5. Competition CRUD RPCs. Never a hard delete. Duplicate protection via
--    a real unique index on normalized name + rugby_code (case/whitespace
--    insensitive), not just an RPC-side check, so no write path can
--    create "Lancashire Cup" and "lancashire  cup" as two rows.
-- ============================================================

create unique index competitions_normalized_name_code_idx
  on public.competitions (rugby_code, regexp_replace(lower(trim(name)), '\s+', ' ', 'g'));

create or replace function public.create_competition(
  p_name text, p_description text, p_rugby_code text, p_is_national boolean, p_area_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if p_is_national and coalesce(array_length(p_area_ids, 1), 0) > 0 then
    raise exception 'A National competition cannot also have specific county/area scope. Turn off National, or clear the selected areas.' using errcode = '23514';
  end if;
  if not p_is_national and coalesce(array_length(p_area_ids, 1), 0) = 0 then
    raise exception 'Select at least one county/area, or mark this competition National.';
  end if;

  -- slug/normalized_key are globally unique (predates rugby_code scoping
  -- -- see 20260830143505...sql), so the SAME name under a different
  -- rugby code needs its own distinct slug/key; the real duplicate-
  -- prevention boundary is competitions_normalized_name_code_idx
  -- (rugby_code + normalized name), not either of these columns.
  v_normalized := trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || p_rugby_code;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || p_rugby_code;

  begin
    insert into public.competitions (name, slug, normalized_key, rugby_code, description, is_national, active, created_by, updated_by)
    values (trim(p_name), v_slug, v_normalized, p_rugby_code, nullif(trim(coalesce(p_description, '')), ''), p_is_national, true, auth.uid(), auth.uid())
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', p_rugby_code, trim(p_name) using errcode = 'P0001';
  end;

  foreach v_area_id in array p_area_ids loop
    insert into public.competition_areas (competition_id, area_id) values (v_new_id, v_area_id)
    on conflict do nothing;
  end loop;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('competitions', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('name', trim(p_name), 'rugby_code', p_rugby_code, 'is_national', p_is_national, 'area_ids', p_area_ids));

  return v_new_id;
end;
$$;

revoke execute on function public.create_competition(text, text, text, boolean, uuid[]) from public;
grant execute on function public.create_competition(text, text, text, boolean, uuid[]) to authenticated;

comment on function public.create_competition is
  'Site Admin (manage_competitions capability) only. Duplicate names for the same rugby code are rejected by competitions_normalized_name_code_idx, not just an RPC-side check.';

create or replace function public.update_competition(
  p_id uuid, p_name text, p_description text, p_is_national boolean, p_area_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.competitions;
  v_area_id uuid;
begin
  if not internal.can_manage_competitions() then
    raise exception 'Only a Site Admin with Competition management access may edit a global competition.' using errcode = '42501';
  end if;

  select * into v_before from public.competitions where id = p_id for update;
  if not found then raise exception 'Competition not found.'; end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'A competition name is required.';
  end if;
  if p_is_national and coalesce(array_length(p_area_ids, 1), 0) > 0 then
    raise exception 'A National competition cannot also have specific county/area scope. Turn off National, or clear the selected areas.' using errcode = '23514';
  end if;
  if not p_is_national and coalesce(array_length(p_area_ids, 1), 0) = 0 then
    raise exception 'Select at least one county/area, or mark this competition National.';
  end if;

  begin
    update public.competitions
    set name = trim(p_name),
        normalized_key = trim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')) || ' ' || v_before.rugby_code,
        slug = trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')) || '-' || v_before.rugby_code,
        description = nullif(trim(coalesce(p_description, '')), ''),
        is_national = p_is_national,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_id;
  exception
    when unique_violation then
      raise exception 'A % competition named "%" already exists.', v_before.rugby_code, trim(p_name) using errcode = 'P0001';
  end;

  delete from public.competition_areas where competition_id = p_id;
  foreach v_area_id in array p_area_ids loop
    insert into public.competition_areas (competition_id, area_id) values (p_id, v_area_id)
    on conflict do nothing;
  end loop;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('competitions', p_id, 'update', auth.uid(),
    jsonb_build_object('name', v_before.name, 'is_national', v_before.is_national),
    jsonb_build_object('name', trim(p_name), 'is_national', p_is_national, 'area_ids', p_area_ids));
end;
$$;

revoke execute on function public.update_competition(uuid, text, text, boolean, uuid[]) from public;
grant execute on function public.update_competition(uuid, text, text, boolean, uuid[]) to authenticated;

create or replace function public.deactivate_competition(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.competitions;
begin
  if not internal.can_manage_competitions() then
    raise exception 'Only a Site Admin with Competition management access may deactivate a competition.' using errcode = '42501';
  end if;

  select * into v_before from public.competitions where id = p_id for update;
  if not found then raise exception 'Competition not found.'; end if;
  if not v_before.active then raise exception 'This competition is already deactivated.'; end if;

  update public.competitions set active = false, updated_by = auth.uid(), updated_at = now() where id = p_id;
  update public.competition_editions set active = false, updated_by = auth.uid(), updated_at = now() where competition_id = p_id and active = true;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('competitions', p_id, 'deactivate', auth.uid(), jsonb_build_object('active', true), jsonb_build_object('active', false, 'name', v_before.name));
end;
$$;

revoke execute on function public.deactivate_competition(uuid) from public;
grant execute on function public.deactivate_competition(uuid) to authenticated;

comment on function public.deactivate_competition is
  '"Deactivate", never "Delete" -- a fixture''s existing competition_edition_id (and therefore competition_id) reference is completely untouched; deactivating cascades to that competition''s own editions (so new fixture selection cannot pick a stale edition of a dead competition) but never touches fixtures.competition_edition_id itself, so historical fixtures keep displaying it correctly.';

-- ============================================================
-- 6. RLS: competitions already had blanket-Site-Admin write policies
--    (competitions_write_admin/competitions_update_admin, using
--    public.is_site_admin() -- ANY Site Admin profile, from the original
--    schema). Replace both with the narrow manage_competitions capability
--    check, matching this migration's whole "not just any Site Admin
--    profile" requirement -- the RPCs above are SECURITY DEFINER and
--    bypass RLS themselves, so this closes the direct-table-write gap for
--    any caller that skips them. competitions_select_active/
--    competitions_select_admin (read side) are untouched.
--    competition_editions' own write policies are intentionally left
--    exactly as they were -- out of scope for this migration, which is
--    the Competition Directory (competitions) layer only.
-- ============================================================

drop policy if exists competitions_write_admin on public.competitions;
drop policy if exists competitions_update_admin on public.competitions;
create policy competitions_write_admin on public.competitions for insert
  with check (internal.can_manage_competitions());
create policy competitions_update_admin on public.competitions for update
  using (internal.can_manage_competitions());

create policy competition_areas_write_admin on public.competition_areas for all
  using (internal.can_manage_competitions())
  with check (internal.can_manage_competitions());
