-- Venue Lookup Administration. Revives the original scaffold's largely-
-- dormant public.venues table (id, name, slug, club_id, address,
-- latitude, longitude, active -- see 20260830143505_competitions_seasons_
-- venues.sql) into a first-class entity, rather than inventing a second,
-- competing location model: fixtures.venue_id has existed since that same
-- original migration and every admin_fixture_overview revision since has
-- already left-joined venues in (currently only exposing venue_name) --
-- nothing has ever WRITTEN to it. club_pitches (20260901180000) is what's
-- actually in live use today with no venue concept at all. This migration
-- adds what venues is missing (postcode, directions, a per-club default
-- flag), gives club_pitches a real venue_id so Pitch genuinely belongs to
-- Venue, and is the first migration to ever let a fixture's venue_id be
-- set through a real write path.

alter table public.venues
  add column postcode text,
  add column directions text,
  add column is_default_home boolean not null default false;

comment on column public.venues.is_default_home is
  'At most one true per club_id (see venues_one_default_per_club below). The venue that HOME fixture creation defaults to -- always deliberately overridable, never a hard lock (Section 6 of the venue instruction: "HOME fixture does NOT mean Venue is permanently locked to home ground").';

-- One default per club, enforced at the database boundary -- never two
-- venues silently both claiming to be "the" default, and never relying on
-- application code alone to keep this true.
create unique index venues_one_default_per_club on public.venues (club_id) where is_default_home and club_id is not null;

-- Pitch belongs to Venue (Section 4): nullable so existing club_pitches
-- rows -- which have never had a venue concept -- remain valid, historical
-- data rather than being forced into a guessed venue. A pitch created
-- through the new Lookup Administration UI going forward is always
-- attached to a real venue; a legacy unattached pitch is not an error
-- state, just something a Club Admin can optionally tidy up later.
alter table public.club_pitches add column venue_id uuid references public.venues(id);
create index club_pitches_venue_id_idx on public.club_pitches (venue_id);

-- Prevent obvious accidental duplicate venue names per club (Section 9),
-- the same case-insensitive-per-club pattern club_pitches' own unique
-- index already uses. A genuinely different venue that happens to share a
-- name with another club's venue is unaffected -- this is scoped per club,
-- like club_pitches.
create unique index venues_club_id_name_key on public.venues (club_id, lower(name)) where club_id is not null;

alter table public.venues enable row level security;

-- Replace the original scaffold's policies (venues_select_active/
-- venues_select_admin/venues_write_admin/venues_update_admin -- the last
-- two Site-Admin-only, never usable by a Club Admin) with the real
-- Lookup Administration boundary.
drop policy if exists venues_select_active on public.venues;
drop policy if exists venues_select_admin on public.venues;
drop policy if exists venues_write_admin on public.venues;
drop policy if exists venues_update_admin on public.venues;
drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues
  for select using (true);
-- Same non-sensitive-read rationale as club_pitches_select: an opponent
-- club needs to see "Burnley RUFC Ground, BB11 1AA" to make sense of a
-- fixture, and an unclaimed/neutral venue has no owning club to protect
-- anyway (club_id is nullable for exactly that case).

drop policy if exists venues_insert on public.venues;
create policy venues_insert on public.venues
  for insert with check (club_id is not null and (internal.is_site_admin() or internal.is_club_admin(club_id)));

drop policy if exists venues_update on public.venues;
create policy venues_update on public.venues
  for update using (club_id is not null and (internal.is_site_admin() or internal.is_club_admin(club_id)));
-- No delete policy -- deactivate (active=false) only, matching
-- club_pitches' own "never hard-delete, historical fixtures may
-- reference it" rule (Section 7).

-- Venue is deliberately a CLUB-STRUCTURAL action, gated the same way
-- team creation/reactivation already is (Central Fixture Participant
-- Resolution) -- Club Admin or Site Admin only. A Fixtures Secretary can
-- SELECT (read) venues freely for fixture creation (the open
-- venues_select policy above already allows this to any authenticated
-- context that can see the club) but does not gain create/edit authority
-- merely from can_manage_club_fixtures the way club_pitches' own writes
-- currently do -- this is a deliberately NARROWER, new boundary for
-- venues specifically, not a retroactive tightening of club_pitches'
-- existing (unchanged, still-tested) write policy.

-- set_updated_at / audit_row_change triggers on venues already exist
-- from the original scaffold (20260830143512_rls_policies_and_triggers.sql)
-- -- not recreated here.

-- ============================================================
-- public.create_venue: the one path that creates a club venue. Handles
-- the default-flag flip atomically (never two defaults momentarily
-- visible, never a race between "unset old default" and "insert new
-- default" -- both happen in the same transaction this function runs in).
-- ============================================================
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
  if not (internal.is_site_admin() or internal.is_club_admin(p_club_id)) then
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

revoke execute on function public.create_venue(uuid, text, text, text, text, boolean) from public;
grant execute on function public.create_venue(uuid, text, text, text, text, boolean) to authenticated;

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
  if v_venue.club_id is null or not (internal.is_site_admin() or internal.is_club_admin(v_venue.club_id)) then
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

revoke execute on function public.update_venue(uuid, text, text, text, text) from public;
grant execute on function public.update_venue(uuid, text, text, text, text) to authenticated;

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
  if v_venue.club_id is null or not (internal.is_site_admin() or internal.is_club_admin(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  update public.venues set active = p_active, updated_by = auth.uid() where id = p_id;
end;
$$;

revoke execute on function public.set_venue_active(uuid, boolean) from public;
grant execute on function public.set_venue_active(uuid, boolean) to authenticated;

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
  if v_venue.club_id is null or not (internal.is_site_admin() or internal.is_club_admin(v_venue.club_id)) then
    raise exception 'Not authorised to manage this club''s venues.' using errcode = '42501';
  end if;
  if not v_venue.active then raise exception 'An inactive venue cannot be the default -- reactivate it first.'; end if;

  update public.venues set is_default_home = false, updated_by = auth.uid() where club_id = v_venue.club_id and is_default_home and id <> p_id;
  update public.venues set is_default_home = true, updated_by = auth.uid() where id = p_id;
end;
$$;

revoke execute on function public.set_default_venue(uuid) from public;
grant execute on function public.set_default_venue(uuid) to authenticated;

-- Assigning an existing pitch to a venue (or moving it) is a normal
-- pitch-level write, so it stays under club_pitches' own existing
-- can_manage_club_fixtures policy -- a Fixtures Secretary can already
-- create/rename pitches today, and choosing which venue a pitch belongs
-- to is the same class of operational action, not a new structural
-- authority. A plain UPDATE through the existing club_pitches_update RLS
-- policy already covers this; no new RPC needed.

-- ============================================================
-- Expose venue detail on the fixture read model. admin_fixture_overview
-- already left-joins venues (every revision since 20260831250000) but
-- only ever selected v.name; this adds the rest of the structured fields
-- the UI needs (address/postcode for a "Directions" link, is_default_home
-- is deliberately NOT exposed here -- it's a per-club config concern, not
-- a per-fixture one) plus the pitch's own venue linkage for the
-- Venue > Pitch compact rendering the Site Admin table needs.
-- ============================================================
-- Exact copy of the real, current view (20260911000000_central_fixture_
-- participant_resolution.sql) with only venue_address/venue_postcode/
-- pitch_venue_id added, and the venue join widened to fall back to the
-- pitch's own venue when the fixture has no explicit venue_id of its own
-- -- every other column/join/case-expression is byte-identical to avoid
-- any risk of silently changing existing, tested behaviour.
create or replace view public.admin_fixture_overview
  with (security_invoker = true) as
select
  f.id,
  f.kickoff_date,
  f.kickoff_time,
  f.home_away,
  f.status,
  f.game_type,
  f.source,
  f.import_batch_id,
  f.replaces_fixture_id,
  f.raw_opposition_text,
  f.opponent_directory_id,
  f.opponent_team_id,
  f.season_label,
  f.notes,
  f.cancelled_at,
  f.cancellation_reason,
  f.created_at,
  f.updated_at,
  t.id as owning_team_id,
  t.display_name as owning_team_name,
  t.rugby_code,
  t.category as owning_team_category,
  c.id as owning_club_id,
  cd.id as owning_directory_id,
  cd.name as owning_club_name,
  opp_cd.name as opponent_club_name,
  opp_t.display_name as opponent_team_name,
  comp.name as competition_name,
  v.name as venue_name,
  (select count(*) from public.fixture_messages fm where fm.fixture_id = f.id) as message_count,
  c.logo_storage_path as owning_club_logo_path,
  opp_c.id as opponent_club_id,
  opp_c.logo_storage_path as opponent_club_logo_path,
  f.pitch_allocation,
  f.home_score,
  f.away_score,
  f.result_status,
  f.result_submitted_at,
  f.result_confirmed_at,
  f.result_amendment_proposed_home_score,
  f.result_amendment_proposed_away_score,
  f.competition_edition_id,
  f.pitch_id,
  f.season_id,
  case when f.home_away = 'Away' then coalesce(opp_cd.name, f.raw_opposition_text) else cd.name end as home_club_name,
  case when f.home_away = 'Away' then opp_t.display_name else t.display_name end as home_team_name,
  case when f.home_away = 'Away' then cd.name else coalesce(opp_cd.name, f.raw_opposition_text) end as away_club_name,
  case when f.home_away = 'Away' then t.display_name else opp_t.display_name end as away_team_name,
  case when f.home_away = 'Away' then opp_t.category else t.category end as home_team_category,
  case when f.home_away = 'Away' then opp_t.age_group else t.age_group end as home_team_age_group,
  case when f.home_away = 'Away' then opp_t.gender else t.gender end as home_team_gender,
  case when f.home_away = 'Away' then opp_t.squad_designation else t.squad_designation end as home_team_squad_designation,
  case when f.home_away = 'Away' then t.category else opp_t.category end as away_team_category,
  case when f.home_away = 'Away' then t.age_group else opp_t.age_group end as away_team_age_group,
  case when f.home_away = 'Away' then t.gender else opp_t.gender end as away_team_gender,
  case when f.home_away = 'Away' then t.squad_designation else opp_t.squad_designation end as away_team_squad_designation,
  opp_t.category as opponent_team_category,
  opp_t.age_group as opponent_team_age_group,
  opp_t.gender as opponent_team_gender,
  opp_t.squad_designation as opponent_team_squad_designation,
  opp_t.rugby_code as opponent_team_rugby_code,
  f.home_team_id,
  f.away_team_id,
  case when f.home_away = 'Away' then f.opponent_directory_id else cd.id end as home_club_directory_id,
  case when f.home_away = 'Away' then cd.id else f.opponent_directory_id end as away_club_directory_id,
  s.name as season_canonical_name,
  cp.display_name as pitch_name,
  f.mirror_fixture_id,
  (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id) as is_primary_mirror,
  case when f.home_away = 'Away' then (opp_cd.id is not null) else true end as home_club_resolved,
  case when f.home_away = 'Away' then true else (opp_cd.id is not null) end as away_club_resolved,
  v.address as venue_address,
  v.postcode as venue_postcode,
  cp.venue_id as pitch_venue_id
from public.fixtures f
join public.teams t on t.id = f.owning_team_id
join public.clubs c on c.id = t.club_id
join public.club_directory cd on cd.id = c.directory_id
left join public.club_directory opp_cd on opp_cd.id = f.opponent_directory_id
left join public.teams opp_t on opp_t.id = f.opponent_team_id
left join public.clubs opp_c on opp_c.id = opp_t.club_id
left join public.competition_editions ce on ce.id = f.competition_edition_id
left join public.competitions comp on comp.id = ce.competition_id
left join public.club_pitches cp on cp.id = f.pitch_id
left join public.venues v on v.id = coalesce(f.venue_id, cp.venue_id)
left join public.seasons s on s.id = f.season_id;

comment on view public.admin_fixture_overview is
  'The Master Fixture Registry''s Site Admin read model -- ONE row per real fixture. venue_name/venue_address/venue_postcode resolve from either an explicit fixtures.venue_id or (falling back to) the venue the fixture''s own pitch belongs to (pitch_venue_id) -- never two independently-drifting venue strings. home_club_resolved/away_club_resolved distinguish a genuinely resolved canonical club (or the owning side, always resolved) from a fallback to raw_opposition_text -- the UI must render an unresolved side distinctly (e.g. "Unresolved opponent:"), never as if it were a real club name. home_club_name/home_team_name/away_club_name/away_team_name are a display fallback for unresolved opponents; home_team_category/age_group/gender/squad_designation (and the away_ equivalents) are the structured fields the app runs through fullTeamLabel (lib/teams/compact-label.ts) to render the true canonical name whenever a real team is resolved -- never the raw, sometimes-stale teams.display_name. season_canonical_name/pitch_name are the human-readable companions to season_id/pitch_id for CSV export; home_team_id/away_team_id/home_club_directory_id/away_club_directory_id are the stable ids the same export round-trips on. mirror_fixture_id/is_primary_mirror are set only on legacy pre-consolidation mirror-pair fixtures.';
