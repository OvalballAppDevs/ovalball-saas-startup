/**
 * The one canonical list of every value `fixtures.status` can legally
 * hold -- mirrors the real DB check constraint exactly
 * (supabase/migrations/20260830143507_fixtures.sql: `check (status in
 * ('Planned', 'Booked', 'To Be Determined', 'Annual Holiday', 'Festival',
 * 'Lancashire Cup', 'Cancelled', 'Completed'))`). The last three are real
 * historical CSV-imported statuses, not typos -- before this file existed,
 * five independent UI copies (admin/fixtures/types.ts, calendar/
 * filter-sheet.tsx, admin/fixtures/fixture-filters.tsx, dashboard/page.tsx,
 * admin/fixtures/[fixtureId]/fixture-status-control.tsx) each implemented
 * only 4-5 of these 8 values, so a fixture genuinely carrying one of the
 * three legacy values was unfilterable, inconsistently styled (two
 * different colours for "Planned" alone, in dashboard/page.tsx vs
 * admin/fixtures/fixture-table-row.tsx), and invisible to every status
 * filter dropdown. This is the DISPLAY/FILTER list -- every status a
 * fixture can actually hold. It is deliberately separate from which
 * statuses a user may directly SET via the compact status control
 * (admin/fixtures/actions.ts's own `DIRECT_STATUS_TRANSITIONS` set stays
 * narrower on purpose -- the three legacy values are display-only, never
 * something a new write should produce).
 */
export const ALL_FIXTURE_STATUSES = [
  "Planned",
  "Booked",
  "To Be Determined",
  "Annual Holiday",
  "Festival",
  "Lancashire Cup",
  "Cancelled",
  "Completed",
] as const

export type FixtureStatus = (typeof ALL_FIXTURE_STATUSES)[number]

/** Every value already reads correctly as its own label -- kept as an explicit map (not just the array) so a future status can gain a friendlier display name without becoming a second, drifting source of truth. */
export const FIXTURE_STATUS_LABEL: Record<FixtureStatus, string> = {
  Planned: "Planned",
  Booked: "Booked",
  "To Be Determined": "To Be Determined",
  "Annual Holiday": "Annual Holiday",
  Festival: "Festival",
  "Lancashire Cup": "Lancashire Cup",
  Cancelled: "Cancelled",
  Completed: "Completed",
}

/**
 * One badge colour per status, used everywhere a fixture's status renders
 * as a pill. "Planned" previously disagreed with itself across the app
 * (mint/success in dashboard/page.tsx vs amber/pending in
 * fixture-table-row.tsx and fixture-status-control.tsx) -- amber wins here
 * since a Planned fixture is, by definition, not yet confirmed, matching
 * the majority existing usage. The three legacy CSV-import-only statuses
 * share one neutral style -- they are historical record-keeping values,
 * not an active lifecycle state a user is meant to react to.
 */
export const FIXTURE_STATUS_BADGE_CLASS: Record<FixtureStatus, string> = {
  Planned: "bg-amber-500/12 text-amber-700",
  Booked: "bg-pitch-600/12 text-forest-800",
  "To Be Determined": "bg-amber-500/12 text-amber-700",
  "Annual Holiday": "bg-ink/8 text-ink/50",
  Festival: "bg-ink/8 text-ink/50",
  "Lancashire Cup": "bg-ink/8 text-ink/50",
  Cancelled: "bg-destructive/10 text-destructive",
  Completed: "bg-pitch-600/12 text-forest-800",
}
