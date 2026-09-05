-- Site Admin Lookup Administration: a genuine parent view over club-level
-- managed lookups (Venues, Pitches today; the architecture is deliberately
-- generic so future managed lookups slot in the same way). Reads/writes
-- the SAME public.venues/public.club_pitches rows Club Admin's own
-- Lookup Administration (/club/venues) already manages -- never a
-- duplicate global copy.
--
-- Tightens a real gap found while building this: create_venue/update_venue/
-- set_venue_active/set_default_venue (20260913000000) currently authorise
-- the Site Admin branch with a blanket internal.is_site_admin() check --
-- every Site Admin profile, including a narrow/limited one, can already
-- write to ANY club's venues today. Every other Site Admin capability this
-- session (diagnostic_club_access, manage_team_catalogue,
-- manage_competitions, manage_fixture_support) is a narrow, explicit,
-- per-person grant, off by default even for a Full Site Admin. Venues
-- never got that treatment. This migration brings it into line.
--
-- ============================================================
-- MANAGED BUSINESS LOOKUP vs CONTROLLED SYSTEM ENUM/DOMAIN RULE
-- ============================================================
-- Before adding anything to Lookup Administration, classify it:
--
-- (A) MANAGED BUSINESS LOOKUP -- a club or Ovalball genuinely configures
--     this data, it has no bearing on security or fixture-domain
--     invariants, and different real-world answers are all equally valid.
--     Belongs in Lookup Administration, editable through an RPC with an
--     explicit capability check, never a raw client insert.
--       - Venues (per-club) -- this migration
--       - Pitches (per-club, already existed) -- this migration
--       - Competitions (global) -- already its own rich operational page
--         (/admin/competitions), canonical data still conceptually part
--         of this same "managed lookup" family; not moved here, its
--         workflow is richer than a plain CRUD list warrants.
--
-- (B) CONTROLLED SYSTEM ENUM / DOMAIN RULE -- code-defined, and making it
--     editable would let someone reconfigure a security boundary or break
--     an invariant the rest of the fixture domain relies on. Stays a
--     `check` constraint / closed catalogue / permission table, never a
--     freeform Lookup Administration row.
--       - permissions / capabilities / permission_groups
--       - user roles (CLUB_ADMIN / FIXTURE_SECRETARY / COACH / ... )
--       - fixture/request/tournament lifecycle states (sent/accepted/
--         rejected/pending/etc.) -- these drive real workflow branches
--         elsewhere in the app; editing the SET of states is a schema
--         change, not a config change
--       - canonical_team_types (the closed Team Directory catalogue --
--         deliberately admin-creatable only via its OWN dedicated,
--         audited Site Admin Team Directory flow, not a generic lookup
--         list, per that slice's own hard-invariant design)
--       - rugby_code ('union'|'league') -- core domain vocabulary
--         referenced by structural CHECK constraints throughout
--
-- Document new lookups here as they're added so this distinction doesn't
-- have to be re-derived from scratch next time.

alter table public.site_admins
  add column manage_global_lookups boolean not null default false;

comment on column public.site_admins.manage_global_lookups is
  'Narrow, explicit, per-person grant (off by default even for Full) mirroring manage_team_catalogue/manage_competitions/manage_fixture_support -- lets this Site Admin add/edit/deactivate ANY club''s venues and pitches from the Site Admin Lookup Administration parent view. Without it, a Site Admin can still SELECT every club''s venues/pitches (matches the existing open, non-sensitive venues_select/club_pitches_select policies) but cannot write.';

create or replace function internal.can_manage_global_lookups()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false);
$$;

create or replace function public.set_site_admin_global_lookups_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can grant or revoke lookup-management access.' using errcode = '42501';
  end if;
  update public.site_admins set manage_global_lookups = p_enabled where user_id = p_user_id;
  if not found then raise exception 'Site Admin not found.'; end if;
end;
$$;

revoke execute on function public.set_site_admin_global_lookups_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_global_lookups_capability(uuid, boolean) to authenticated;

-- Tighten the venue RPCs' Site Admin branch: was a blanket
-- internal.is_site_admin(), now the narrow capability. Club Admin's own
-- authority over their own club (internal.is_club_admin(club_id)) is
-- completely unchanged -- this only narrows the SITE ADMIN side.

create or replace function public.create_venue(
  p_club_id uuid, p_name text, p_address text, p_postcode text, p_directions text, p_set_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_id uuid;
begin
  if not (internal.can_manage_global_lookups() or internal.is_club_admin(p_club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'A venue name is required.';
  end if;
  if exists (select 1 from public.venues where club_id = p_club_id and lower(name) = lower(v_name)) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  if p_set_default then
    update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = p_club_id and is_default_home;
  end if;

  insert into public.venues (name, slug, club_id, address, postcode, directions, is_default_home, active, created_by, updated_by)
  values (
    v_name,
    trim(both '-' from regexp_replace(lower(v_name || '-' || substr(p_club_id::text, 1, 8)), '[^a-z0-9]+', '-', 'g')),
    p_club_id, nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_postcode, '')), ''), nullif(trim(coalesce(p_directions, '')), ''),
    coalesce(p_set_default, false), true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_venue(
  p_id uuid, p_name text, p_address text, p_postcode text, p_directions text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues;
  v_name text := trim(p_name);
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_global_lookups() or internal.is_club_admin(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'A venue name is required.'; end if;
  if exists (select 1 from public.venues where club_id = v_venue.club_id and lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'This club already has a venue named "%".', v_name using errcode = 'P0001';
  end if;

  update public.venues
  set name = v_name,
      address = nullif(trim(coalesce(p_address, '')), ''),
      postcode = nullif(trim(coalesce(p_postcode, '')), ''),
      directions = nullif(trim(coalesce(p_directions, '')), ''),
      updated_by = auth.uid()
  where id = p_id;
end;
$$;

create or replace function public.set_venue_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_global_lookups() or internal.is_club_admin(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  update public.venues set active = p_active, updated_by = auth.uid() where id = p_id;
end;
$$;

create or replace function public.set_default_venue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_id for update;
  if not found then raise exception 'Venue not found.'; end if;
  if v_venue.club_id is null or not (internal.can_manage_global_lookups() or internal.is_club_admin(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if not v_venue.active then raise exception 'An inactive venue cannot be the default -- reactivate it first.'; end if;

  update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = v_venue.club_id and is_default_home and id <> p_id;
  update public.venues set is_default_home = true, updated_by = auth.uid() where id = p_id;
end;
$$;

-- Pitch write authority: club_pitches has always used can_manage_club_fixtures
-- (Club Admin OR Fixtures Secretary at that club) for its OWN club, with no
-- Site Admin path at all (confirmed in 20260901180000_club_pitches.sql) --
-- add the same new capability as an alternate authority, for the same
-- reason as venues above. Raw client writes to club_pitches (only
-- setClubPitchVenue in app/(app)/club/actions.ts uses one) go through RLS,
-- so that route is covered by the policy widening below.
drop policy if exists club_pitches_insert on public.club_pitches;
create policy club_pitches_insert on public.club_pitches
  for insert with check (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(club_id));

drop policy if exists club_pitches_update on public.club_pitches;
create policy club_pitches_update on public.club_pitches
  for update using (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(club_id));
-- No delete policy, by design (see 20260901180000's own comment) --
-- archiving (active=false) via the update policy above is the only
-- removal path. Not adding one here.

-- The four pitch RPCs (create_club_pitch/rename_club_pitch/
-- reorder_club_pitches/set_club_pitch_active) are SECURITY DEFINER and so
-- bypass RLS entirely -- widening the policies above has no effect on them.
-- They are the only path the Club Admin venues UI (VenuesSection, reused
-- verbatim for the Site Admin parent view) uses for creating/renaming/
-- reordering/archiving a pitch, so each needs the same capability added
-- directly.
create or replace function public.create_club_pitch(p_club_id uuid, p_display_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_next_sort integer;
begin
  if not (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(p_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'A pitch name is required.';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.club_pitches where club_id = p_club_id;

  insert into public.club_pitches (club_id, display_name, description, sort_order, created_by, updated_by)
  values (p_club_id, trim(p_display_name), nullif(trim(p_description), ''), v_next_sort, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.rename_club_pitch(p_pitch_id uuid, p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;
  if coalesce(trim(p_new_name), '') = '' then
    raise exception 'A pitch name is required.';
  end if;

  update public.club_pitches set display_name = trim(p_new_name), updated_by = auth.uid() where id = p_pitch_id;
end;
$$;

create or replace function public.reorder_club_pitches(p_club_id uuid, p_pitch_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_idx integer := 0;
begin
  if not (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(p_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  foreach v_id in array p_pitch_ids loop
    update public.club_pitches set sort_order = v_idx, updated_by = auth.uid()
    where id = v_id and club_id = p_club_id;
    v_idx := v_idx + 1;
  end loop;
end;
$$;

create or replace function public.set_club_pitch_active(p_pitch_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_global_lookups() or internal.can_manage_club_fixtures(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  update public.club_pitches set active = p_active, updated_by = auth.uid() where id = p_pitch_id;
end;
$$;
