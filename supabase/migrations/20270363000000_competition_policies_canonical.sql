-- Slice 4D -- part 2: the eight competition read policies (Phase 2 AA.3 row 4d).
--
-- CONTRACT STEP in the ledger's sense -- it rewrites policies -- but not in the release sense:
-- no privilege is withdrawn, no function signature changes and the application is untouched by
-- it, so it may be applied while the current build is serving.
--
-- The eight policies already became canonical when internal.can_organise_edition did, in
-- 20270362000000. They are rewritten here for a second reason, measured rather than assumed.
--
-- WHY. internal.can_organise_edition is SECURITY DEFINER, and Postgres cannot inline a SECURITY
-- DEFINER function, so a policy that calls it per row makes one resolver call per candidate row.
-- Measured on one edition holding 800 matches, reading them as the organising Club Admin:
--
--   pre-4D  (can_bulk_plan_fixtures inside the gate)   153.1 ms
--   4D gate (canonical internal.can inside the gate)   146.5 ms      <- no regression
--   4D gate + the hoist below                            2.2 ms      <- ~70x
--
-- So 4D caused no regression; the cost was already there and is inherent to asking a
-- per-row question that does not actually vary per row. The organiser set depends only on WHO
-- is asking, so it belongs in the policy as an uncorrelated subquery, where the planner
-- evaluates it once per statement as an InitPlan. This is the same fix Slice 4C applied to
-- fixtures_select_related, for the same reason.
--
-- WHAT IS DELIBERATELY NOT HOISTED. internal.competition_edition_is_public stays a per-row call.
-- It is J.8 line 482 "KEEP" -- not 4D's to redefine -- and the set of publicly visible editions
-- is platform-wide rather than caller-bounded, so hoisting it would build a potentially large
-- array for every anonymous reader to save a cheap published-flag test.

-- The caller's own organisable editions. SECURITY DEFINER and parameterless: it returns only
-- what THIS caller organises, so it can reveal nothing the policies below did not already allow.
create or replace function internal.organised_edition_ids()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.competition_editions e
  join public.competitions c on c.id = e.competition_id
  where internal.is_account_active(auth.uid())
    and (
      internal.has_site_capability('site.competitions.manage')
      or (c.organiser_club_id is not null
          and internal.can('competition.edition.manage', 'club', c.organiser_club_id, null, null))
    );
$$;

comment on function internal.organised_edition_ids() is
  'Slice 4D: the caller''s own organisable competition editions, computed once per statement as a '
  'policy InitPlan instead of once per row. Same authority as internal.can_organise_edition.';

-- The policies run as the caller, not as the definer, so every role that reads these tables needs
-- EXECUTE -- and that includes `anon`.
--
-- It is easy to conclude otherwise, and I did at first. `has_table_privilege('anon',
-- 'public.competition_matches', 'SELECT')` returns FALSE, which looks like "anon never reads this
-- table". It is false because anon's grant is COLUMN-level: the perimeter manifest classifies
-- competition_matches as PUBLIC and grants anon nineteen named columns, which is how the public
-- competition surface at app/competitions/[slug] is served. A column-level grant does not satisfy a
-- table-level privilege test. Anon really does read these tables, really does evaluate these
-- policies, and really does need to execute the helper inside them -- the manifest already recorded
-- exactly that for the helper this one replaces.
grant execute on function internal.organised_edition_ids() to authenticated, anon;

-- internal.can_organise_edition is no longer named by ANY policy, so anon no longer needs to execute
-- it. Withdrawing that grant is the genuine perimeter tightening here; it was carried only because
-- the eight policies used to call it per row.
revoke execute on function internal.can_organise_edition(uuid) from anon;

do $$
begin
  if not has_function_privilege('anon', 'internal.organised_edition_ids()', 'EXECUTE') then
    raise exception 'anon cannot execute internal.organised_edition_ids(); the public competition surface would break.';
  end if;
  if has_function_privilege('anon', 'internal.can_organise_edition(uuid)', 'EXECUTE')
     and not exists (select 1 from pg_policies
                     where (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%can_organise_edition%') then
    raise exception 'anon still holds EXECUTE on internal.can_organise_edition(uuid), which no policy uses.';
  end if;
end $$;

drop policy if exists competition_matches_read on public.competition_matches;
create policy competition_matches_read on public.competition_matches
for select using (
  edition_id in (select unnest(internal.organised_edition_ids()))
  or (is_public and status <> 'draft' and internal.competition_edition_is_public(edition_id))
);

drop policy if exists competition_stages_read on public.competition_stages;
create policy competition_stages_read on public.competition_stages
for select using (
  edition_id in (select unnest(internal.organised_edition_ids()))
  or internal.competition_edition_is_public(edition_id)
);

drop policy if exists competition_participants_read on public.competition_participants;
create policy competition_participants_read on public.competition_participants
for select using (
  edition_id in (select unnest(internal.organised_edition_ids()))
  or internal.competition_edition_is_public(edition_id)
);

drop policy if exists competition_groups_read on public.competition_groups;
create policy competition_groups_read on public.competition_groups
for select using (
  exists (
    select 1 from public.competition_stages s
    where s.id = competition_groups.stage_id
      and (s.edition_id in (select unnest(internal.organised_edition_ids()))
           or internal.competition_edition_is_public(s.edition_id))
  )
);

drop policy if exists competition_group_members_read on public.competition_group_members;
create policy competition_group_members_read on public.competition_group_members
for select using (
  exists (
    select 1 from public.competition_stages s
    where s.id = competition_group_members.stage_id
      and (s.edition_id in (select unnest(internal.organised_edition_ids()))
           or internal.competition_edition_is_public(s.edition_id))
  )
);

drop policy if exists competition_rounds_read on public.competition_rounds;
create policy competition_rounds_read on public.competition_rounds
for select using (
  exists (
    select 1 from public.competition_stages s
    where s.id = competition_rounds.stage_id
      and (s.edition_id in (select unnest(internal.organised_edition_ids()))
           or internal.competition_edition_is_public(s.edition_id))
  )
);

drop policy if exists competition_match_fixtures_read on public.competition_match_fixtures;
create policy competition_match_fixtures_read on public.competition_match_fixtures
for select using (
  exists (
    select 1 from public.competition_matches m
    where m.id = competition_match_fixtures.match_id
      and m.edition_id in (select unnest(internal.organised_edition_ids()))
  )
  or exists (select 1 from public.fixtures f where f.id = competition_match_fixtures.fixture_id)
);

-- The verification row a club answers with. The first two branches are Slice 4C's helpers and
-- are left exactly as they are: "may this club plan fixtures" and "may this team have a fixture
-- created for it" are fixture questions, and 4C owns their meaning. Only the organiser branch,
-- which is 4D's, is hoisted.
drop policy if exists competition_match_verifications_read on public.competition_match_verifications;
create policy competition_match_verifications_read on public.competition_match_verifications
for select using (
  internal.can_bulk_plan_fixtures(club_id)
  or (team_id is not null and internal.can_create_team_fixture(club_id, team_id))
  or exists (
    select 1 from public.competition_matches m
    where m.id = competition_match_verifications.match_id
      and m.edition_id in (select unnest(internal.organised_edition_ids()))
  )
);
