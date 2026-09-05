-- Site Admin Team Directory: a controlled, capability-gated mechanism to
-- extend the GLOBAL canonical team catalogue (canonical_team_types),
-- distinct from ordinary club-level team activation. Two different
-- operations, never conflated:
--
--   (A) CREATE A GLOBAL CANONICAL TEAM TYPE -- Site Admin (with the
--       manage_team_catalogue capability) only. Adds a new row to the
--       closed catalogue itself. Does NOT create it for any club.
--   (B) ACTIVATE A TEAM FOR A CLUB -- Club Admin, via the existing Add
--       Team flow (app/(app)/teams/actions.ts's createTeam), completely
--       unchanged by this migration. Picks from whatever is in the
--       catalogue right now.
--
-- Normal users (Club Admin, Coach, Team Manager, Parent, Player, signup
-- claimant) still cannot invent teams -- they still pick only from
-- Site-Admin-approved canonical_team_types rows. This migration only
-- widens WHO can add to that closed set (a narrow, audited, capability-
-- gated Site Admin action), never who can pick from it.
--
-- Automatic propagation is a consequence of architecture, not a feature
-- built separately: every catalogue-driven consumer (lib/teams/catalog.ts,
-- and everything that imports it -- Add Team, claim/signup, controlled
-- missing-team resolution, and every RLS/RPC boundary that calls
-- internal.resolve_canonical_team_type) already reads canonical_team_types
-- as its one source of truth. A new row here is immediately valid
-- everywhere with zero code changes; only the read-time query (this
-- migration adds `is_active` filtering) changes.

-- ============================================================
-- 1. canonical_team_types gains a real, structured domain constraint
--    (mirrors teams_gender_category_check's actual product rule exactly,
--    so a Site Admin can never define an identity a real team could never
--    legally have anyway), plus lifecycle/audit columns. All 24 existing
--    seeded rows already satisfy this -- verified by construction, not
--    assumed (the migration itself will fail to apply otherwise).
-- ============================================================

alter table public.canonical_team_types
  add constraint canonical_team_types_structure_check
  check (
    (category = 'colts' and age_group in ('JuniorColts', 'SeniorColts') and gender is null and fixed_squad_designation is null and allows_squads = false)
    or (category = 'senior' and age_group is null and gender in ('mens', 'womens') and fixed_squad_designation is not null and allows_squads = false)
    or (category = 'youth' and age_group in ('U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18') and fixed_squad_designation is null and (
          gender in ('boys', 'girls')
          or (gender = 'mixed' and age_group in ('U6','U7','U8','U9','U10','U11'))
        ))
  );

comment on constraint canonical_team_types_structure_check on public.canonical_team_types is
  'The same real-world structural rule teams_gender_category_check already enforces on actual team rows, applied one layer up: a Site Admin can never define a global identity that would be invalid for a real team to hold (e.g. senior+girls, or youth+mixed above U11).';

alter table public.canonical_team_types
  add column is_active boolean not null default true,
  add column created_by uuid references auth.users(id),
  add column created_at timestamptz not null default now(),
  add column updated_by uuid references auth.users(id),
  add column updated_at timestamptz not null default now();

comment on column public.canonical_team_types.is_active is
  'A deactivated global type is never deleted (teams.canonical_team_type_id still references it -- existing club-team rows and their full history are completely unaffected) and can never be newly activated by any club going forward (see canonical_team_types_active_idx and teams_validate_canonical_type_active_trigger below), but disappears from every catalogue-driven picker (Add Team, claim/signup, and every other consumer of lib/teams/catalog.ts''s live-loaded groups).';

-- The 24 seed rows predate created_by/updated_by -- correctly NULL
-- (system-seeded, not created by any Site Admin action), never backfilled
-- to a fake actor.

-- ============================================================
-- 2. The manage_team_catalogue capability -- off by default for every
--    Site Admin, including Full -- must be explicitly granted per person,
--    exactly mirroring diagnostic_club_access
--    (20260903700000_site_admin_diagnostic_access.sql). Extending the
--    global product catalogue is at least as privileged an action as
--    diagnostic club viewing, and deserves the same narrow, audited,
--    per-person grant rather than being implied by any Site Admin
--    profile (including Full) on its own.
-- ============================================================

alter table public.site_admins
  add column manage_team_catalogue boolean not null default false;

comment on column public.site_admins.manage_team_catalogue is
  'Whether this specific Site Admin has been granted the capability to add or deactivate global canonical team types (see create_canonical_team_type / deactivate_canonical_team_type below). Granted/revoked only via set_site_admin_team_catalogue_capability, never a direct table write from the app layer.';

create or replace function public.set_site_admin_team_catalogue_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke Team Directory management access.' using errcode = '42501';
  end if;

  update public.site_admins
  set manage_team_catalogue = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_team_catalogue_access_changed',
    case when p_enabled then 'Team Directory management access granted' else 'Team Directory management access revoked' end,
    case
      when p_enabled then 'You can now add and deactivate global team types from the Team Directory.'
      else 'Your Team Directory management access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

revoke execute on function public.set_site_admin_team_catalogue_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_team_catalogue_capability(uuid, boolean) to authenticated;

create or replace function internal.can_manage_team_catalogue()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and exists (
    select 1 from public.site_admins sa
    where sa.user_id = auth.uid() and sa.status = 'active' and sa.manage_team_catalogue
  );
$$;

comment on function internal.can_manage_team_catalogue is
  'A genuine Site Admin product-level capability, not just any Site Admin profile: Club Admin, Coach, Team Manager, and a Site Admin without this specific grant (diagnostic-access-only or otherwise) are all rejected from global catalogue writes.';

-- ============================================================
-- 3. create_canonical_team_type -- structured fields only, never a
--    free-text name (the label is generated server-side from the
--    structured identity, exactly mirroring internal.
--    compute_team_display_name's own naming philosophy, never accepted
--    as a parameter). Rejects a duplicate identity (the pre-existing
--    canonical_team_types_identity_idx unique index does the real work;
--    this just gives it a clear message instead of a raw constraint
--    violation). Audited before/after, matching the create_missing_
--    target_team RPC's own established audit_log pattern.
-- ============================================================

create or replace function internal.compute_canonical_type_label(
  p_category text, p_age_group text, p_gender text, p_fixed_squad_designation text
) returns text
language sql
immutable
as $$
  select case
    when p_category = 'colts' then
      case when p_age_group = 'SeniorColts' then 'Senior Colts' else 'Junior Colts' end
    when p_category = 'senior' then
      (case when p_gender = 'womens' then 'Women''s' else 'Men''s' end) || ' ' || p_fixed_squad_designation || ' Team'
    else
      (case when p_gender = 'girls' then 'Girls ' else '' end) || p_age_group
  end
$$;

create or replace function public.create_canonical_team_type(
  p_category text, p_age_group text, p_gender text, p_fixed_squad_designation text default null, p_allows_squads boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_label text;
  v_new_id uuid;
  v_sort_order integer;
begin
  if not internal.can_manage_team_catalogue() then
    raise exception 'Only a Site Admin with Team Directory management access may add a global team type.' using errcode = '42501';
  end if;

  v_label := internal.compute_canonical_type_label(p_category, p_age_group, p_gender, p_fixed_squad_designation);
  v_key := trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'));

  select coalesce(max(sort_order), 0) + 1 into v_sort_order from public.canonical_team_types;

  begin
    insert into public.canonical_team_types
      (key, label, category, age_group, gender, fixed_squad_designation, allows_squads, sort_order, is_active, created_by, updated_by)
    values
      (v_key, v_label, p_category, p_age_group, p_gender, p_fixed_squad_designation, p_allows_squads, v_sort_order, true, auth.uid(), auth.uid())
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception 'This exact team identity (%) already exists in the Team Directory.', v_label using errcode = 'P0001';
  end;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('canonical_team_types', v_new_id, 'insert', auth.uid(),
    jsonb_build_object('key', v_key, 'label', v_label, 'category', p_category, 'age_group', p_age_group, 'gender', p_gender, 'fixed_squad_designation', p_fixed_squad_designation));

  return v_new_id;
end;
$$;

revoke execute on function public.create_canonical_team_type(text, text, text, text, boolean) from public;
grant execute on function public.create_canonical_team_type(text, text, text, text, boolean) to authenticated;

comment on function public.create_canonical_team_type is
  'Site Admin (manage_team_catalogue capability) only. CREATES A GLOBAL CANONICAL TEAM TYPE -- never activates it for any club (that remains the separate, existing Club Admin Add Team action). The structured fields are validated by canonical_team_types_structure_check; the label is always generated from them, never accepted as free text.';

-- ============================================================
-- 4. deactivate_canonical_team_type -- never a hard delete. Existing
--    club-team rows keep their canonical_team_type_id FK and full
--    history untouched; the type simply disappears from every
--    catalogue-driven picker and can never be newly activated (enforced
--    at the database level below, section 5 -- never a UI-only filter).
-- ============================================================

create or replace function public.deactivate_canonical_team_type(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.canonical_team_types;
begin
  if not internal.can_manage_team_catalogue() then
    raise exception 'Only a Site Admin with Team Directory management access may deactivate a global team type.' using errcode = '42501';
  end if;

  select * into v_before from public.canonical_team_types where id = p_id for update;
  if not found then
    raise exception 'Team type not found.';
  end if;
  if not v_before.is_active then
    raise exception 'This team type is already deactivated.';
  end if;

  update public.canonical_team_types set is_active = false, updated_by = auth.uid(), updated_at = now() where id = p_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('canonical_team_types', p_id, 'deactivate', auth.uid(),
    jsonb_build_object('is_active', true), jsonb_build_object('is_active', false, 'label', v_before.label));
end;
$$;

revoke execute on function public.deactivate_canonical_team_type(uuid) from public;
grant execute on function public.deactivate_canonical_team_type(uuid) to authenticated;

comment on function public.deactivate_canonical_team_type is
  '"Deactivate Team Type", never "Delete" -- once referenced (and even before), a global type is never hard-deleted. Existing club-team rows and their history remain completely intact; new activation is blocked at the database level (teams_validate_canonical_type_active_trigger), not merely hidden from pickers.';

-- ============================================================
-- 5. A deactivated global type can never be newly activated by any club
--    -- a real database invariant, not UI filtering, matching this
--    session's whole "RLS/UI answers WHO, the constraint answers IS THIS
--    VALID" correction. Deliberately scoped to INSERT only (a genuinely
--    NEW team row): an EXISTING team that already resolved to this type
--    before it was deactivated keeps working completely normally --
--    rollover, reactivation, everything -- because "existing club-team/
--    history remains intact" is the explicit requirement. Only a brand
--    new activation is blocked.
-- ============================================================

create or replace function internal.validate_canonical_type_active_on_create() returns trigger
language plpgsql
as $$
begin
  if new.active and new.canonical_team_type_id is not null then
    if not exists (select 1 from public.canonical_team_types where id = new.canonical_team_type_id and is_active) then
      raise exception 'This team type has been deactivated by a Site Admin and can no longer be newly activated.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function internal.validate_canonical_type_active_on_create is
  'INSERT-only guard: a genuinely new team row can never activate a since-deactivated global type. Fires after teams_set_canonical_type_trigger (alphabetically "s" < "v", same as teams_validate_squad_structure_trigger) so canonical_team_type_id is already resolved when this reads it.';

drop trigger if exists teams_validate_canonical_type_active_trigger on public.teams;
create trigger teams_validate_canonical_type_active_trigger
  before insert on public.teams
  for each row execute function internal.validate_canonical_type_active_on_create();

-- ============================================================
-- 6. Automatic propagation, closing the last hardcoded duplicate: internal.
--    seed_teams_from_proposal (20260904100000_locked_team_naming.sql) had
--    its OWN hand-written VALUES table of the same 24 label -> structured-
--    field mappings, a THIRD copy alongside lib/teams/catalog.ts and this
--    table itself -- that migration's own comment admitted "there is no
--    single artifact both could read". A Site-Admin-added type would have
--    silently failed to seed from a claim's proposed_teams without this
--    fix, even though every other write path already picks it up for
--    free. Replaced with a live lookup against canonical_team_types:
--    senior/colts labels already match canonical_team_types.label exactly
--    ("Men's 1st Team", "Junior Colts"); youth labels use the signup
--    picker's own "Under N[ Girls]" phrasing (catalog.ts's TeamCategory
--    Option.label), which canonical_team_types.label does not store (it
--    stores the compact form, "U12"/"Girls U12") -- computed generically
--    from age_group/gender instead of a second hardcoded age list, so a
--    newly added youth age_group (e.g. U17) resolves with zero further
--    code changes here.
-- ============================================================

create or replace function internal.seed_teams_from_proposal(p_club_id uuid, p_rugby_code text, p_proposed_teams jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_letter text;
  v_created integer := 0;
  v_category text;
  v_age_group text;
  v_gender text;
  v_squad text;
begin
  if p_proposed_teams is null then return 0; end if;

  for v_item in select * from jsonb_array_elements(p_proposed_teams)
  loop
    select t.category, t.age_group, t.gender, t.fixed_squad_designation
      into v_category, v_age_group, v_gender, v_squad
    from public.canonical_team_types t
    where t.is_active
      and (
        (t.category in ('colts', 'senior') and t.label = (v_item->>'category'))
        or (t.category = 'youth' and (case when t.gender = 'girls' then 'Under ' || substring(t.age_group from 2) || ' Girls' else 'Under ' || substring(t.age_group from 2) end) = (v_item->>'category'))
      )
    limit 1;

    if v_category is null then
      continue;
    end if;

    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
    values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_squad, 'pending', 'pending', auth.uid(), auth.uid())
    on conflict (club_id, identity_key) do nothing;
    if found then v_created := v_created + 1; end if;

    if v_category = 'youth' then
      for v_letter in select jsonb_array_elements_text(coalesce(v_item->'additionalLetters', '[]'::jsonb))
      loop
        insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, created_by, updated_by)
        values (p_club_id, p_rugby_code, v_category, v_age_group, v_gender, v_letter, 'pending', 'pending', auth.uid(), auth.uid())
        on conflict (club_id, identity_key) do nothing;
        if found then v_created := v_created + 1; end if;
      end loop;
    end if;

    v_category := null;
  end loop;

  return v_created;
end;
$$;

comment on function internal.seed_teams_from_proposal is
  'Turns a claim''s proposed_teams into real teams rows -- called once from approve_club_claim. Resolves each proposed label against the LIVE canonical_team_types table (never a hardcoded list) so a Site-Admin-added global type is seedable from a claim with zero code changes here. display_name/slug are placeholders; teams_set_display_name_trigger computes the real values on the same insert.';
