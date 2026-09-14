-- Two kinds of fixture authority, on purpose.
--
-- A. SINGLE-FIXTURE TEAM AUTHORITY. A team's own staff (team_admin, coach,
--    manager) may create or request ONE fixture for a team they run. That is
--    the existing fixtures_insert_scoped boundary (can_manage_team) together
--    with fixture.create at team scope, and it is what Calendar's create
--    affordance and Request a Fixture offer.
--
-- B. CLUB/SITE BULK PLANNING AUTHORITY. The Season Planner, fixture import
--    (staging and publishing), and competition-wide generation are club
--    administration. They belong to club-scope fixture administrators
--    (Club Admin, Fixture Secretary) and to Site Admins, never to team staff,
--    however many teams those staff run.
--
-- The product difference is deliberate and is encoded here rather than left
-- to whichever screen happens to check what. Before this migration the
-- Planner's page gate read fixture.create at club scope (override-aware)
-- while staging and publishing read can_manage_club_fixtures (role-based), so
-- the screen and the boundary could disagree for an account holding a club
-- override. Both now read internal.can_bulk_plan_fixtures.

-- ============================================================
-- A. Single-fixture team authority
-- ============================================================

create or replace function internal.can_create_team_fixture(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.club_id = p_club_id
      and t.active
      and (
        (internal.can_manage_club_fixtures(p_club_id)
          and internal.has_capability('fixture.create', 'club', p_club_id, null))
        or
        (internal.can_manage_team(p_team_id)
          and internal.has_capability('fixture.create', 'team', p_club_id, p_team_id))
      )
  );
$$;

comment on function internal.can_create_team_fixture(uuid, uuid) is
  'Single-fixture authority: may the signed-in person create or request ONE fixture for this active team? Club-scope fixture administration, or the team''s own staff (can_manage_team + fixture.create at team scope). Never grants bulk planning.';

create or replace function public.single_fixture_team_ids(p_club_id uuid)
returns table (team_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select t.id from public.teams t
  where t.club_id = p_club_id and t.active and internal.can_create_team_fixture(p_club_id, t.id);
$$;

comment on function public.single_fixture_team_ids(uuid) is
  'The active teams at a club the signed-in person may create or request a single fixture for. Read by Calendar''s create affordance. Not an authority for the Season Planner, import or competition generation.';

revoke execute on function public.single_fixture_team_ids(uuid) from public;
revoke execute on function public.single_fixture_team_ids(uuid) from anon;
grant  execute on function public.single_fixture_team_ids(uuid) to authenticated, service_role;

-- ============================================================
-- B. Club/site bulk planning authority
-- ============================================================

create or replace function internal.can_bulk_plan_fixtures(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_club_id is not null
    and internal.can_manage_club_fixtures(p_club_id)
    and internal.has_capability('fixture.create', 'club', p_club_id, null);
$$;

comment on function internal.can_bulk_plan_fixtures(uuid) is
  'Bulk planning authority: Season Planner, fixture import staging/publishing, competition-wide generation. Club-scope fixture administration (Club Admin, Fixture Secretary) or Site Admin, and fixture.create at CLUB scope. Team-scoped authority never satisfies this. Creating more than one fixture at once additionally needs fixture.import, checked by the application exactly as before.';

create or replace function public.can_bulk_plan_fixtures(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.can_bulk_plan_fixtures(p_club_id);
$$;

revoke execute on function public.can_bulk_plan_fixtures(uuid) from public;
revoke execute on function public.can_bulk_plan_fixtures(uuid) from anon;
grant  execute on function public.can_bulk_plan_fixtures(uuid) to authenticated, service_role;

-- The staging tables: the same predicate the Planner's page gate reads.
drop policy if exists fixture_import_batches_admin_or_club on public.fixture_import_batches;
create policy fixture_import_batches_admin_or_club on public.fixture_import_batches
  for all
  using (internal.is_site_admin() or (club_id is not null and internal.can_bulk_plan_fixtures(club_id)))
  with check (internal.is_site_admin() or (club_id is not null and internal.can_bulk_plan_fixtures(club_id)));

drop policy if exists fixture_import_rows_admin_or_club on public.fixture_import_rows;
create policy fixture_import_rows_admin_or_club on public.fixture_import_rows
  for all
  using (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixture_import_batches b
      where b.id = fixture_import_rows.batch_id and b.club_id is not null and internal.can_bulk_plan_fixtures(b.club_id)
    )
  )
  with check (
    internal.is_site_admin()
    or exists (
      select 1 from public.fixture_import_batches b
      where b.id = fixture_import_rows.batch_id and b.club_id is not null and internal.can_bulk_plan_fixtures(b.club_id)
    )
  );

-- Publishing a staged row is redefined in 20270304000000, which restores the
-- guards 20270277000000 dropped and adds the rule that an Ovalball opponent is
-- asked, never booked. It authorises with internal.can_bulk_plan_fixtures.
