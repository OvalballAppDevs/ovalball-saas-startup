-- =====================================================================
-- A CLUB DECIDES WHO RUNS ITS FIXTURES
--
-- Fixture Management already has a real capability model: fixture.view,
-- fixture.create, fixture.edit, fixture.cancel and fixture.manage_requests,
-- resolved by has_capability() across site/club/team scope, with
-- FIXTURE_SECRETARY already carrying the full club bundle.
--
-- Two operations have no capability of their own, and both are exactly the
-- kind a club should be able to withhold:
--
--   IMPORT  a whole season arriving in one file is a club-wide act. It is
--           gated today only by "can you manage any club's fixtures",
--           which is the same authority as editing one kick-off time.
--
--   BULK    editing two hundred fixtures in one action is not two hundred
--           ordinary edits; it deserves to be grantable separately from
--           the single-row edit a team manager needs every week.
--
-- A third capability lets a club administer the above at all, rather than
-- capability grants remaining a Site-Admin-only affair.
--
-- CURRENT ACCESS IS PRESERVED. The defaults below grant import and bulk
-- editing to exactly the roles that can already do the closest equivalent
-- today (CLUB_ADMIN and FIXTURE_SECRETARY at club scope), so nobody loses
-- an ability they had this morning. Team-scope roles get bulk editing
-- WITHIN their own team scope -- they can already edit those fixtures one
-- at a time, so withholding the batched form would be arbitrary -- but
-- NOT import, which is club-wide by nature and which they cannot reach
-- today either.
-- =====================================================================

insert into public.capabilities (key, label, description, category, applicable_scopes)
values
  (
    'fixture.import',
    'Import Fixtures',
    'Upload a fixture list and publish it to the club''s fixtures after review.',
    'fixture',
    array['site', 'club']
  ),
  (
    'fixture.bulk_edit',
    'Bulk Edit Fixtures',
    'Change many fixtures at once, rather than one at a time.',
    'fixture',
    array['site', 'club', 'team']
  ),
  (
    'club.capabilities.manage',
    'Manage Club Permissions',
    'Decide which of the club''s people may run fixtures, training, tournaments and events.',
    'club',
    array['club']
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Defaults: who holds these the moment the feature appears
-- ---------------------------------------------------------------------
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values
  -- Club-wide fixture authority already belongs to these two roles.
  ('club', 'CLUB_ADMIN',        'fixture.import'),
  ('club', 'CLUB_ADMIN',        'fixture.bulk_edit'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.import'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.bulk_edit'),

  -- Only a Club Admin administers the club's own delegation.
  ('club', 'CLUB_ADMIN',        'club.capabilities.manage'),

  -- Team scope: the batched form of an edit they already have. Never
  -- import, which is a club-wide act they cannot perform today.
  ('team', 'CLUB_ADMIN',        'fixture.bulk_edit'),
  ('team', 'TEAM_MANAGER',      'fixture.bulk_edit'),
  ('team', 'TEAM_STAFF',        'fixture.bulk_edit')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- THE COMPETITION FILTER'S OPTIONS, WITHOUT READING EVERY FIXTURE
--
-- The management view builds its Competition filter by selecting
-- competition_edition_id from public.fixtures with no bound at all, then
-- de-duplicating in Node. That is O(every fixture on the platform) on
-- every page load of a paginated screen -- and for Site Admin it is not
-- even club-scoped, so the one genuinely unbounded read on the page is
-- the one nobody looks at.
--
-- A view does the distinct in the database and returns one row per
-- edition actually in use, with the club ids that use it so a club-scoped
-- caller can filter without a second pass.
-- ---------------------------------------------------------------------
create or replace view public.fixture_competition_edition_usage
with (security_invoker = true)
as
select
  ce.id                                   as competition_edition_id,
  c.name                                  as competition_name,
  s.name                                  as season_name,
  array_agg(distinct t.club_id)           as club_ids
from public.fixtures f
join public.competition_editions ce on ce.id = f.competition_edition_id
join public.competitions c           on c.id = ce.competition_id
left join public.seasons s           on s.id = ce.season_id
join public.teams t                  on t.id = f.owning_team_id
group by ce.id, c.name, s.name;

comment on view public.fixture_competition_edition_usage is
  'One row per competition edition that at least one fixture actually uses, with the owning clubs that use it. Exists so the Fixture Management competition filter does not read every fixture row on the platform to populate a dropdown. security_invoker: a caller only ever sees editions on fixtures their own RLS already lets them read.';

grant select on public.fixture_competition_edition_usage to authenticated;
