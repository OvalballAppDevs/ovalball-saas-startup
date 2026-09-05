-- Makes the closed team catalogue a real database invariant for every
-- ACTIVE/current operational team, not just a UI restriction backed by an
-- RLS policy on one insert path. RLS answers WHO may write; this
-- migration answers whether the resulting row is a VALID team identity --
-- a different responsibility, enforced the same way for every writer
-- (Club Admin UI, claim/signup seeding, rollover, controlled missing-team
-- creation, any future RPC, and a direct authenticated insert), because
-- CHECK constraints and triggers -- unlike RLS -- are never bypassed by
-- role, including the `postgres` role the SQL test suite itself connects
-- as.
--
-- Explicit distinction, per instruction: a LEGACY/historical row (does
-- not match the closed catalogue) is never deleted and never force-
-- normalized into a different identity -- but it can only ever exist
-- while `active = false`. There is no "NULL canonical_team_type_id on an
-- active row" loophole: the constraints below make that combination
-- impossible to write, for anyone.

-- ============================================================
-- 0. Every existing ACTIVE row must already satisfy the invariant before
--    it can be added, or the migration itself would fail to apply. Real
--    data was inspected first (not assumed): after fixing the SQL test
--    fixtures that produced the only 3 genuinely out-of-catalogue rows
--    (`Men's 4th` -> `Men's 3rd`, `Girls U8`/`Girls U9` -> `Girls U12`,
--    since the closed catalogue's Girls band starts at U12 and senior
--    stops at 3rd), zero active rows should be affected by this
--    defensive backfill in the normal case -- it exists to make any
--    future drift self-healing (deactivate, don't crash the migration)
--    rather than to paper over expected data.
-- ============================================================

update public.teams
set active = false
where active = true and canonical_team_type_id is null;

update public.teams
set active = false
where active = true and category = 'youth' and squad_designation is not null and squad_designation not in ('B', 'C');

update public.teams
set active = false
where active = true and category = 'colts' and squad_designation is not null;

-- ============================================================
-- 1. ACTIVE requires a real canonical identity.
-- ============================================================

alter table public.teams add constraint teams_active_requires_canonical_type
  check (active = false or canonical_team_type_id is not null);

comment on constraint teams_active_requires_canonical_type on public.teams is
  'A team cannot be active/operational without resolving to one of the 24 closed canonical_team_types rows. A legacy/unmapped row (canonical_team_type_id null) may only exist while inactive -- preserved for history, permanently ineligible for new operational use.';

-- ============================================================
-- 2. Whatever canonical_team_type_id IS set must genuinely match the
--    row's own structured fields -- prevents the contradictory-data case
--    (canonical type = U12 but age_group = U13) even from a direct
--    UPDATE of canonical_team_type_id alone, which the auto-resolve
--    trigger (scoped to category/age_group/gender/squad_designation
--    changes) would not itself re-validate.
-- ============================================================

alter table public.teams add constraint teams_canonical_type_matches_fields
  check (canonical_team_type_id is null or canonical_team_type_id = internal.resolve_canonical_team_type(category, age_group, gender, squad_designation));

comment on constraint teams_canonical_type_matches_fields on public.teams is
  'canonical_team_type_id, whenever set, must be exactly what internal.resolve_canonical_team_type would compute from this row''s own category/age_group/gender/squad_designation -- makes a contradictory pairing (e.g. type=U12 with age_group=U13) impossible to write, not just unlikely.';

-- ============================================================
-- 3. Squad designation itself is closed for active teams: youth allows
--    only the primary (null) or B/C; colts allows only the primary
--    (never a squad letter -- there is no "Junior Colts B"). Senior's
--    squad_designation validity (must be exactly one of the type's own
--    1st/2nd/3rd) is already fully covered by constraint 2 above, since
--    an invalid ordinal simply fails to resolve to any canonical type at
--    all.
-- ============================================================

alter table public.teams add constraint teams_active_squad_designation_valid
  check (
    active = false
    or (category = 'youth' and (squad_designation is null or squad_designation in ('B', 'C')))
    or (category = 'colts' and squad_designation is null)
    or category = 'senior'
  );

comment on constraint teams_active_squad_designation_valid on public.teams is
  'No "U12 A" as a distinct identity and no "U12 D" -- an active youth team''s squad_designation is exactly null (primary), "B", or "C". Colts never takes a squad letter at all.';

-- ============================================================
-- 4. B/C squads require their own primary to already be active -- a
--    cross-row rule, so it needs a trigger (a plain CHECK constraint
--    cannot see other rows). Fires for every insert/update regardless of
--    role, the same as every constraint above. The reverse direction is
--    covered too: a primary cannot be deactivated while a B/C sibling is
--    still active, so fold_team can never leave a squad orphaned without
--    its primary -- the Club Admin must fold the squads first, matching
--    the deactivation lifecycle's own "structural review" requirement.
--
--    Trigger name is deliberately alphabetically AFTER
--    teams_set_canonical_type_trigger ("s" < "v") -- Postgres fires
--    same-timing triggers in name order, so canonical_team_type_id is
--    always already resolved by the time this one reads it.
-- ============================================================

create or replace function internal.validate_team_squad_structure() returns trigger
language plpgsql
as $$
declare
  v_has_active_primary boolean;
  v_has_active_squad boolean;
begin
  if new.active and new.category = 'youth' and new.squad_designation in ('B', 'C') then
    select exists(
      select 1 from public.teams p
      where p.club_id = new.club_id
        and p.canonical_team_type_id = new.canonical_team_type_id
        and p.gender is not distinct from new.gender
        and p.squad_designation is null
        and p.active = true
        and p.id <> new.id
    ) into v_has_active_primary;
    if not v_has_active_primary then
      raise exception 'Cannot activate a % squad without an active primary team at this level.', new.squad_designation
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.active = true and new.active = false
     and old.category = 'youth' and old.squad_designation is null then
    select exists(
      select 1 from public.teams s
      where s.club_id = old.club_id
        and s.canonical_team_type_id = old.canonical_team_type_id
        and s.gender is not distinct from old.gender
        and s.squad_designation in ('B', 'C')
        and s.active = true
    ) into v_has_active_squad;
    if v_has_active_squad then
      raise exception 'Cannot deactivate the primary team while a B or C squad at this level is still active. Deactivate those first.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function internal.validate_team_squad_structure is
  'Cross-row structural integrity a plain CHECK constraint cannot express: an active B/C squad requires its primary to already be active, and a primary cannot deactivate out from under an active B/C squad. Fires for every writer, RLS-independent.';

drop trigger if exists teams_validate_squad_structure_trigger on public.teams;
create trigger teams_validate_squad_structure_trigger
  before insert or update of active, squad_designation, canonical_team_type_id, gender, club_id on public.teams
  for each row execute function internal.validate_team_squad_structure();
