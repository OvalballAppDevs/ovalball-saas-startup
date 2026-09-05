-- Closed canonical team catalogue. The previous slice (20260904100000)
-- locked how a team's NAME is computed; this closes what a team's IDENTITY
-- is allowed to be at all. A club no longer merely avoids typing a stray
-- name -- it can only ever create one of a fixed, closed set of real rugby
-- team identities, referenced by a stable foreign key, never a string.
--
-- Architecture: canonical_team_types is the closed catalogue (24 rows,
-- seeded once, never admin-editable -- adding a 25th identity is a product
-- decision requiring a new migration, exactly like `capabilities` in
-- 20260831240000). teams.canonical_team_type_id links each real club-team
-- row to exactly one of those 24 rows. The existing category/age_group/
-- gender/squad_designation columns are UNCHANGED -- this migration adds a
-- governing reference over them, it does not replace them, and it does
-- not touch a single existing team_id (section 80's "do not break stable
-- team IDs" -- every fixture/permission/message/training foreign key into
-- teams.id survives this untouched).
--
-- Enforcement has two deliberately different strengths for two different
-- audiences, found necessary by inspecting real data before writing this:
--
-- 1. AUTO-RESOLUTION (teams_set_canonical_type_trigger, below): every
--    insert or structural update gets canonical_team_type_id computed
--    automatically from category/age_group/gender/squad_designation. When
--    no canonical type matches, it is left NULL rather than rejected --
--    this is what makes the trigger safe to backfill and to run against
--    the *entire* existing SQL regression suite unmodified.
-- 2. HARD REJECTION for real product writes only (teams_insert_admin RLS
--    policy, widened below): a NULL canonical_team_type_id after
--    auto-resolution is rejected -- but only for inserts going through
--    RLS as `authenticated`, i.e. the one direct client insert path
--    (app/(app)/teams/actions.ts's createTeam). Every SQL test file in
--    supabase/tests/ connects as the `postgres` superuser (see e.g.
--    gender_age_grade_rules.sql's own header), which bypasses RLS
--    entirely, by design, the same way it already bypasses every other
--    RLS policy in this project -- so this closure needs no test-file
--    rewrite. SECURITY DEFINER RPCs (rollover, controlled missing-team
--    creation, claim-approval seeding) also run as the migration owner
--    and are therefore not gated by this RLS check either; each of those
--    write paths already only ever produces catalogue-valid combinations
--    by construction (see the comments on each below), so this is a
--    closed loop, not a gap.
--
-- Real pre-existing data was inspected before deciding this (not assumed):
-- a handful of legacy/import rows do not fit the new closed set at all --
-- "Men's 4th" (a senior ordinal beyond 3rd) and a few "U8 Girls"/"U9
-- Girls" rows from directory-import fixtures (the new catalogue's Girls
-- band starts at U12, matching the user's own explicit spec). These are
-- never deleted and never force-normalized into a wrong identity --
-- canonical_team_type_id stays NULL on them (auto-resolution correctly
-- finds no match), which is exactly the "preserve history, flag for
-- review, never guess" requirement. They are reported, not hidden.

-- ============================================================
-- 1. category gains a third value: 'colts' -- previously there was no
--    schema representation for Junior/Senior Colts at all (the prior
--    slice's signup picker had a checkbox for it that could never
--    actually produce a matching team; this migration is what finally
--    makes that identity real, not just displayed).
-- ============================================================

alter table public.teams drop constraint teams_category_check;
alter table public.teams add constraint teams_category_check check (category in ('senior', 'youth', 'colts'));

-- age_group's existing check already permits U6-U18 as raw values; Colts
-- reuses the same column as its own level-discriminator (exactly the role
-- age_group already plays for youth) rather than adding a new column.
alter table public.teams drop constraint teams_age_group_check;
alter table public.teams add constraint teams_age_group_check
  check (age_group in ('U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18','JuniorColts','SeniorColts'));

-- ============================================================
-- 2. The closed catalogue itself.
-- ============================================================

create table public.canonical_team_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  -- Exactly what compact-label.ts / compute_team_display_name would
  -- produce for the primary (unlettered) squad -- documentation, not a
  -- second formatter; the trigger-computed display_name remains the one
  -- authoritative name.
  label text not null,
  category text not null check (category in ('senior', 'youth', 'colts')),
  age_group text,
  gender text check (gender in ('boys', 'girls', 'mixed', 'mens', 'womens')),
  fixed_squad_designation text,
  allows_squads boolean not null default false,
  sort_order integer not null
);

comment on table public.canonical_team_types is
  'The closed, fixed set of real team identities Ovalball recognises -- seeded once below, never admin-creatable. A club does not invent a team; it activates one of these 24. Adding a 25th identity (e.g. U17/U18, a 4th senior side) is a deliberate product decision requiring a new migration, matching capabilities'' own "configured, not invented" boundary.';

create unique index canonical_team_types_identity_idx on public.canonical_team_types
  (category, coalesce(age_group, ''), coalesce(gender, ''), coalesce(fixed_squad_designation, ''));

insert into public.canonical_team_types (key, label, category, age_group, gender, fixed_squad_designation, allows_squads, sort_order) values
  ('u6', 'U6', 'youth', 'U6', 'mixed', null, true, 1),
  ('u7', 'U7', 'youth', 'U7', 'mixed', null, true, 2),
  ('u8', 'U8', 'youth', 'U8', 'mixed', null, true, 3),
  ('u9', 'U9', 'youth', 'U9', 'mixed', null, true, 4),
  ('u10', 'U10', 'youth', 'U10', 'mixed', null, true, 5),
  ('u11', 'U11', 'youth', 'U11', 'mixed', null, true, 6),
  ('u12', 'U12', 'youth', 'U12', 'boys', null, true, 7),
  ('u13', 'U13', 'youth', 'U13', 'boys', null, true, 8),
  ('u14', 'U14', 'youth', 'U14', 'boys', null, true, 9),
  ('u15', 'U15', 'youth', 'U15', 'boys', null, true, 10),
  ('u16', 'U16', 'youth', 'U16', 'boys', null, true, 11),
  ('junior_colts', 'Junior Colts', 'colts', 'JuniorColts', null, null, false, 12),
  ('senior_colts', 'Senior Colts', 'colts', 'SeniorColts', null, null, false, 13),
  ('mens_1st', 'Men''s 1st Team', 'senior', null, 'mens', '1st', false, 14),
  ('mens_2nd', 'Men''s 2nd Team', 'senior', null, 'mens', '2nd', false, 15),
  ('mens_3rd', 'Men''s 3rd Team', 'senior', null, 'mens', '3rd', false, 16),
  ('womens_1st', 'Women''s 1st Team', 'senior', null, 'womens', '1st', false, 17),
  ('womens_2nd', 'Women''s 2nd Team', 'senior', null, 'womens', '2nd', false, 18),
  ('womens_3rd', 'Women''s 3rd Team', 'senior', null, 'womens', '3rd', false, 19),
  ('girls_u12', 'Girls U12', 'youth', 'U12', 'girls', null, true, 20),
  ('girls_u13', 'Girls U13', 'youth', 'U13', 'girls', null, true, 21),
  ('girls_u14', 'Girls U14', 'youth', 'U14', 'girls', null, true, 22),
  ('girls_u15', 'Girls U15', 'youth', 'U15', 'girls', null, true, 23),
  ('girls_u16', 'Girls U16', 'youth', 'U16', 'girls', null, true, 24);

alter table public.canonical_team_types enable row level security;
create policy canonical_team_types_select_all on public.canonical_team_types for select to anon, authenticated using (true);

-- ============================================================
-- 2b. compute_team_display_name gains a colts branch -- Colts is new as
--     of this migration and the previous slice's version only knew
--     senior/youth. Mirrors lib/teams/compact-label.ts's own new colts
--     branch exactly.
-- ============================================================

create or replace function internal.compute_team_display_name(
  p_category text, p_age_group text, p_gender text, p_squad_designation text
) returns text
language sql
immutable
as $$
  -- "A" is never a real squad letter -- always treated as no squad,
  -- whatever a legacy or test row happens to have stored (mirrors
  -- lib/teams/compact-label.ts's normalizedSquad exactly).
  select case
    when p_category = 'senior' then
      (case when p_gender = 'womens' then 'Women''s' else 'Men''s' end)
        || ' ' || (case when p_squad_designation is null or upper(p_squad_designation) in ('', 'A') then '1st' else p_squad_designation end)
    when p_category = 'colts' then
      case when p_age_group = 'SeniorColts' then 'Senior Colts' else 'Junior Colts' end
    else
      (case when p_gender = 'girls' then 'Girls ' else '' end)
        || coalesce(p_age_group, 'Team')
        || (case when p_squad_designation is not null and upper(p_squad_designation) not in ('', 'A') then ' ' || p_squad_designation else '' end)
  end
$$;

-- ============================================================
-- 3. Auto-resolution: a real team row's canonical_team_type_id is always
--    computed, never entered. Girls is matched by gender='girls' alone
--    (any other gender -- boys/mixed/null -- resolves to the plain
--    same-age type); classification stays real metadata on the row
--    itself (section 11), it just no longer forks which catalogue
--    identity a team belongs to.
-- ============================================================

create or replace function internal.resolve_canonical_team_type(
  p_category text, p_age_group text, p_gender text, p_squad_designation text
) returns uuid
language sql
stable
as $$
  select id from public.canonical_team_types
  where category = p_category
    and (
      (p_category = 'senior' and gender = p_gender and fixed_squad_designation = coalesce(nullif(p_squad_designation, ''), '1st'))
      or (p_category = 'colts' and age_group = p_age_group)
      or (p_category = 'youth' and age_group = p_age_group and gender = case when p_gender = 'girls' then 'girls' else gender end)
    )
  limit 1;
$$;

comment on function internal.resolve_canonical_team_type is
  'Best-effort match against the closed catalogue -- returns NULL (never raises) when no canonical identity matches, so it is safe to run over historical/legacy rows. The real closure is the NOT NULL check in teams_insert_admin (RLS, real app traffic only) plus each SECURITY DEFINER team-creation RPC only ever producing catalogue-valid input in the first place.';

create or replace function internal.teams_set_canonical_type() returns trigger
language plpgsql
as $$
begin
  new.canonical_team_type_id := internal.resolve_canonical_team_type(new.category, new.age_group, new.gender, new.squad_designation);
  return new;
end;
$$;

alter table public.teams add column canonical_team_type_id uuid references public.canonical_team_types(id);

drop trigger if exists teams_set_canonical_type_trigger on public.teams;
create trigger teams_set_canonical_type_trigger
  before insert or update of category, age_group, gender, squad_designation on public.teams
  for each row execute function internal.teams_set_canonical_type();

comment on column public.teams.canonical_team_type_id is
  'Which of the 24 closed canonical_team_types identities this real team is. Always auto-computed (teams_set_canonical_type_trigger), never entered directly. NULL means this row predates the closed catalogue and does not match it (e.g. a legacy "Men''s 4th" or "U8 Girls" row) -- preserved, never force-normalized into a different identity, but permanently ineligible for new operations that require a canonical type.';

-- One-time normalization: a stored "A" was always meant as the primary
-- (unlettered) squad -- section 4/5''s "the primary squad never displays
-- A". Checked first: no club has both a same-identity "A" row and a
-- same-identity null-squad row, so this cannot merge two real teams.
update public.teams set squad_designation = null where squad_designation = 'A';

-- Backfill every existing row now that the resolver exists (the trigger
-- above only fires on future inserts/updates of the structural columns).
update public.teams set canonical_team_type_id = internal.resolve_canonical_team_type(category, age_group, gender, squad_designation);

-- ============================================================
-- 4. Real duplicate-active-team prevention, scoped to catalogue-linked
--    rows only (a NULL-type legacy row is exempt -- it already fell
--    outside the closed set and re-litigating its uniqueness is a
--    separate, deliberate legacy-audit decision, not this migration's).
--    gender stays part of the key (not collapsed) so this cannot conflict
--    with any pre-existing row where a real classification difference
--    was the very thing keeping two rows apart -- verified against the
--    live regression-fixture database before adding this, not assumed.
-- ============================================================

create unique index teams_active_canonical_identity_idx on public.teams
  (club_id, canonical_team_type_id, coalesce(gender, ''), coalesce(squad_designation, ''))
  where active = true and canonical_team_type_id is not null;

-- ============================================================
-- 5. Real app-layer closure: the one direct client insert path
--    (createTeam) must resolve to a real canonical identity or be
--    rejected. Every other write path (site admin actions, SECURITY
--    DEFINER RPCs) already ran as postgres and was never gated by this
--    policy in the first place -- this only ever tightens the
--    authenticated-user insert path, nothing else.
-- ============================================================

drop policy teams_insert_admin on public.teams;
create policy teams_insert_admin on public.teams for insert
  with check ((internal.is_site_admin() or internal.is_club_admin(club_id)) and canonical_team_type_id is not null);

-- ============================================================
-- 6. seed_teams_from_proposal gains the two Colts rows -- signup's
--    picker (lib/teams/catalog.ts) now offers Colts, matching the closed
--    catalogue, so claim approval must be able to seed them too (section
--    13: "the team choices used when a club is claimed must come from
--    this SAME canonical source"). Everything else about this function
--    is unchanged from 20260904100000.
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
    select t.category, t.age_group, t.gender, t.squad
      into v_category, v_age_group, v_gender, v_squad
    from (values
      ('Under 6', 'youth', 'U6', 'mixed', null),
      ('Under 7', 'youth', 'U7', 'mixed', null),
      ('Under 8', 'youth', 'U8', 'mixed', null),
      ('Under 9', 'youth', 'U9', 'mixed', null),
      ('Under 10', 'youth', 'U10', 'mixed', null),
      ('Under 11', 'youth', 'U11', 'mixed', null),
      ('Under 12', 'youth', 'U12', 'boys', null),
      ('Under 13', 'youth', 'U13', 'boys', null),
      ('Under 14', 'youth', 'U14', 'boys', null),
      ('Under 15', 'youth', 'U15', 'boys', null),
      ('Under 16', 'youth', 'U16', 'boys', null),
      ('Under 12 Girls', 'youth', 'U12', 'girls', null),
      ('Under 13 Girls', 'youth', 'U13', 'girls', null),
      ('Under 14 Girls', 'youth', 'U14', 'girls', null),
      ('Under 15 Girls', 'youth', 'U15', 'girls', null),
      ('Under 16 Girls', 'youth', 'U16', 'girls', null),
      ('Junior Colts', 'colts', 'JuniorColts', null, null),
      ('Senior Colts', 'colts', 'SeniorColts', null, null),
      ('Men''s 1st Team', 'senior', null, 'mens', '1st'),
      ('Men''s 2nd Team', 'senior', null, 'mens', '2nd'),
      ('Men''s 3rd Team', 'senior', null, 'mens', '3rd'),
      ('Women''s 1st Team', 'senior', null, 'womens', '1st'),
      ('Women''s 2nd Team', 'senior', null, 'womens', '2nd'),
      ('Women''s 3rd Team', 'senior', null, 'womens', '3rd')
    ) as t(label, category, age_group, gender, squad)
    where t.label = (v_item->>'category');

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
