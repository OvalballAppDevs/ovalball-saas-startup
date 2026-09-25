-- CA-M11.2 GROUNDS & PITCHES CAPACITY CONFIGURATION.
--
-- The previous pass ("PITCH CAPACITY / AGE-GRADE / TRAINING ALLOCATION CORRECTION") built a
-- size-aware conflict engine, but left the club with no way to tell Ovalball what a physical pitch
-- actually is: club_pitches.size_category ('mini'|'reduced'|'full') and lane_count (a raw 1-4
-- headcount) were readable by the engine but writable by NOTHING in the product -- no RPC, no UI, on
-- either client. This migration replaces both with a genuine, club-facing configuration, and is the
-- schema the previous pass's own migration-proposal document explicitly deferred.
--
-- TWO DISTINCT CONCEPTS, KEPT DISTINCT (the owner's own explicit instruction):
--   A. PHYSICAL PITCH SIZE  -- physical_size_category (+ custom dimensions). What the pitch IS.
--   B. SPLIT CAPACITY       -- layout. How the club has chosen to USE it concurrently.
-- A half-size pitch used whole is a DIFFERENT thing from a full-size pitch split into two halves,
-- even though both end up describing "half a full-size pitch's worth of room" for ONE reservation --
-- see footprint.ts's pitchCapacityUnits(), which is why physical_size_category and layout are two
-- independent columns rather than one collapsed field.
--
-- SIMPLE MODE, DELIBERATELY (owner's own Section 32 escape hatch). Three layouts only -- whole pitch,
-- two halves, four quarters -- not an arbitrary halves/thirds/quarters combination. The conflict
-- engine (packages/contracts/src/pitch-allocation/footprint.ts) reasons in quarter-pitch units; a
-- "thirds" layout does not divide evenly into that unit system, and offering a layout the engine
-- cannot correctly reason the capacity of would be exactly the "fake support for arbitrary geometry"
-- the owner explicitly ruled out. If thirds are ever genuinely needed, the unit system and this enum
-- both need to grow together, not one silently ahead of the other.
--
-- REPLACES size_category and lane_count OUTRIGHT rather than adding alongside them. Both were audited
-- (a dedicated read-only search of the whole repository, including every SQL function, RLS policy and
-- trigger body) and confirmed to have NO function/RPC/RLS/trigger consumer anywhere -- only the
-- TypeScript conflict engine and its own tests read them, and every one of those call sites is updated
-- in this same pass. Keeping the old columns alongside the new ones would be exactly the redundant,
-- confusable pair of "size" concepts the owner's brief explicitly warns against.

alter table public.club_pitches
  add column physical_size_category text not null default 'full'
    check (physical_size_category in ('full', 'three_quarter', 'half', 'custom')),
  add column custom_length_m numeric(5, 1),
  add column custom_width_m numeric(5, 1),
  add column layout text not null default 'full_only'
    check (layout in ('full_only', 'two_halves', 'four_quarters'));

-- Custom dimensions are required exactly when physical_size_category = 'custom', and meaningless
-- (must be null) otherwise -- Section 15's "custom selected with unusable dimensions" is a database
-- invariant, not just a form validation, so a direct RPC call with a bad combination is rejected the
-- same as a sloppy client would be.
alter table public.club_pitches
  add constraint club_pitches_custom_dimensions_check check (
    (physical_size_category = 'custom' and custom_length_m is not null and custom_width_m is not null and custom_length_m > 0 and custom_width_m > 0)
    or (physical_size_category <> 'custom' and custom_length_m is null and custom_width_m is null)
  );

comment on column public.club_pitches.physical_size_category is 'CA-M11.2 Grounds & Pitches: what this physical pitch IS -- full size, three-quarter size, half size, or a custom-dimensioned area. Defaults to full size (Section 3''s own instruction), which reproduces every pre-existing pitch''s current, unclassified behaviour exactly (see layout''s default below). Never conflated with fixture_scheduling_rules.min_pitch_size_category, which is a MATCH''s own age-grade-driven requirement, a completely different table and a completely different question.';
comment on column public.club_pitches.custom_length_m is 'Metres. Set only when physical_size_category = custom; null otherwise (enforced by club_pitches_custom_dimensions_check).';
comment on column public.club_pitches.custom_width_m is 'Metres. Set only when physical_size_category = custom; null otherwise (enforced by club_pitches_custom_dimensions_check).';
comment on column public.club_pitches.layout is 'CA-M11.2 Grounds & Pitches: how the club has chosen to USE this physical pitch concurrently -- full_only (default, one booking at a time, todays exactly-one-booking-at-a-time behaviour), two_halves or four_quarters. Independent of physical_size_category: a half-size pitch split into two_halves and a full-size pitch split into two_halves both give capacity 2, but at different footprint sizes per area (see footprint.ts). Drives lane_count below.';

-- lane_count becomes a GENERATED column derived from layout, so every existing TypeScript call site
-- that reads PitchOption.laneCount (the auto-allocator, the conflict sweep, both boards' lane
-- rendering) keeps working completely unchanged -- only WHERE the number comes from changes, never
-- its meaning or its consumers. The 1-4 range check is now structurally guaranteed by the enum
-- (full_only=1, two_halves=2, four_quarters=4), so club_pitches_lane_count_range is retired rather
-- than kept as a now-redundant belt-and-braces check.
alter table public.club_pitches drop constraint if exists club_pitches_lane_count_range;
alter table public.club_pitches drop column lane_count;
alter table public.club_pitches add column lane_count integer not null generated always as (
  case layout
    when 'full_only' then 1
    when 'two_halves' then 2
    when 'four_quarters' then 4
  end
) stored;

comment on column public.club_pitches.lane_count is 'GENERATED from layout (full_only=1, two_halves=2, four_quarters=4) -- CA-M11.2 Grounds & Pitches. Never written directly; set layout via set_club_pitch_configuration() instead.';

-- size_category retired outright -- see this file's own header comment for why it is not kept
-- alongside the new columns.
alter table public.club_pitches drop constraint if exists club_pitches_size_category_check;
alter table public.club_pitches drop column size_category;

-- ============================================================
-- set_club_pitch_configuration -- the ONE canonical write, both clients.
-- ============================================================
-- Authority: venue.pitch.manage (internal.can_manage_pitch), the CURRENT canonical capability for
-- pitch administration (Slice 4E, supabase/migrations/20270364000000_calendar_venue_training_
-- authority_canonical.sql) -- audited before writing this, and used deliberately instead of the
-- legacy internal.can_manage_club_fixtures() the OLDER sibling RPCs in this file's own table
-- (create_club_pitch, rename_club_pitch, etc.) still call. Those are left untouched -- migrating
-- already-working, unrelated RPCs to the newer helper is a separate, out-of-scope cleanup, not part
-- of this configuration feature -- but this NEW RPC uses the current, correct authority from the
-- start rather than inheriting a legacy borrow a later pass will only have to migrate again. Also
-- deliberately NOT venue.pitch_allocation.manage, which is the Pitch Allocation BOARD's own
-- scheduling-time authority (who may drag a fixture onto a pitch) -- a different job from who may
-- configure what a pitch physically is.
create or replace function public.set_club_pitch_configuration(
  p_pitch_id uuid,
  p_physical_size_category text,
  p_layout text,
  p_custom_length_m numeric default null,
  p_custom_width_m numeric default null
)
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
  if not internal.can_manage_pitch(v_club_id) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  if p_physical_size_category not in ('full', 'three_quarter', 'half', 'custom') then
    raise exception 'Not a recognised pitch size.';
  end if;
  if p_layout not in ('full_only', 'two_halves', 'four_quarters') then
    raise exception 'Not a recognised pitch layout.';
  end if;
  if p_physical_size_category = 'custom' and (p_custom_length_m is null or p_custom_width_m is null or p_custom_length_m <= 0 or p_custom_width_m <= 0) then
    raise exception 'Custom size needs a length and width in metres, both greater than zero.';
  end if;

  update public.club_pitches
  set physical_size_category = p_physical_size_category,
      layout = p_layout,
      custom_length_m = case when p_physical_size_category = 'custom' then p_custom_length_m else null end,
      custom_width_m = case when p_physical_size_category = 'custom' then p_custom_width_m else null end,
      updated_by = auth.uid()
  where id = p_pitch_id;
end;
$$;

comment on function public.set_club_pitch_configuration(uuid, text, text, numeric, numeric) is 'CA-M11.2 Grounds & Pitches: the one canonical write for a pitch''s physical size and split layout, both clients. Authority: venue.pitch.manage. Validates the enums and the custom-dimensions combination server-side -- never trusts client form validation alone (Section 15).';

-- The database's own default-privilege revocation (supabase/migrations/20270342000000_database_
-- api_perimeter.sql: "alter default privileges for role postgres revoke execute on functions from
-- public") applies to every function this migration creates, matching every sibling RPC in this same
-- table (create_club_pitch, rename_club_pitch, etc.) -- an explicit grant, never assumed.
grant execute on function public.set_club_pitch_configuration(uuid, text, text, numeric, numeric) to authenticated;
grant execute on function public.set_club_pitch_configuration(uuid, text, text, numeric, numeric) to service_role;
