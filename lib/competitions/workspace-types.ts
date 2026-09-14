/**
 * THE COMPETITION CREATOR'S WORKSPACE, AS THE BROWSER SEES IT.
 *
 * One shape, loaded once per step by lib/competitions/load-workspace.ts from
 * the canonical Competition Match records. Nothing here is a second copy of
 * a fixture: a match's linked fixtures are ids, and its lifecycle and
 * verification state are the database's.
 */

import type { ExistingCommitment } from "@/lib/fixtures/conflicts"

export type CompetitionFormat = "league" | "knockout" | "league_knockout"

export interface WorkspaceParticipant {
  id: string
  slot: number
  seed: number | null
  status: string
  clubDirectoryId: string
  clubName: string
  /** Set when the club is on Ovalball. */
  clubId: string | null
  teamId: string | null
  /** The entered team's canonical age and category, for the eligibility check. */
  teamTypeId?: string | null
  teamLabel: string | null
  homeGround: string | null
  lat: number | null
  lng: number | null
}

export interface LeagueSettings {
  allocation?: "random" | "distance" | "manual"
  groupCount?: number
  seedNumber?: number
  schedule?: "single" | "double" | "custom"
  perTeam?: number
  firstDate?: string | null
  everyDays?: number
  kickoff?: string | null
  points?: { win: number; draw: number; loss: number }
}

export interface KnockoutSettings {
  seeding?: "random" | "seeded" | "manual"
  seedNumber?: number
  legs?: 1 | 2
  thirdPlace?: boolean
  qualifiersPerGroup?: number
  qualifierPairing?: "winners_seeded" | "random" | "manual"
  avoidSameGroup?: boolean
  homeAllocation?: "first_drawn" | "seeded" | "random" | "neutral" | "manual"
  finalVenueMode?: "home" | "neutral" | "later"
  finalVenueText?: string | null
  firstDate?: string | null
  everyDays?: number
  kickoff?: string | null
}

export interface WorkspaceGroup {
  id: string
  name: string
  sortOrder: number
  members: string[]
}

export interface WorkspaceStage {
  id: string
  kind: "league" | "knockout"
  name: string
  sortOrder: number
  settings: LeagueSettings & KnockoutSettings
  groups: WorkspaceGroup[]
  rounds: { roundNumber: number; name: string | null; roundDate: string | null }[]
}

export interface WorkspaceVerification {
  id: string
  participantId: string
  status: string
  message: string | null
  proposedDate: string | null
  proposedKickoff: string | null
  proposedVenueId: string | null
  proposedPitchId: string | null
}

export type SlotSourceRecord = { winner_of?: string; loser_of?: string; qualifier?: { group_index: number; position: number }; label?: string } | null

export interface WorkspaceMatch {
  id: string
  stageId: string
  groupId: string | null
  roundNumber: number | null
  bracketSlot: number | null
  homeParticipantId: string | null
  awayParticipantId: string | null
  homeSource: SlotSourceRecord
  awaySource: SlotSourceRecord
  matchDate: string | null
  kickoffTime: string | null
  venueId: string | null
  venueText: string | null
  pitchId: string | null
  status: string
  verificationState: string
  homeScore: number | null
  awayScore: number | null
  winnerParticipantId: string | null
  isPublic: boolean
  notes: string | null
  syncError: string | null
  linkedFixtureIds: string[]
  verifications: WorkspaceVerification[]
}

export interface CompetitionWorkspace {
  editionId: string
  competitionId: string
  name: string
  slug: string
  rugbyCode: "union" | "league"
  seasonName: string | null
  season: { startsOn: string; endsOn: string; preSeasonStartsOn: string | null } | null
  format: CompetitionFormat | null
  teamCount: number | null
  organiserName: string | null
  organiserClubId: string | null
  canonicalTeamTypeId: string | null
  teamTypes: { id: string; label: string }[]
  participants: WorkspaceParticipant[]
  stages: WorkspaceStage[]
  matches: WorkspaceMatch[]
  commitments: ExistingCommitment[]
  venues: { id: string; name: string; clubId: string; isDefaultHome: boolean }[]
  pitches: { id: string; name: string; venueId: string | null }[]
}

export const CREATOR_STEPS = ["details", "participants", "groups", "fixtures", "knockout", "issue"] as const
export type CreatorStep = (typeof CREATOR_STEPS)[number]

export const CREATOR_STEP_LABEL: Record<CreatorStep, string> = {
  details: "Details",
  participants: "Participants",
  groups: "Groups",
  fixtures: "Fixtures",
  knockout: "Knockout",
  issue: "Issue",
}

export const MATCH_STATUS_WORD: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  issued: "Issued",
  confirmed: "Confirmed",
  change_requested: "Change Requested",
  declined: "Declined",
  completed: "Completed",
  cancelled: "Cancelled",
  postponed: "Postponed",
}

export function participantLabel(p: WorkspaceParticipant | undefined | null): string {
  if (!p) return "TBC"
  return p.teamLabel ? `${p.clubName} ${p.teamLabel}` : p.clubName
}

/** A draft match as the Creator writes it (replace_competition_draft_matches). */
export interface DraftMatchInput {
  id?: string
  groupId?: string | null
  roundNumber: number | null
  bracketSlot?: number | null
  homeParticipantId: string | null
  awayParticipantId: string | null
  homeSource?: SlotSourceRecord
  awaySource?: SlotSourceRecord
  matchDate: string | null
  kickoffTime: string | null
  venueId?: string | null
  venueText?: string | null
  pitchId?: string | null
}
