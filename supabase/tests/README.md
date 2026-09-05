# Manual SQL/RLS test suites

Not migrations -- never applied automatically by `supabase db reset`. Each
file is self-contained (creates its own throwaway `auth.users`/`profiles`
fixtures via `on conflict do nothing`), but several files intentionally
reuse the same shared fixture ids (test users 0001-0011, Burnley/Rossendale/
Leigh clubs, U12 A/U13 A teams) that `permission_matrix.sql` creates first --
their own header comments say so explicitly ("Reuses the shared fixture ids
from permission_matrix.sql").

**`permission_matrix.sql` must run first**, every time, including after a
fresh `supabase db reset --local`. Running the suites in plain alphabetical
order breaks this (confirmed by hand): dependent files fall back to
whatever partial state exists, `admin_user_management.sql`'s user count
assertions undercount, and scenarios that need a fixture id
`permission_matrix.sql` owns fail outright. The other 9 files can run in
any order relative to each other.

```
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/site_admin_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/admin_club_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/admin_user_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_people_teams.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/partner_clubs_and_messaging.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/claim_eligibility_and_enumeration.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_directory_integrity.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_age_eligibility.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/message_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_results.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/opponent_reconciliation.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_message_attachments.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_presence.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/document_library.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_competition_edit.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/contact_cards.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/conversation_add_participant.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/conversation_participation_management.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_directory_geocoding.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/support_tickets.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/auth_session_versioning.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/public_support_tickets.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/rugby_code_immutability.sql
docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_directory_research_proposals.sql
```

`public_support_tickets.sql` must run after `support_tickets.sql` (reuses its
fixtures and RPCs). `rugby_code_immutability.sql` must run after
`message_management.sql` (reuses its fixture 0022, a `club_data` Site
Admin) and before `club_directory_research_proposals.sql` (which reuses
the same `e1000000-...` test club).

Each file prints `NOTICE:  PASS n: ...` / `NOTICE:  FAIL n: ...` per
assertion -- count both to get the suite's pass/fail totals.

`auth.users.email` has a real unique constraint (`users_email_partial_key`)
across the whole database, not per-file -- when adding a new test file's
fixture users, pick an email that doesn't collide with any other suite's
(grep `supabase/tests/*.sql` for the address first). A collision doesn't
error loudly at the colliding statement in a way that's easy to trace: it
aborts that file's whole fixture-setup `do $$` block silently under
`\set ON_ERROR_STOP off`, so only the specific scenarios that depend on the
never-created user fail, elsewhere in the file, with a confusing
foreign-key-violation message instead of a clear "duplicate email" one.

Current suites and their known-good pass counts (fresh reset, correct
order): permission_matrix 18, site_admin_management 16,
admin_club_management 28, admin_user_management 22, club_people_teams 22,
partner_clubs_and_messaging 28, permission_management 13,
fixture_management 16, claim_eligibility_and_enumeration 11,
club_directory_integrity 9, fixture_age_eligibility 23,
message_management 11, fixture_results 22, opponent_reconciliation 22,
fixture_message_attachments 18, fixture_presence 7, document_library 20,
fixture_competition_edit 7, contact_cards 8, conversation_add_participant 8,
conversation_participation_management 9, club_directory_geocoding 6,
support_tickets 23, auth_session_versioning 8, public_support_tickets 9,
rugby_code_immutability 7, club_directory_research_proposals 6 -- 397
total, 0 failing.

Always run every suite against a genuinely FRESH `supabase db reset --local`
in one pass -- re-running the same suite twice in a row without resetting
in between gives different (usually lower) counts, since several files'
scenarios aren't idempotent against their own leftover state (an
"already activated" guard skips its own setup, a unique constraint quietly
absorbs a would-be duplicate insert). A changed count on a second run
without a reset in between is a test-methodology artifact, not a
regression -- always re-verify against a fresh reset before concluding
something broke.

## Test-fixture id collisions across files (durable lesson)

`80000000-0000-0000-0000-0000000000NN` was reused by both
`partner_clubs_and_messaging.sql` (a real, deliberately-uncommitted-cleanup
`fixture_request_groups`/`fixture_requests` pair from its own scenario 7)
and `opponent_reconciliation.sql` (added later, independently, without
checking). Because `partner_clubs_and_messaging.sql` runs earlier in the
required order and never deletes its own row, `opponent_reconciliation.sql`'s
own insert of the same id then failed with a duplicate-key error -- and
because `partner_clubs_and_messaging.sql`'s later scenarios attach real
`fixture_messages` rows to that same request, `opponent_reconciliation.sql`'s
own cleanup block then ALSO failed, on an unrelated-looking foreign-key
violation, cascading into several unrelated-looking downstream failures in
between. Fixed by moving `opponent_reconciliation.sql` to its own
`81000000-...` id prefix. Before adding a new test file's scratch ids
(fixtures, fixture_requests, fixture_request_groups, anything else with a
hand-picked uuid), `grep` every OTHER test file for that exact prefix
first -- the existing "check auth.users.email for collisions" rule above
applies equally to every hand-picked id column, not just email.

## The IF NOT (a OR b) THEN RAISE authorization bug (durable lesson)

`internal.site_admin_role(p_user_id)` returns SQL `NULL` (not `false`) for
a user with no `site_admins` row at all. In a check shaped
`if not (internal.is_full_site_admin() or internal.site_admin_role(auth.uid()) = 'x') then raise exception ... end if;`,
an ordinary authenticated user with zero site-admin standing makes the
inner OR evaluate to `NULL` (`false OR NULL = NULL`), and PL/pgSQL treats
`IF NOT (NULL)` -- itself `NULL` -- as false, so the `RAISE EXCEPTION`
branch is silently skipped and the check passes. This is NOT the same
failure mode as a `NULL` in an RLS `USING`/`WITH CHECK` clause, where
`NULL` correctly denies -- it is specific to this `IF NOT (...) THEN RAISE`
PL/pgSQL idiom whenever any disjunct can itself evaluate to `NULL`. Found
via `fixture_results.sql`'s own Site-Admin-resolution-requires-authorization
scenario (an ordinary Club Admin with no `site_admins` row successfully
called `resolve_fixture_result_dispute`). The same shape existed in 5
places across 3 migrations -- `site_admin_management.sql`'s own definition
of `internal.is_full_site_admin()` (the root cause, since every other check
composes it), `revoke_site_admin_invitation`, and three
`message_management.sql` functions -- and was fixed at the source by making
`is_full_site_admin()` itself `coalesce(internal.site_admin_role(auth.uid()), '') = 'full'`
(never null), plus wrapping the other four direct
`site_admin_role(auth.uid()) = '<profile>'` comparisons in the same
`coalesce(..., '')`. Before writing a new `if not (A or B) then raise`
authorization check anywhere in this codebase, confirm every disjunct is
provably non-null (or wrap it in `coalesce`) -- `internal.is_site_admin()`
and `internal.is_account_active()` already are; `internal.site_admin_role()`
and anything built directly from an equality comparison against it are not,
unless coalesced.
