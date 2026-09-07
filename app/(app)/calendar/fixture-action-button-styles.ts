/**
 * Shared button treatment for the Calendar fixture detail Sheet's action
 * row (Edit / Open Fixture / Message Club / Cancel Fixture / Delete
 * Fixture / Directions) -- one consistent, slightly-raised "3D" look
 * across every action regardless of which file renders it (week-board.tsx/
 * month-view.tsx/mobile-agenda.tsx render Edit/Open Fixture/Directions
 * directly; fixture-lifecycle-panel.tsx renders Message Club/Cancel/
 * Delete), so the whole row reads as ONE designed button group instead of
 * several ad hoc styles bolted together.
 */
const BASE =
  "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none transition-all duration-100 active:translate-y-px focus-visible:ring-2 focus-visible:ring-pitch-400"

export const FIXTURE_ACTION_BUTTON_PRIMARY = `${BASE} border-forest-950 bg-forest-950 text-white shadow-[0_2px_0_0_rgba(6,42,29,1)] hover:bg-forest-900 active:shadow-none`

export const FIXTURE_ACTION_BUTTON_SECONDARY = `${BASE} border-ink/15 bg-white text-ink/70 shadow-[0_2px_0_0_rgba(20,20,20,0.08)] hover:border-ink/30 hover:text-ink active:shadow-none`

export const FIXTURE_ACTION_BUTTON_DESTRUCTIVE = `${BASE} border-destructive/30 bg-white text-destructive-text shadow-[0_2px_0_0_rgba(220,38,38,0.18)] hover:bg-destructive/5 active:shadow-none`

/** The grid every one of these buttons lives in -- even columns, consistent gaps, never a ragged flex-wrap. */
export const FIXTURE_ACTION_BUTTON_GRID = "grid grid-cols-2 gap-2.5"
