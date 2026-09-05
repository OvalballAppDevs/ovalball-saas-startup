-- Club Pitch / Playing Area management. Normalizes fixtures.pitch_allocation
-- (free text, forever) into a real per-club list with stable identity --
-- see update_fixture_pitch below, which now resolves against this table
-- while never destroying existing free-text data (Section 6's own "no
-- guessing" requirement).
create table public.club_pitches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  display_name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index club_pitches_club_id_display_name_key on public.club_pitches (club_id, lower(display_name));
create index club_pitches_club_id_idx on public.club_pitches (club_id);

alter table public.club_pitches enable row level security;

-- Read: anyone who can see the club at all (matches clubs_select's own
-- shape -- pitch NAMES are not sensitive, and an opponent club needs to
-- see them to make sense of "Pitch 2" in a fixture, same as they already
-- see pitch_allocation free text today).
create policy club_pitches_select on public.club_pitches
  for select using (true);

create policy club_pitches_insert on public.club_pitches
  for insert with check (internal.can_manage_club_fixtures(club_id));
create policy club_pitches_update on public.club_pitches
  for update using (internal.can_manage_club_fixtures(club_id));
-- No delete policy -- archiving (active=false) is the only removal path,
-- matching "do not hard-delete a pitch that has historical fixture
-- references" (a pitch with zero fixture references could in principle be
-- hard-deleted, but there is no product need to -- archive covers every
-- case cleanly and keeps the audit trail simple).

create trigger set_updated_at before update on public.club_pitches
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update on public.club_pitches
  for each row execute function internal.audit_row_change();

comment on table public.club_pitches is 'Stable, named pitches/playing areas per club -- replaces ad-hoc free text for HOME fixture pitch selection. See fixtures.pitch_id (new) and pitch_allocation (legacy free text, preserved).';

-- fixtures.pitch_id: the new stable reference. pitch_allocation (existing
-- free text) is kept untouched -- both can coexist; pitch_id is null until
-- a fixture is explicitly re-pointed at a real club_pitches row (by an
-- exact-match migration below, or by a fresh selection going forward).
alter table public.fixtures add column pitch_id uuid references public.club_pitches(id);

comment on column public.fixtures.pitch_id is 'Stable reference into club_pitches, set via update_fixture_pitch(). Null means "not yet resolved to a named pitch" -- pitch_allocation (free text) may still hold a legacy value in that case; see the one-time migration in this same file for how existing exact matches were resolved.';

-- One-time, conservative migration of EXISTING fixtures.pitch_allocation
-- free text: for each club, seed a club_pitches row for every DISTINCT
-- non-empty pitch_allocation value already in use on that club's own
-- fixtures (via owning_team_id -> teams.club_id), then resolve every
-- fixture whose free-text value matches EXACTLY (case-insensitive) to the
-- new stable id. Nothing is guessed, nothing is merged across clubs, and
-- the original free-text column is never touched -- this is purely
-- additive.
do $$
declare
  r record;
  v_pitch_id uuid;
begin
  for r in
    select distinct t.club_id, f.pitch_allocation
    from public.fixtures f
    join public.teams t on t.id = f.owning_team_id
    where f.pitch_allocation is not null and trim(f.pitch_allocation) <> ''
  loop
    insert into public.club_pitches (club_id, display_name, sort_order)
    values (r.club_id, trim(r.pitch_allocation), 0)
    on conflict (club_id, lower(display_name)) do nothing;

    select id into v_pitch_id from public.club_pitches
    where club_id = r.club_id and lower(display_name) = lower(trim(r.pitch_allocation));

    update public.fixtures f
    set pitch_id = v_pitch_id
    from public.teams t
    where t.id = f.owning_team_id
      and t.club_id = r.club_id
      and lower(trim(f.pitch_allocation)) = lower(trim(r.pitch_allocation))
      and f.pitch_id is null;
  end loop;
end $$;

-- ============================================================
-- Pitch management RPCs -- create / rename / reorder / archive /
-- reactivate. All authorization via can_manage_club_fixtures(), all
-- changes captured by the generic audit_row_change trigger already
-- attached above (created/renamed/archived/reactivated are all just
-- INSERT/UPDATE rows on club_pitches, which the trigger already logs with
-- full before/after state -- no separate bespoke audit table needed).
-- ============================================================

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
  if not internal.can_manage_club_fixtures(p_club_id) then
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
  if not internal.can_manage_club_fixtures(v_club_id) then
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
  if not internal.can_manage_club_fixtures(p_club_id) then
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
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  update public.club_pitches set active = p_active, updated_by = auth.uid() where id = p_pitch_id;
end;
$$;

-- Replaces the old 2-arg update_fixture_pitch(uuid, text) with a single
-- 3-arg signature -- one entry point, not two competing ones. Every
-- existing call site (result-actions.ts, result-admin-actions.ts) is
-- updated in the same change to call the new signature.
drop function if exists public.update_fixture_pitch(uuid, text);

-- update_fixture_pitch: now resolves to a stable club_pitches row when
-- p_pitch_id is given (the normal path going forward), while keeping the
-- exact same free-text path alive for TBC/unassigned (Section 5 -- "do
-- not force a fake pitch row" for "not yet allocated") and for a genuinely
-- club-external raw value (an away club's own venue note, an admin
-- override) that isn't one of the home club's named pitches.
create or replace function public.update_fixture_pitch(p_fixture_id uuid, p_pitch_id uuid default null, p_pitch_text text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.fixtures;
  v_old_pitch text;
  v_old_pitch_id uuid;
  v_new_pitch_text text;
  v_home_club_id uuid;
begin
  if not (internal.can_submit_fixture_result(p_fixture_id) or internal.is_site_admin()) then
    raise exception 'You are not authorized to set the pitch for this fixture.' using errcode = '42501';
  end if;

  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  v_old_pitch := f.pitch_allocation;
  v_old_pitch_id := f.pitch_id;

  if p_pitch_id is not null then
    -- A named pitch may only be selected for a HOME fixture, and only
    -- from the HOME club's own pitches -- an away club can never assign
    -- one of its own pitches to the other club's home fixture (Section 4).
    if f.home_away <> 'Home' then
      raise exception 'A named pitch can only be set on a home fixture.';
    end if;
    select t.club_id into v_home_club_id from public.teams t where t.id = f.owning_team_id;
    if not exists (select 1 from public.club_pitches cp where cp.id = p_pitch_id and cp.club_id = v_home_club_id and cp.active) then
      raise exception 'That pitch does not belong to this fixture''s home club, or is archived.';
    end if;
    select display_name into v_new_pitch_text from public.club_pitches where id = p_pitch_id;
  else
    v_new_pitch_text := nullif(trim(p_pitch_text), '');
  end if;

  update public.fixtures set pitch_id = p_pitch_id, pitch_allocation = v_new_pitch_text where id = p_fixture_id;

  if (coalesce(v_old_pitch, '') <> coalesce(v_new_pitch_text, '') or v_old_pitch_id is distinct from p_pitch_id) and f.opponent_team_id is not null then
    perform internal.fixture_result_system_event(p_fixture_id, auth.uid(),
      case when v_new_pitch_text is null then 'Pitch allocation removed.'
           else format('Pitch allocated: %s', v_new_pitch_text) end);
    if auth.uid() is not null then
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Fixture updated',
        case when v_new_pitch_text is null then 'The pitch allocation for your fixture has been removed.'
             else format('The pitch for your fixture has been set to %s.', v_new_pitch_text) end);
    end if;
  end if;
end;
$$;
