/**
 * The canonical youth age-group codes -- mirrors `teams.age_group`'s real
 * DB check constraint exactly (`teams_age_group_check` in
 * supabase/migrations/20260830143507_fixtures.sql and widened since;
 * confirmed live via `\d public.teams`), not `canonical_team_types`' own
 * seeded rows (which only cover U6-U17 today -- a real, live canonical
 * *type* not existing yet for U18 does not mean U18 is an invalid
 * `age_group` value; the "missing team" flow this list feeds exists
 * specifically to describe a team whose real canonical type doesn't exist
 * as an active row yet). Before this file existed, two independent, silently
 * DIFFERENT hardcoded copies existed: `AGE_GROUPS` (U6-U18, correct) in
 * fixtures/new/request-fixture-form.tsx and club/rollover/rollover-review.tsx,
 * and `YOUTH_AGE_GROUPS` (U6-U16 only -- missing the real U17 canonical
 * type that already exists) in admin/fixtures/opponent-resolver.tsx. This
 * is the DB-boundary-matching list; server validation (the real check
 * constraint) remains authoritative regardless of what this offers.
 */
export const YOUTH_AGE_GROUPS = ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18"] as const
