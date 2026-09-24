/**
 * The canonical youth age-group codes -- mirrors `teams.age_group`'s real
 * DB check constraint exactly (`teams_age_group_check` in
 * supabase/migrations/20260830143507_fixtures.sql and widened since;
 * confirmed live via `\d public.teams`), not `canonical_team_types`' own
 * seeded rows. A real, live canonical *type* not existing yet for U18 does
 * not mean U18 is an invalid `age_group` value; the "missing team" flow this
 * list feeds exists specifically to describe a team whose real canonical type
 * doesn't exist as an active row yet.
 *
 * SHARED SINCE CA-M11.1 so the Season Handover's Adjust control offers the same
 * destinations on the phone as on the web. Before `lib/teams/age-groups.ts`
 * existed there were two silently DIFFERENT hardcoded copies on the web; a
 * third on the phone is the drift this file prevents. This is the
 * DB-boundary-matching list; server validation (the real check constraint and
 * `internal.assert_rollover_destination_valid`) remains authoritative
 * regardless of what this offers.
 */
export const YOUTH_AGE_GROUPS = ["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "U19"] as const

export type YouthAgeGroup = (typeof YOUTH_AGE_GROUPS)[number]
