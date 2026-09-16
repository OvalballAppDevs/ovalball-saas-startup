-- Slice 4C (fixtures, requests, results, Planner, Import) -- part 2: move the fixture row
-- policies onto the canonical capability decision (Phase 2 AA.3 row 4c).
--
-- Contract step. This is the migration that changes what people can read, so it lands AFTER the
-- application release that already reads canonically (proven by the 4C compatibility matrix).
--
-- Seven policies still named internal.can_manage_club_fixtures or internal.can_manage_team, and
-- most also carried a bare internal.is_site_admin(). They now ask the canonical fixture keys, and
-- a site answer arrives through the explicit site master equivalent instead of a bypass.
--
-- Two of the seven are the write side of questions whose read side was already being migrated, and
-- they are here because 4C owns the meaning of the call site, not merely because the helper matched
-- a grep: raising a fixture request (fixture.request.create) and deleting a fixture
-- (site.fixtures.delete). The delete policy's rewrite removes a legacy reference and lowers the
-- PG-15 count, but its authority change is not observable through any browser role, because DELETE
-- on public.fixtures is granted only to postgres and service_role and both carry BYPASSRLS. The
-- suite states that rather than staging a scenario that would imply otherwise.
--
-- The three policies that call internal.can_manage_fixture_side are already canonical: that
-- function was migrated in 20270358000000, so the policies resolve through the canonical decision
-- without being rewritten. Only the bare is_site_admin in fixture_communications is removed here.
--
-- NOT in this migration, and deliberately: the direct-insert bypass on public.fixtures
-- (J.6 line 457). Removing it needs the create_fixture RPC that J.6 names and that does not yet
-- exist, and that RPC must route a fixture against another Ovalball club through canonical
-- inter-club verification rather than around it. That is a build, not a policy rewrite, and it is
-- tracked as the remaining 4C item.

-- 1. Call-ups: who may see one -------------------------------------------------------------
drop policy if exists fixture_player_call_up_select on public.fixture_player_call_up;
create policy fixture_player_call_up_select on public.fixture_player_call_up
for select
using (
  internal.can('fixture.callup.request', 'team',
               (select t.club_id from public.teams t where t.id = fixture_player_call_up.source_team_id),
               fixture_player_call_up.source_team_id, null)
  or internal.can('fixture.callup.request', 'team',
               (select t.club_id from public.teams t where t.id = fixture_player_call_up.target_team_id),
               fixture_player_call_up.target_team_id, null)
  or internal.can('fixture.callup.approve', 'club',
               (select t.club_id from public.teams t where t.id = fixture_player_call_up.source_team_id), null, null)
  or internal.can('fixture.callup.approve', 'club',
               (select t.club_id from public.teams t where t.id = fixture_player_call_up.target_team_id), null, null)
  or internal.has_site_capability('site.support.act_in_club')
);

comment on policy fixture_player_call_up_select on public.fixture_player_call_up is
  'Slice 4C: a call-up is visible to the staff of either team involved (fixture.callup.request) and to '
  'either club''s approvers (fixture.callup.approve). The bare is_site_admin branch is replaced by the '
  'site master equivalent.';

-- 2. Fixture request groups ------------------------------------------------------------------
drop policy if exists fixture_request_groups_select_scoped on public.fixture_request_groups;
create policy fixture_request_groups_select_scoped on public.fixture_request_groups
for select
using (
  internal.can('fixture.request.create', 'club', fixture_request_groups.requesting_club_id, null, null)
  or (fixture_request_groups.opponent_club_id is not null
      and internal.can('fixture.request.respond', 'club', fixture_request_groups.opponent_club_id, null, null))
  or fixture_request_groups.created_by = auth.uid()
  or internal.group_has_visible_request(fixture_request_groups.id)
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_request_groups_select_scoped on public.fixture_request_groups is
  'Slice 4C: the club that raised the request reads it (fixture.request.create) and the club being asked '
  'reads it (fixture.request.respond). The person who created it keeps their own row.';

-- 3 and 4. Fixture requests: read and respond --------------------------------------------------
drop policy if exists fixture_requests_select_scoped on public.fixture_requests;
create policy fixture_requests_select_scoped on public.fixture_requests
for select
using (
  internal.can('fixture.request.create', 'team',
               (select t.club_id from public.teams t where t.id = fixture_requests.requesting_team_id),
               fixture_requests.requesting_team_id, null)
  or (fixture_requests.target_team_id is not null
      and internal.can('fixture.request.respond', 'team',
               (select t.club_id from public.teams t where t.id = fixture_requests.target_team_id),
               fixture_requests.target_team_id, null))
  or exists (
    select 1 from public.fixture_request_groups g
    where g.id = fixture_requests.group_id
      and (internal.can('fixture.request.create', 'club', g.requesting_club_id, null, null)
           or (g.opponent_club_id is not null
               and internal.can('fixture.request.respond', 'club', g.opponent_club_id, null, null)))
  )
  or internal.has_site_capability('site.fixtures.support')
);

drop policy if exists fixture_requests_update_scoped on public.fixture_requests;
create policy fixture_requests_update_scoped on public.fixture_requests
for update
using (
  -- Answering a request is fixture.request.respond, which J.6 line 466 gives to CA, FS and TM.
  -- A Coach may raise a request and may not answer one, so the read policy above is deliberately
  -- wider than this one.
  (fixture_requests.target_team_id is not null
   and internal.can('fixture.request.respond', 'team',
            (select t.club_id from public.teams t where t.id = fixture_requests.target_team_id),
            fixture_requests.target_team_id, null))
  or exists (
    select 1 from public.fixture_request_groups g
    where g.id = fixture_requests.group_id
      and (internal.can('fixture.request.respond', 'club', g.requesting_club_id, null, null)
           or (g.opponent_club_id is not null
               and internal.can('fixture.request.respond', 'club', g.opponent_club_id, null, null)))
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_requests_update_scoped on public.fixture_requests is
  'Slice 4C: answering a fixture request is fixture.request.respond (CA, FS, TM). Reading one is wider '
  'than answering it, which is why the select and update policies differ.';

-- 4b. Raising a fixture request ------------------------------------------------------------------
-- The write side of the same question. `can_manage_team` answered "may this person administer this
-- team at all", which is both wider than raising a fixture request and non-inheriting: a Club Admin
-- who holds fixture.request.create at club scope did not satisfy it for an individual team.
drop policy if exists fixture_requests_insert_scoped on public.fixture_requests;
create policy fixture_requests_insert_scoped on public.fixture_requests
for insert
with check (
  internal.can('fixture.request.create', 'team',
               (select t.club_id from public.teams t where t.id = fixture_requests.requesting_team_id),
               fixture_requests.requesting_team_id, null)
  or exists (
    select 1 from public.fixture_request_groups g
    where g.id = fixture_requests.group_id
      and internal.can('fixture.request.create', 'club', g.requesting_club_id, null, null)
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_requests_insert_scoped on public.fixture_requests is
  'Slice 4C: raising a fixture request is fixture.request.create, which J.6 line 466 gives to a Coach '
  'as well as to CA, FS and TM. Answering one is fixture.request.respond and is narrower.';

-- 4c. Deleting a fixture -------------------------------------------------------------------------
-- Hard deletion is a site act, not a club one: archiving is what a club does. The bare is_site_admin()
-- here was a blanket bypass, so this is the same intended change as the rest of 4C — a Full Site Admin
-- now needs the explicit site capability rather than the role alone.
drop policy if exists fixtures_delete_admin on public.fixtures;
create policy fixtures_delete_admin on public.fixtures
for delete
using (internal.has_site_capability('site.fixtures.delete'));

comment on policy fixtures_delete_admin on public.fixtures is
  'Slice 4C: deleting a fixture requires site.fixtures.delete. Clubs archive (fixture.fixture.archive); '
  'only the site deletes.';

-- 5. Result submissions --------------------------------------------------------------------------
drop policy if exists fixture_result_submissions_select_scoped on public.fixture_result_submissions;
create policy fixture_result_submissions_select_scoped on public.fixture_result_submissions
for select
using (
  exists (
    select 1 from public.fixtures f
    where f.id = fixture_result_submissions.fixture_id
      and internal.can_submit_fixture_result(f.id)
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_result_submissions_select_scoped on public.fixture_result_submissions is
  'Slice 4C: a result submission is visible to whoever may record the result for that fixture, asked '
  'once through internal.can_submit_fixture_result so the policy and the write path cannot drift.';

-- 6. Fixture communications: drop the last bare is_site_admin -------------------------------------
drop policy if exists fixture_communications_select_staff on public.fixture_communications;
create policy fixture_communications_select_staff on public.fixture_communications
for select
using (
  exists (
    select 1 from public.fixtures f
    where f.id = fixture_communications.fixture_id
      and (internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
           or (f.opponent_team_id is not null
               and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)))
  )
  or internal.has_site_capability('site.support.act_in_club')
);

comment on policy fixture_communications_select_staff on public.fixture_communications is
  'Slice 4C: fixture staff on either side read the fixture''s communications. can_manage_fixture_side is '
  'itself canonical since 20270358000000; only the bare is_site_admin branch is removed here.';
