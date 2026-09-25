-- CLUBHOUSE PROGRAMME SECTION 8 -- ARRANGE A FIXTURE.
--
-- TWO GENUINE, PRE-EXISTING GAPS FOUND WHILE AUDITING THE REQUEST-CREATION DOMAIN BEFORE BUILDING ONE
-- CANONICAL "ARRANGE A FIXTURE" COMPOSER. Neither is caused by this section's own UI work; both are
-- closed here because Section 8 is explicitly the section that pins fixture.request.create's authority
-- boundary and converges the request-creation entry points onto it.
--
-- 1. `fixture_request_groups_insert_scoped` (20260903800000) was never migrated off the legacy
--    `internal.can_manage_club_fixtures_or_any_team`, which decides on `fixture.fixture.edit` -- NOT
--    `fixture.request.create`. `fixture_requests_insert_scoped` (the per-team ROW policy, migrated in
--    20270359000000) already asks the correct capability. So today, someone holding ONLY
--    `fixture.fixture.edit` (recording/editing already-agreed fixtures -- a genuinely different
--    authority) can create a `fixture_request_groups` row even without `fixture.request.create` at all.
--    The blast radius is bounded -- the row-level policy still correctly refuses the actual
--    `fixture_requests` insert, so no request can ever be SENT this way -- but an orphan group row is a
--    real, avoidable authority inconsistency, and it is exactly the kind of "does capability X imply
--    capability Y" drift this section's own directive requires proving does NOT happen.
-- 2. No mechanism anywhere prevents two independent, simultaneously-pending requests between the same
--    team pair for the SAME DATE in the same direction -- the literal duplicate the directive names
--    ("same teams, same date, same direction... already pending"). Scoped to the well-defined case
--    (both `requesting_team_id` and `target_team_id` known); a request addressed to a scheduling group
--    or a not-yet-real named identity has no stable pair to de-duplicate against and is left alone, same
--    scoping precedent as the age-eligibility trigger this migration sits beside. DELIBERATELY NOT
--    scoped to the pair alone, regardless of date: `fixture_management_authority.sql`'s own FA-H5/FA-H7c
--    already exercises two legitimate, deliberate requests between the same two teams for two different
--    dates (proving a named opponent team wins over a structured identity) -- found running the existing
--    suite against this migration for the first time, and it is real, pre-existing, sanctioned product
--    behaviour, not something this section should break to enforce a narrower rule than was asked for.

begin;

-- 1. THE GROUP POLICY, CORRECTED TO THE SAME CAPABILITY ITS OWN ROWS ALREADY REQUIRE. Mirrors
--    `can_manage_club_fixtures_or_any_team`'s exact shape (club-wide OR any one active team) but asks
--    `fixture.request.create`, not `fixture.fixture.edit` -- never repurposing the legacy helper itself,
--    since that helper is also read by unrelated call sites this migration has no reason to touch.
drop policy if exists fixture_request_groups_insert_scoped on public.fixture_request_groups;
create policy fixture_request_groups_insert_scoped on public.fixture_request_groups
for insert
with check (
  internal.can('fixture.request.create', 'club', requesting_club_id, null, null)
  or exists (
    select 1 from public.teams t
    where t.club_id = requesting_club_id and t.active
      and internal.can('fixture.request.create', 'team', requesting_club_id, t.id, null)
  )
  or internal.has_site_capability('site.fixtures.support')
);

comment on policy fixture_request_groups_insert_scoped on public.fixture_request_groups is
  'Section 8: raising the GROUP a request lives in is fixture.request.create -- club-wide, or at any one '
  'active team of the requesting club -- the same capability (and the same club-or-any-team shape) the '
  'per-team fixture_requests_insert_scoped policy already requires for the rows inside it. Previously '
  'read the legacy fixture.fixture.edit-based can_manage_club_fixtures_or_any_team, a different '
  'authority than raising a request.';

-- 2. DUPLICATE-PENDING-REQUEST REFUSAL, enforced where every creation path (web, native, Calendar's
--    dialog, any future caller) ultimately writes -- never left to a disabled button, which only ever
--    protects the one screen that remembered to check.
-- INSERT ONLY, DELIBERATELY. Accept/counter/decline are all UPDATEs on an already-vetted row and must
-- never be second-guessed by this check -- e.g. declining request A must not be blocked merely because
-- an unrelated duplicate row B (same pair, still 'sent', pre-dating this migration) happens to exist.
-- Only a fresh INSERT can create a genuinely NEW parallel pending request.
create or replace function internal.enforce_fixture_request_not_duplicate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_new_date date;
begin
  if new.requesting_team_id is null or new.target_team_id is null then
    return new;
  end if;
  select proposed_date into v_new_date from public.fixture_request_groups where id = new.group_id;
  if exists (
    select 1 from public.fixture_requests r
    join public.fixture_request_groups g on g.id = r.group_id
    where r.requesting_team_id = new.requesting_team_id
      and r.target_team_id = new.target_team_id
      and r.status in ('sent', 'counter_proposed')
      and g.proposed_date = v_new_date
  ) then
    raise exception 'There is already a pending fixture request between these two teams for this date.'
      using errcode = '23505',
            hint = 'Check Fixture Requests and negotiate the existing one rather than sending a second.';
  end if;
  return new;
end $$;

comment on function internal.enforce_fixture_request_not_duplicate() is
  'Section 8: refuses a second simultaneously-pending (sent/counter_proposed) request in the same '
  'direction, between the same two teams, for the same date -- checked only on INSERT. Scoped to the '
  'well-defined case -- both requesting_team_id and target_team_id already known -- a scheduling-group '
  'or named-identity request has no stable pair to de-duplicate against and is left alone, same scoping '
  'precedent as fixture_requests_age_eligibility. Date-scoped deliberately: fixture_management_authority '
  'legitimately raises two requests between the same pair on different dates (FA-H5/FA-H7c), and that is '
  'sanctioned product behaviour, not a duplicate.';

drop trigger if exists fixture_requests_not_duplicate on public.fixture_requests;
create trigger fixture_requests_not_duplicate
  before insert on public.fixture_requests
  for each row execute function internal.enforce_fixture_request_not_duplicate();

commit;
