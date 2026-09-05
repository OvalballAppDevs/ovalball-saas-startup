/**
 * Calendar Pitch Allocation -- shared types. See lib/pitch-allocation/auto-allocate.ts
 * for the deterministic proposal algorithm and app/(app)/calendar/pitch-allocation/actions.ts
 * for how these are populated from the canonical `fixtures` table (never a
 * second source of truth -- see that file's own doc comment).
 */

export interface PitchOption {
  id: string
  displayName: string
  active: boolean
  venueId: string | null
  sizeCategory: "mini" | "reduced" | "full" | null
  /** Section 41-47: how many fixtures this physical pitch can genuinely host at the same time. 1 (the normal case) preserves today's exactly-one-booking-at-a-time behaviour. */
  laneCount: number
}

export interface AllocationFixture {
  fixtureId: string
  /** The real canonical team_id whose club owns this pitch-allocation board -- always the HOME side (Section 6: home fixtures only). */
  homeTeamId: string
  /** Canonical label via lib/teams/compact-label.ts, alias-aware (Section 12). */
  homeTeamLabel: string
  opponentLabel: string
  category: string
  ageGroup: string | null
  gender: string | null
  status: string
  kickoffDate: string
  kickoffTime: string | null
  venueId: string | null
  pitchId: string | null
  /** Set once resolved from fixture_scheduling_rules -- null means "could not resolve a rule at all" (never invented). */
  durationMinutes: number | null
  durationConfidence: "confirmed" | "unresolved" | null
  requiredPitchSize: "mini" | "reduced" | "full" | null
  /** True when this fixture negotiates kickoff changes with a real, active opponent club (Section 64/65's discovered rule) -- a time drag on this fixture PROPOSES rather than immediately applies. */
  requiresOpponentAgreement: boolean
  isSharedGroup: boolean
  schedulingGroupId: string | null
  /** The AWAY side's own Mini-Rugby Group, when the opponent is genuinely a shared group rather than one team (group-vs-group pass) -- null otherwise. */
  awaySchedulingGroupId: string | null
  /** Real component team_ids physically committed on each side, via the canonical effective-team resolver (Section 4/34) -- a singleton array for an ordinary team, the group's real members for a Mini-Rugby Group side. Additive: exposed for future commitment/capacity/Side-Project-1 consumers, not currently read by detectConflicts (which is pitch/time-based, not team-identity-based). */
  effectiveHomeTeamIds: string[]
  effectiveAwayTeamIds: string[]
}

/**
 * Section 79: a confirmed tournament this club is hosting occupies real
 * pitch time but lives in its own `tournaments` table, never in
 * `fixtures` -- so it is invisible to autoAllocate/detectConflicts unless
 * surfaced separately. Never silently treated as "the day is free".
 */
export interface TournamentSummary {
  id: string
  hostTeamLabel: string
  pitchId: string | null
  pitchDisplayName: string | null
  venueName: string | null
  status: string
}

export type ConflictSeverity = "hard" | "warning"

export interface AllocationConflict {
  fixtureId: string
  severity: ConflictSeverity
  reason: string
}

export interface ProposedPlacement {
  fixtureId: string
  pitchId: string | null
  kickoffTime: string | null
  conflict: AllocationConflict | null
}

export interface ClubSchedulingPolicy {
  weekdayEarliestKickoff: string
  weekendYouthEarliest: string
  weekendYouthLatest: string
  weekendSeniorEarliest: string
  weekendSeniorLatest: string
  turnaroundMinutes: number
  /** Section 5: club opted in to auto-generating a review proposal on page load. */
  autoAllocateHomeFixtures: boolean
  /** Section 31: buffer minutes reserved before/after a fixture's own kickoff-to-final-whistle window, distinct from turnaroundMinutes (the gap between two different fixtures). */
  warmUpMinutes: number
  packUpMinutes: number
}

export const DEFAULT_SCHEDULING_POLICY: ClubSchedulingPolicy = {
  weekdayEarliestKickoff: "18:00",
  weekendYouthEarliest: "09:00",
  weekendYouthLatest: "13:00",
  weekendSeniorEarliest: "13:00",
  weekendSeniorLatest: "17:30",
  turnaroundMinutes: 15,
  autoAllocateHomeFixtures: false,
  warmUpMinutes: 0,
  packUpMinutes: 0,
}
