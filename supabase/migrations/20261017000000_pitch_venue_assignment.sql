-- Pitch -> venue assignment: putting an unvalidated write behind a
-- validated one, and letting a pitch be created already attached.
--
-- `club_pitches.venue_id` was added in 20260913000000 and is READ as
-- canonical in several places -- training plan validation
-- (20261011010000), manual session reconciliation (20261011020000) and
-- session editing (20261011060000) all reject a pitch whose venue_id does
-- not match the chosen venue. The club setup requirements added in
-- 20261016000000 read it too.
--
-- Two defects:
--
-- V-1 (integrity). Assignment happened through a direct
--     `update public.club_pitches set venue_id = ...` from the app. The
--     club_pitches_update policy checks `club.pitches.manage` on the ROW's
--     club_id and, having no WITH CHECK of its own, re-uses that as the
--     check -- so the pitch cannot change clubs, but venue_id is
--     unconstrained. Verified on this database: a Burnley Club Admin
--     successfully attached a Burnley pitch to a Rossendale venue. RLS is
--     row-scoped and cannot express "this column must reference a row of
--     the same club", so the rule belongs in a function.
--
-- V-2 (ergonomics). `create_club_pitch` accepted no venue, so every pitch
--     was born detached and had to be attached in a second step. The first-
--     run setup flow creates a venue and its pitches together and should
--     not have to.
--
-- No backfill. On this database the 4 detached pitches all belong to clubs
-- with 3-5 active venues each, so there is no unambiguous answer, and
-- guessing one would put a fabricated location on a real pitch.

-- ---------------------------------------------------------------------
-- create_club_pitch -- now venue-aware
-- ---------------------------------------------------------------------

-- Dropped explicitly rather than replaced. Adding a defaulted 4th
-- parameter with `create or replace` would leave the 3-argument function in
-- place as a second overload, and every existing 3-argument call site would
-- then fail as ambiguous. One name, one function.
drop function if exists public.create_club_pitch(uuid, text, text);

create function public.create_club_pitch(
  p_club_id uuid,
  p_display_name text,
  p_description text default null,
  p_venue_id uuid default null
)
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

  -- A pitch belongs to a venue of ITS OWN club. Without this a caller could
  -- attach one club's pitch to another club's ground, which would then pass
  -- the training validation that reads this column.
  if p_venue_id is not null and not exists (
    select 1 from public.venues v
    where v.id = p_venue_id and v.club_id = p_club_id and v.active
  ) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.club_pitches where club_id = p_club_id;

  insert into public.club_pitches (club_id, display_name, description, venue_id, sort_order, created_by, updated_by)
  values (p_club_id, trim(p_display_name), nullif(trim(p_description), ''), p_venue_id, v_next_sort, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_club_pitch(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_club_pitch(uuid, text, text, uuid) to authenticated;

comment on function public.create_club_pitch is
  'Creates a pitch, optionally attached to one of the same club''s active venues. venue_id is read as canonical by training plan/session validation, so it is validated here rather than trusted.';

-- ---------------------------------------------------------------------
-- set_club_pitch_venue -- for pitches that already exist
-- ---------------------------------------------------------------------

create or replace function public.set_club_pitch_venue(p_pitch_id uuid, p_venue_id uuid)
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

  -- Null clears the attachment. That is a legitimate correction, not a
  -- deletion: the pitch keeps every fixture and session that referenced it.
  if p_venue_id is not null and not exists (
    select 1 from public.venues v
    where v.id = p_venue_id and v.club_id = v_club_id and v.active
  ) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;

  update public.club_pitches
  set venue_id = p_venue_id, updated_by = auth.uid()
  where id = p_pitch_id;
end;
$$;

revoke execute on function public.set_club_pitch_venue(uuid, uuid) from public, anon;
grant execute on function public.set_club_pitch_venue(uuid, uuid) to authenticated;

comment on function public.set_club_pitch_venue is
  'Moves an existing pitch to one of its own club''s active venues, or clears the attachment with null. Never a delete -- historical fixture and session references are untouched.';

-- ---------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_club_pitch';

  if v_count <> 1 then
    raise exception 'create_club_pitch must have exactly one signature, found %.', v_count;
  end if;
end;
$$;
