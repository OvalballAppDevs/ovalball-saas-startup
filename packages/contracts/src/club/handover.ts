import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "../agenda/team-identity"
import { loadStaffPlayers } from "../team/players"

export { YOUTH_AGE_GROUPS, type YouthAgeGroup } from "../teams/age-groups"

type Client = SupabaseClient<Database>

/**
 * SEASON HANDOVER -- THE SHARED CONTRACT (CA-M11.1).
 *
 * PREPARE -> DECIDE -> REVIEW -> APPLY. Everything on the board up to Apply records decisions; none of
 * it changes a team, a membership or a season identity. `apply_season_handover` is the single mutation
 * boundary, and it runs server-side in one transaction rather than being sequenced from a client.
 *
 * WHAT THIS FILE IS. One read model (`readHandoverBoard`) that both the website's `/club/rollover`
 * page and the phone's Admin Centre build from; every mutation as a thin wrapper over the same RPC,
 * with the same argument names, that the web's server actions call; the capability keys the web
 * checks; and the pure presentation rules -- the status precedence, the filters, the tense of a
 * consequence, the audit wording -- stated once so the two clients cannot drift.
 *
 * WHAT THIS FILE IS NOT. It computes no progression and no age grade: `internal.next_age_grade_for`
 * is the sole authority and the clients only display what the server returned. It decides no
 * authority: `internal.can` inside each SECURITY DEFINER function does, every time; the capability
 * probe here only decides what is OFFERED. It mentions no season date that did not come from the
 * canonical `public.seasons` register.
 */

// ---------------------------------------------------------------------------
// Authority -- the keys the web checks, probed through the one engine
// ---------------------------------------------------------------------------

export const HANDOVER_CAPABILITIES = {
  /** Reach the board, prepare, decide teams, undo, resolve flags, read every handover function. Club Admin and Fixture Secretary. */
  prepare: "team.handover.prepare",
  /** Run the handover. Club Admin only, non-delegable, declared recent-authenticator in the catalogue. */
  apply: "team.handover.apply",
  /** Choose, clear and plan a player's placement; place or release a graduating player. */
  place: "team.graduation.place",
  /** The fold and graduate branches inside a team decision. */
  lifecycle: "team.lifecycle.manage",
  /** Progress a Mini-Rugby Group into the next season. */
  miniRugbyGroups: "team.mini_rugby_group.manage",
} as const

export interface HandoverCapabilities {
  prepare: boolean
  apply: boolean
  place: boolean
  lifecycle: boolean
  miniRugbyGroups: boolean
}

export function noHandoverCapabilities(): HandoverCapabilities {
  return { prepare: false, apply: false, place: false, lifecycle: false, miniRugbyGroups: false }
}

/** One `my_capabilities` read at club scope -- exactly how the Admin Centre decides its sections. */
export async function readHandoverCapabilities(supabase: Client, clubId: string): Promise<HandoverCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return {
    prepare: allowed.has(HANDOVER_CAPABILITIES.prepare),
    apply: allowed.has(HANDOVER_CAPABILITIES.apply),
    place: allowed.has(HANDOVER_CAPABILITIES.place),
    lifecycle: allowed.has(HANDOVER_CAPABILITIES.lifecycle),
    miniRugbyGroups: allowed.has(HANDOVER_CAPABILITIES.miniRugbyGroups),
  }
}

// ---------------------------------------------------------------------------
// The board's sections, its lifecycle words and its audit vocabulary
// ---------------------------------------------------------------------------

/** The board's five sections. On the web they are routes (`?section=`); on the phone they are screens. */
export const HANDOVER_SECTIONS = ["overview", "teams", "players", "attention", "apply"] as const
export type HandoverSection = (typeof HANDOVER_SECTIONS)[number]

export function resolveHandoverSection(value: string | undefined): HandoverSection {
  return (HANDOVER_SECTIONS as readonly string[]).includes(value ?? "") ? (value as HandoverSection) : "overview"
}

export const HANDOVER_SECTION_LABELS: Record<HandoverSection, string> = {
  overview: "Overview",
  teams: "Teams",
  players: "Players",
  attention: "Needs Attention",
  apply: "Apply & Audit",
}

export type HandoverState = "PREPARING" | "REVIEW_REQUIRED" | "READY" | "APPLYING" | "COMPLETED"

export const HANDOVER_STATE_WORDS: Record<HandoverState, string> = {
  PREPARING: "Preparing",
  REVIEW_REQUIRED: "Review required",
  READY: "Ready to apply",
  APPLYING: "Applying",
  COMPLETED: "Completed",
}

export function handoverStateWord(state: string): string {
  return (HANDOVER_STATE_WORDS as Record<string, string>)[state] ?? state
}

export const HANDOVER_EVENT_WORDS: Record<string, string> = {
  HANDOVER_TEAM_DECISION_RECORDED: "Team decision recorded",
  HANDOVER_TEAM_DECISION_WITHDRAWN: "Team decision withdrawn",
  HANDOVER_MIXED_SPLIT_DECIDED: "Mixed age-grade split decided",
  HANDOVER_TEAM_PLANNED: "Team added to next season's plan",
  HANDOVER_PLACEMENT_DECIDED: "Player placement chosen",
  HANDOVER_PLACEMENT_DECIDED_PLANNED: "Player placed into a planned team",
  HANDOVER_PLACEMENT_WITHDRAWN: "Player placement withdrawn",
  HANDOVER_PLACEMENT_APPLIED: "Player moved",
  HANDOVER_TEAM_PROGRESSED: "Team progressed",
  HANDOVER_TEAM_CREATED: "Team created",
  HANDOVER_TEAM_REACTIVATED: "Team reactivated",
  SEASON_HANDOVER_APPLIED: "Season Handover applied",
  // Recorded by the pre-staged model, which created the team during review.
  SUCCESSOR_TEAM_CREATED_AT_HANDOVER: "Team created (before the staged model)",
  U6_INTAKE_TEAM_CREATED: "U6 intake team created",
  U6_INTAKE_TEAM_REACTIVATED: "U6 intake team reactivated",
  GRADUATED_AT_HANDOVER: "Cohort graduated",
  mixed_boundary_boys_continuation: "Mixed cohort continued as Boys",
  mixed_boundary_girls_team_created: "Girls team created",
  folded: "Team folded",
}

export function handoverEventWord(event: string): string {
  return HANDOVER_EVENT_WORDS[event] ?? event
}

// ---------------------------------------------------------------------------
// Consequences -- the transition ledger, whose tense the server decides
// ---------------------------------------------------------------------------

export type HandoverConsequenceKind = "progress" | "graduate" | "fold" | "plan" | "created" | "reactivated" | "undecided"

export interface HandoverConsequence {
  kind: HandoverConsequenceKind
  fromLabel: string | null
  toLabel: string | null
  note: string | null
  isApplied: boolean
}

export interface ConsequenceSentence {
  /** The team the sentence is about. */
  subject: string
  /** What happens, or happened, to it -- the server's tense. */
  verb: string
  /** A second team name, where the verb takes one ("will become U13"). */
  object: string | null
  /** True for a cohort nobody has decided yet. */
  needsDecision: boolean
}

/**
 * One plain statement per consequence, in the FUTURE tense until the handover runs and the past tense
 * after -- the same words on both clients, because the tense comes from `is_applied`.
 */
export function consequenceSentence(c: HandoverConsequence): ConsequenceSentence {
  const applied = c.isApplied
  switch (c.kind) {
    case "undecided":
      return { subject: c.fromLabel ?? "A team", verb: c.toLabel ? `would normally become ${c.toLabel}` : "has no proposed destination", object: null, needsDecision: true }
    case "progress":
      return { subject: c.fromLabel ?? "A team", verb: applied ? "became" : "will become", object: c.toLabel, needsDecision: false }
    case "graduate":
      return { subject: c.fromLabel ?? "A team", verb: applied ? "completed the youth pathway" : "completes the youth pathway", object: null, needsDecision: false }
    case "fold":
      return { subject: c.fromLabel ?? "A team", verb: applied ? "did not continue" : "will not continue", object: null, needsDecision: false }
    case "reactivated":
      return { subject: c.toLabel ?? "A team", verb: applied ? "was reactivated" : "will be reactivated", object: null, needsDecision: false }
    default:
      return { subject: c.toLabel ?? "A team", verb: applied ? "was created" : "will be created", object: null, needsDecision: false }
  }
}

export interface ConsequenceCounts {
  progressing: number
  /** `plan`, `created` AND `reactivated`: after Apply the planned rows come back as created, and counting only planned ones would report a completed handover as having created nothing. */
  creating: number
  graduating: number
  folding: number
  undecided: number
}

export function consequenceCounts(consequences: HandoverConsequence[]): ConsequenceCounts {
  return {
    progressing: consequences.filter((c) => c.kind === "progress").length,
    creating: consequences.filter((c) => c.kind === "plan" || c.kind === "created" || c.kind === "reactivated").length,
    graduating: consequences.filter((c) => c.kind === "graduate").length,
    folding: consequences.filter((c) => c.kind === "fold").length,
    undecided: consequences.filter((c) => c.kind === "undecided").length,
  }
}

/** The Overview's two lists: cohorts already at the club, and the sides it will run (or now runs). */
export function splitConsequences(consequences: HandoverConsequence[]): { teamLines: HandoverConsequence[]; newLines: HandoverConsequence[] } {
  const isNew = (c: HandoverConsequence) => c.kind === "plan" || c.kind === "created" || c.kind === "reactivated"
  return { teamLines: consequences.filter((c) => !isNew(c)), newLines: consequences.filter(isNew) }
}

/** The confirmation dialog's lines, restating each consequence in words before anything happens. */
export function applyConfirmationLines(counts: ConsequenceCounts): string[] {
  const lines = [`${counts.progressing} team${counts.progressing === 1 ? "" : "s"} move up an age grade, keeping their history.`]
  if (counts.creating > 0) lines.push(`${counts.creating} team${counts.creating === 1 ? "" : "s"} will be created.`)
  if (counts.graduating > 0) {
    lines.push(`${counts.graduating} cohort${counts.graduating === 1 ? "" : "s"} complete the youth pathway. Their players move to the club's holding list — no senior team is assigned automatically.`)
  }
  if (counts.folding > 0) lines.push(`${counts.folding} team${counts.folding === 1 ? "" : "s"} will not continue. Their fixtures and results stay available.`)
  lines.push("Players move to the teams recorded against them.")
  return lines
}

export const APPLY_IRREVERSIBLE_SENTENCE = "This cannot be undone from the handover board."

/** Why applying is offered to some reviewers and not others -- the web's own sentence. */
export const APPLY_AUTHORITY_SENTENCE = "Reviewing a handover and running it are different authorities. Only a Club Admin can apply it."

// ---------------------------------------------------------------------------
// Blockers -- everything standing between the handover and Apply
// ---------------------------------------------------------------------------

export type HandoverBlockerKind = "season" | "team" | "collision" | "player" | "dispensation" | "stale"

export interface HandoverBlocker {
  kind: HandoverBlockerKind
  subject: string
  detail: string
  /** The stable id of whoever or whatever needs the decision. Never a display string. */
  subjectId: string | null
  /** True when the item is waiting on protected player information only a guardian can supply. */
  needsPlayerInformation: boolean
}

/**
 * The one blocker the club is not permitted to clear itself. Gender is protected identity information,
 * and running a team is not the authority to record it -- so the board offers "ask their guardian".
 * The server does not yet return a reason code, so this matches its sentence; the web did the same.
 */
export const MISSING_PATHWAY_DETAIL = "which pathway this player is registered in"

export function needsPlayerInformation(kind: string, subjectId: string | null, detail: string | null): boolean {
  return kind === "player" && subjectId !== null && (detail ?? "").includes(MISSING_PATHWAY_DETAIL)
}

export type BlockerDestination = { section: "seasons"; label: string } | { section: HandoverSection; label: string }

/** Where a blocker is decided. Each client maps the section to its own route; "seasons" is Site Admin's register. */
export function blockerDestination(kind: HandoverBlockerKind): BlockerDestination {
  switch (kind) {
    case "season":
      return { section: "seasons", label: "Open Seasons" }
    case "team":
      return { section: "teams", label: "Decide in Teams" }
    case "collision":
      return { section: "teams", label: "Resolve in Teams" }
    default:
      return { section: "players", label: "Review in Players" }
  }
}

// ---------------------------------------------------------------------------
// Teams -- proposals, decisions and the rules the Teams section applies
// ---------------------------------------------------------------------------

export type RugbyCode = "union" | "league"
export type TeamDecision = "pending" | "confirmed" | "folded" | "deferred" | "graduated"
export type TeamDecisionAction = "confirm" | "adjust" | "fold" | "defer" | "graduate"

export interface RolloverTeamProposalRow {
  id: string
  teamId: string
  teamDisplayName: string
  teamGender: "boys" | "girls" | "mixed" | "mens" | "womens" | null
  teamSquadDesignation: string | null
  currentAgeGroup: string
  proposedAgeGroup: string | null
  requiresManualChoice: boolean
  isMixedBoundary: boolean
  decision: TeamDecision
  decidedAgeGroup: string | null
  girlsTeamCreated: boolean | null
  createGirlsTeam: boolean | null
  foldReason: string | null
  /** Once the handover has run, its decisions are history and cannot be changed here. */
  applied: boolean
}

export interface RolloverGroupFlagRow {
  id: string
  displayTag: string
  reason: string
  resolved: boolean
}

export interface RolloverBatch {
  id: string
  fromSeasonName: string | null
  toSeasonName: string
  createdAt: string
  isApplied: boolean
  proposals: RolloverTeamProposalRow[]
  groupFlags: RolloverGroupFlagRow[]
}

export interface SeasonOption {
  id: string
  name: string
}

/** Grouped by the age grade they are at TODAY, squads under their primary, ages in numeric order. */
export function groupProposalsByAgeGrade(proposals: RolloverTeamProposalRow[]): { age: string; rows: RolloverTeamProposalRow[] }[] {
  const byAge = new Map<string, RolloverTeamProposalRow[]>()
  for (const p of proposals) {
    const list = byAge.get(p.currentAgeGroup) ?? []
    list.push(p)
    byAge.set(p.currentAgeGroup, list)
  }
  return [...byAge.entries()]
    .map(([age, rows]) => ({ age, rows: [...rows].sort((a, b) => (a.teamSquadDesignation ?? "").localeCompare(b.teamSquadDesignation ?? "")) }))
    .sort((a, b) => a.age.localeCompare(b.age, undefined, { numeric: true }))
}

/**
 * Bulk confirm records decisions and nothing else. Anything exceptional -- a Mixed split, a cohort with
 * no automatic successor -- is deliberately left out: those are the cases a human is here to answer.
 */
export function bulkConfirmCandidates(proposals: RolloverTeamProposalRow[]): RolloverTeamProposalRow[] {
  return proposals.filter((p) => p.decision === "pending" && !p.requiresManualChoice && !p.isMixedBoundary && Boolean(p.proposedAgeGroup))
}

/** There is no established next age grade for this cohort in this code, so Ovalball will not invent one. */
export function noAutomaticSuccessor(p: Pick<RolloverTeamProposalRow, "requiresManualChoice" | "proposedAgeGroup">): boolean {
  return p.requiresManualChoice && !p.proposedAgeGroup
}

/** The decision a team action records, before the server has been re-read. */
export function decisionAfter(action: TeamDecisionAction): TeamDecision {
  return action === "confirm" || action === "adjust" ? "confirmed" : action === "fold" ? "folded" : action === "graduate" ? "graduated" : "deferred"
}

/** "Decided: becomes U13" until the handover runs, "Became U13" after. */
export function teamDecisionLabel(decision: TeamDecision, decidedAgeGroup: string | null, applied: boolean): string {
  switch (decision) {
    case "confirmed":
      return applied ? `Became ${decidedAgeGroup ?? "its next age grade"}` : `Decided: becomes ${decidedAgeGroup ?? "its next age grade"}`
    case "folded":
      return applied ? "Not continuing" : "Decided: will not continue"
    case "graduated":
      return applied ? "Youth pathway complete" : "Decided: youth pathway complete"
    case "deferred":
      return "Deferred — still needs a decision"
    default:
      return "Needs a decision"
  }
}

/** The Mixed -> U12 structural transition, once answered. */
export function mixedBoundaryLabel(p: Pick<RolloverTeamProposalRow, "currentAgeGroup" | "proposedAgeGroup" | "applied">, girlsPlanned: boolean | null): string {
  const base = `${p.currentAgeGroup} Mixed → ${p.proposedAgeGroup ?? "next"} Boys`
  if (girlsPlanned) return `${base} · ${p.proposedAgeGroup ?? ""} Girls ${p.applied ? "created" : "will be created"}`.replace("  ", " ")
  return `${base} · no Girls team`
}

/** `${canonical label}${squad ? " " + squad : ""}` -- stated once instead of in two TypeScript files and five SQL functions. */
export function plannedTeamLabel(canonicalLabel: string | null, squadDesignation: string | null): string {
  return `${canonicalLabel ?? "Team"}${squadDesignation ? ` ${squadDesignation}` : ""}`
}

// ---------------------------------------------------------------------------
// Players -- proposals, status precedence and filters
// ---------------------------------------------------------------------------

export type PlayerReviewState = "READY" | "NEEDS_ATTENTION" | "BLOCKED"

export interface PlayerProposalRow {
  proposalId: string
  playerId: string
  playerName: string
  /** As the team stands now -- where the player is today. */
  currentTeamName: string
  /** The operational squad they normally land in next season, e.g. "U16 B". */
  normalPlacementName: string | null
  /** What the club chose, when that differs from normal. */
  selectedPlacementName: string | null
  /** Their age grade next season. Supporting information, not the placement. */
  regulatoryAgeLabel: string | null
  reviewState: PlayerReviewState
  allocationStatus: string | null
  movementRequirement: string | null
  dispensationRequired: boolean
  reason: string | null
  placementApplied: boolean
  /** True when the club runs no team at the player's normal age grade. */
  normalTeamMissing: boolean
  /** The club has decided to run the team this player needs. */
  plannedTeamName: string | null
  /** False once Apply has created it -- the board must stop saying "will be created". */
  plannedTeamPending: boolean
  /** A human chose this placement, so it can be put back to the normal one. */
  placementChosen: boolean
}

export type PlayerFilter = "all" | "attention" | "approval" | "holding" | "ready"

export const PLAYER_FILTERS: { key: PlayerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "approval", label: "Awaiting approval" },
  { key: "holding", label: "Club holding" },
  { key: "ready", label: "Ready" },
]

/** Domain states become rugby language. A club administrator should never meet NORMAL_PLACEMENT or a canonical type id. */
export function playerStatusLabel(row: PlayerProposalRow): string {
  if (row.placementApplied) return "Placed"
  if (row.plannedTeamName && row.plannedTeamPending) return "Team planned"
  if (row.allocationStatus === "DOB_REQUIRED") return "Date of birth needed"
  if (row.allocationStatus === "CLUB_HOLDING") return "Club holding"
  if (row.reviewState === "BLOCKED") return "Not permitted"
  if (row.dispensationRequired || row.movementRequirement === "external_approval_required") return "Governing approval"
  if (row.reviewState === "NEEDS_ATTENTION") return "Needs attention"
  return "Ready"
}

export type PlayerStatusTone = "positive" | "neutral" | "negative" | "caution"

/** Status is carried by the word. The tint is a third signal after the label and the row's own explanation, never the only one. */
export function playerStatusTone(row: PlayerProposalRow): PlayerStatusTone {
  const label = playerStatusLabel(row)
  if (label === "Ready" || label === "Placed" || label === "Team planned") return "positive"
  if (label === "Club holding") return "neutral"
  if (label === "Not permitted") return "negative"
  return "caution"
}

export function matchesPlayerFilter(row: PlayerProposalRow, filter: PlayerFilter): boolean {
  if (filter === "all") return true
  if (filter === "ready") return row.reviewState === "READY"
  if (filter === "holding") return row.allocationStatus === "CLUB_HOLDING"
  if (filter === "approval") return row.dispensationRequired || row.movementRequirement === "external_approval_required"
  return row.reviewState !== "READY"
}

/** What the Selected column shows: the choice, else normal, else the planned side. */
export function selectedPlacementText(row: PlayerProposalRow): { text: string; planned: boolean } {
  if (row.selectedPlacementName) return { text: row.selectedPlacementName, planned: false }
  if (row.normalPlacementName) return { text: row.normalPlacementName, planned: false }
  if (row.plannedTeamName) return { text: row.plannedTeamName, planned: row.plannedTeamPending }
  return { text: "No team yet", planned: false }
}

export interface PlacementOption {
  /** Null for a team the club has decided to run but which does not exist yet. */
  teamId: string | null
  plannedId: string | null
  /** The team as it will be in the season being decided, not as it is called today. */
  displayName: string
  ageGroup: string | null
  squadDesignation: string | null
  isNormal: boolean
  isSelected: boolean
  isPlanned: boolean
}

export interface PlacementVerdict {
  overrideKind: "SAME_AGE_SQUAD" | "AGE_GRADE_CHANGE" | null
  movementRequirement: "permitted" | "team_approval_only" | "external_approval_required" | "not_permitted" | null
  reviewState: PlayerReviewState
  reason: string | null
  dispensationRequired: boolean
}

/** The verdict the client states for a planned placement -- the server records it and returns nothing to display. */
export function plannedPlacementVerdict(optionName: string, playerName: string): PlacementVerdict {
  return {
    overrideKind: null,
    movementRequirement: null,
    reviewState: "READY",
    reason: `${optionName} will be created when this handover is applied, and ${playerName.split(" ")[0]} joins it then.`,
    dispensationRequired: false,
  }
}

// ---------------------------------------------------------------------------
// Graduation queue and Mini-Rugby Groups
// ---------------------------------------------------------------------------

export interface GraduationTargetTeamOption {
  id: string
  displayName: string
}

export interface GraduationQueueRow {
  id: string
  playerName: string
  previousTeamName: string
}

export interface MiniRugbyGroupTeamOption {
  teamId: string
  displayName: string
  projectedAgeGroup: string | null
}

export interface MiniRugbyGroupRow {
  id: string
  displayTag: string
  alias: string | null
  teams: MiniRugbyGroupTeamOption[]
  /** Set once a next-season group already exists for this group's teams -- the wizard shows its result instead of offering the actions again. */
  alreadyCreatedTag: string | null
}

/** The tag a freshly created next-season group is described by: its teams' projected age grades. */
export function nextSeasonGroupTag(group: MiniRugbyGroupRow, teamIds: Iterable<string>): string {
  const chosen = new Set(teamIds)
  const tag = group.teams
    .filter((t) => chosen.has(t.teamId))
    .map((t) => t.projectedAgeGroup)
    .filter(Boolean)
    .join("/")
  return tag || "the new group"
}

// ---------------------------------------------------------------------------
// The read model -- one board, built the same way on both clients
// ---------------------------------------------------------------------------

export interface HandoverSeasonOption extends SeasonOption {
  /** From the register. Null where Site Admin has recorded no pre-season. */
  preSeasonStartsOn: string | null
}

export interface HandoverReadiness {
  teamsTotal: number
  teamsDecided: number
  teamsPending: number
  teamsProgressing: number
  teamsFolding: number
  teamsGraduating: number
  plannedTeams: number
  newIntakeTeams: number
  playersTotal: number
  playersReady: number
  playersNeedsAttention: number
  playersBlocked: number
  playersMissingDob: number
  playersClubHolding: number
  dispensationsPending: number
  blockerCount: number
  isReady: boolean
  isApplied: boolean
  decisionsRevision: number
}

export interface HandoverAuditEntry {
  at: string
  event: string
  actorName: string
}

export interface PlannedTeamNote {
  label: string
  note: string
}

export interface HandoverBoard {
  club: { id: string; name: string | null; rugbyCode: RugbyCode }
  /** The register's row containing today for this code, so the empty state can name it. */
  currentSeason: SeasonOption | null
  /** Every real season for this code starting today or later, soonest first. */
  upcomingSeasons: HandoverSeasonOption[]
  /** The board is bound to the FIRST upcoming season; Prepare may choose any. */
  nextSeason: HandoverSeasonOption | null
  /** The club's handover to `nextSeason`, when one has been prepared. */
  rollover: { id: string; decisionsRevision: number; appliedAt: string | null; toSeasonId: string | null } | null
  state: HandoverState
  readiness: HandoverReadiness | null
  blockers: HandoverBlocker[]
  consequences: HandoverConsequence[]
  audit: HandoverAuditEntry[]
  /** Every handover batch this club has, newest first -- history stays visible. */
  batches: RolloverBatch[]
  playerProposals: PlayerProposalRow[]
  /** Blockers already resolved by a decision to add a team. */
  plannedResolved: PlannedTeamNote[]
  graduationQueue: GraduationQueueRow[]
  graduationTargets: GraduationTargetTeamOption[]
  miniRugbyGroups: MiniRugbyGroupRow[]
  capabilities: HandoverCapabilities
}

export interface ReadHandoverBoardOptions {
  /** "Today", ISO date. Only the query parameter -- which season contains it is the register's answer, never computed here. */
  todayIso?: string
}

export async function readHandoverBoard(supabase: Client, clubId: string, options: ReadHandoverBoardOptions = {}): Promise<HandoverBoard | null> {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10)

  const { data: club, error: clubError } = await supabase.from("clubs").select("id, club_directory(rugby_code, name)").eq("id", clubId).maybeSingle()
  if (clubError) throw clubError
  if (!club) return null
  const rugbyCode = (club.club_directory?.rugby_code ?? "union") as RugbyCode

  const [capabilities, { data: seasons, error: seasonsError }, { data: currentSeasonRow }, { data: rollovers, error: rolloversError }] = await Promise.all([
    readHandoverCapabilities(supabase, clubId),
    // is_regression_fixture rows (SQL-regression-test scaffolding) are excluded so a Club Admin can
    // never roll a real club onto a synthetic test season.
    supabase.from("seasons").select("id, name, starts_on, pre_season_starts_on, season_ref").eq("rugby_code", rugbyCode).eq("is_regression_fixture", false).gte("starts_on", todayIso).order("starts_on"),
    // The same canonical `seasons` table -- just the row containing today. Never a second season concept.
    supabase.from("seasons").select("id, name").eq("rugby_code", rugbyCode).eq("is_regression_fixture", false).lte("starts_on", todayIso).gte("ends_on", todayIso).limit(1).maybeSingle(),
    supabase
      .from("age_grade_rollovers")
      .select(
        "id, created_at, applied_at, decisions_revision, from_season_id, to_season_id, from_season:from_season_id(name), to_season:to_season_id(name), age_grade_rollover_team_proposals(id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary, decision, decided_age_group, girls_team_created, create_girls_team, fold_reason, applied_at, teams!age_grade_rollover_team_proposals_team_id_fkey(display_name, gender, squad_designation)), age_grade_rollover_group_flags(id, scheduling_group_id, reason, resolved, scheduling_groups(display_tag))"
      )
      .eq("club_id", clubId)
      // Defence in depth: generate_rollover_proposal rejects a mismatched rugby_code server-side, but
      // the board must never display a wrong-code batch even if one somehow exists.
      .eq("rugby_code", rugbyCode)
      .order("created_at", { ascending: false }),
  ])
  if (seasonsError) throw seasonsError
  if (rolloversError) throw rolloversError

  const upcomingSeasons: HandoverSeasonOption[] = (seasons ?? []).map((s) => ({ id: s.id, name: s.name, preSeasonStartsOn: s.pre_season_starts_on ?? null }))
  const nextSeason = upcomingSeasons[0] ?? null
  const currentSeason: SeasonOption | null = currentSeasonRow ? { id: currentSeasonRow.id, name: currentSeasonRow.name } : null
  const currentRollover = (rollovers ?? []).find((r) => r.to_season_id === nextSeason?.id) ?? null

  // The handover's lifecycle, its readiness and everything standing in its way all come from the
  // server, computed from live state. A board that decided any of this for itself could tell a club it
  // was ready while Apply refused.
  const [{ data: stateValue }, { data: readinessRows }, { data: blockerRows }, { data: consequenceRows }, { data: auditRows }, { data: labelRows }] = currentRollover
    ? await Promise.all([
        supabase.rpc("handover_state", { p_rollover_id: currentRollover.id }),
        supabase.rpc("rollover_readiness", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_apply_blockers", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_consequences", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_audit", { p_rollover_id: currentRollover.id }),
        supabase.rpc("handover_team_labels", { p_rollover_id: currentRollover.id }),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null }]

  // What each team will be CALLED next season, according to the decisions on this handover. The
  // season-aware projection is right everywhere else in Ovalball and wrong here: nothing is recorded
  // until Apply, so it falls back to date arithmetic and cannot know a Mixed side was decided to become Boys.
  const decidedLabelByTeam = new Map((labelRows ?? []).map((l) => [l.team_id, l.label]))

  const r = (readinessRows ?? [])[0] ?? null
  const readiness: HandoverReadiness | null = r
    ? {
        teamsTotal: r.teams_total,
        teamsDecided: r.teams_decided,
        teamsPending: r.teams_pending,
        teamsProgressing: r.teams_progressing,
        teamsFolding: r.teams_folding,
        teamsGraduating: r.teams_graduating,
        plannedTeams: r.planned_teams,
        newIntakeTeams: r.new_intake_teams,
        playersTotal: r.players_total,
        playersReady: r.players_ready,
        playersNeedsAttention: r.players_needs_attention,
        playersBlocked: r.players_blocked,
        playersMissingDob: r.players_missing_dob,
        playersClubHolding: r.players_club_holding,
        dispensationsPending: r.dispensations_pending,
        blockerCount: r.blocker_count,
        isReady: r.is_ready,
        isApplied: r.is_applied,
        decisionsRevision: r.decisions_revision,
      }
    : null

  const blockers: HandoverBlocker[] = (blockerRows ?? []).map((b) => ({
    kind: b.kind as HandoverBlockerKind,
    subject: b.subject,
    detail: b.detail,
    subjectId: b.subject_id ?? null,
    needsPlayerInformation: needsPlayerInformation(b.kind, b.subject_id ?? null, b.detail),
  }))
  const consequences: HandoverConsequence[] = (consequenceRows ?? []).map((c) => ({
    kind: c.kind as HandoverConsequenceKind,
    fromLabel: c.from_label ?? null,
    toLabel: c.to_label ?? null,
    note: c.note ?? null,
    isApplied: c.is_applied,
  }))
  const audit: HandoverAuditEntry[] = (auditRows ?? []).map((a) => ({ at: a.at, event: a.event, actorName: a.actor_name }))
  const state = ((stateValue as string | null) ?? "PREPARING") as HandoverState

  const { data: plannedTeamRows } = currentRollover
    ? await supabase.from("age_grade_rollover_planned_teams").select("id, squad_designation, origin, applied_at, created_team_id, canonical_team_types(label)").eq("rollover_id", currentRollover.id)
    : { data: null }

  // A planned team stops being planned the moment Apply creates it, and the board has to stop saying
  // "will be created" at exactly that point.
  const plannedById = new Map((plannedTeamRows ?? []).map((p) => [p.id, { label: plannedTeamLabel(p.canonical_team_types?.label ?? null, p.squad_designation), pending: p.applied_at === null }]))
  const plannedResolved: PlannedTeamNote[] = (plannedTeamRows ?? [])
    .filter((p) => p.origin === "PLAYER_PLACEMENT")
    .map((p) => ({
      label: plannedTeamLabel(p.canonical_team_types?.label ?? null, p.squad_designation),
      note: p.applied_at ? "Created by this handover." : "Will be created when this handover is applied, and the players waiting on it join then.",
    }))

  const [{ data: graduationRows }, { data: activeTeams }] = await Promise.all([
    supabase.from("player_graduation_queue").select("id, player_id, teams!player_graduation_queue_source_team_id_fkey(display_name)").eq("club_id", clubId).eq("status", "pending_placement").order("created_at"),
    supabase.from("teams").select("id, display_name").eq("club_id", clubId).eq("active", true).order("display_name"),
  ])
  const graduationPlayers = await loadStaffPlayers(supabase, (graduationRows ?? []).map((g) => g.player_id))
  const graduationQueue: GraduationQueueRow[] = (graduationRows ?? []).map((g) => ({
    id: g.id,
    playerName: graduationPlayers.get(g.player_id)?.displayName || "Unknown player",
    previousTeamName: g.teams?.display_name ?? "Unknown team",
  }))
  const graduationTargets: GraduationTargetTeamOption[] = (activeTeams ?? []).map((t) => ({ id: t.id, displayName: t.display_name }))

  // Active Mini-Rugby Groups for THIS club's CURRENT season only.
  let miniRugbyGroups: MiniRugbyGroupRow[] = []
  if (currentSeason) {
    const { data: groupRows } = await supabase.from("scheduling_groups").select("id, display_tag, alias, scheduling_group_members(team_id, teams(display_name))").eq("club_id", clubId).eq("season_id", currentSeason.id).eq("active", true)
    const groups = groupRows ?? []
    const identityPairs = nextSeason ? groups.flatMap((g) => g.scheduling_group_members.map((m) => ({ teamId: m.team_id, seasonId: nextSeason.id }))) : []
    const nextSeasonIdentities = await loadTeamIdentitiesForSeason(supabase, identityPairs)
    const { data: nextSeasonGroupRows } = nextSeason
      ? await supabase.from("scheduling_groups").select("display_tag, scheduling_group_members(team_id)").eq("club_id", clubId).eq("season_id", nextSeason.id)
      : { data: null }
    const alreadyProgressedTeamIds = new Set((nextSeasonGroupRows ?? []).flatMap((g) => g.scheduling_group_members.map((m) => m.team_id)))
    const alreadyCreatedTagByTeam = new Map(
      (nextSeasonGroupRows ?? []).filter((g) => g.scheduling_group_members.length > 0).flatMap((g) => g.scheduling_group_members.map((m) => [m.team_id, g.display_tag] as const))
    )
    miniRugbyGroups = groups.map((g) => ({
      id: g.id,
      displayTag: g.display_tag,
      alias: g.alias,
      teams: g.scheduling_group_members.map((m) => ({
        teamId: m.team_id,
        displayName: m.teams?.display_name ?? "Unknown team",
        projectedAgeGroup: nextSeason ? (nextSeasonIdentities.get(teamIdentityKey(m.team_id, nextSeason.id))?.ageGroup ?? null) : null,
      })),
      alreadyCreatedTag: g.scheduling_group_members.some((m) => alreadyProgressedTeamIds.has(m.team_id)) ? (alreadyCreatedTagByTeam.get(g.scheduling_group_members[0]?.team_id) ?? "a next-season group") : null,
    }))
  }

  // A past batch's own proposals recorded what each team's identity WAS at that batch's from_season --
  // a team re-aged in a LATER handover must not retroactively relabel an older batch's history.
  const rolloverIdentityPairs = (rollovers ?? []).flatMap((rv) => (rv.from_season_id ? rv.age_grade_rollover_team_proposals.map((p) => ({ teamId: p.team_id, seasonId: rv.from_season_id as string })) : []))
  const rolloverTeamIdentities = await loadTeamIdentitiesForSeason(supabase, rolloverIdentityPairs)

  // Player handover proposals for the handover currently in progress. Note what is NOT selected: no
  // date of birth. The server reads one to resolve an age grade and this receives the resolved decision.
  const { data: playerProposalRows } = currentRollover
    ? await supabase
        .from("age_grade_rollover_player_proposals")
        .select(
          "id, player_id, proposed_team_id, selected_team_id, planned_team_id, selected_at, review_state, allocation_status, movement_requirement, regulatory_age_label, reason, placement_applied_at, normal_canonical_team_type_id, current_team:teams!age_grade_rollover_player_proposals_current_team_id_fkey(display_name), proposed_team:teams!age_grade_rollover_player_proposals_proposed_team_id_fkey(display_name), selected_team:teams!age_grade_rollover_player_proposals_selected_team_id_fkey(display_name)"
        )
        .eq("rollover_id", currentRollover.id)
    : { data: null }

  // "Current" is today's identity, but "Normal next" and "Selected" describe the season being decided,
  // so they are resolved through the canonical season-aware projection rather than a team's present label.
  const playerTeamIdentities = currentRollover
    ? await loadTeamIdentitiesForSeason(
        supabase,
        (playerProposalRows ?? []).flatMap((p) =>
          [p.proposed_team_id, p.selected_team_id].filter((id): id is string => Boolean(id)).map((teamId) => ({ teamId, seasonId: currentRollover.to_season_id as string }))
        )
      )
    : new Map()

  const nextSeasonLabel = (teamId: string | null, fallback: string | null): string | null => {
    if (!teamId || !currentRollover?.to_season_id) return fallback
    return decidedLabelByTeam.get(teamId) ?? playerTeamIdentities.get(teamIdentityKey(teamId, currentRollover.to_season_id))?.displayName ?? fallback
  }

  const proposalPlayers = await loadStaffPlayers(supabase, (playerProposalRows ?? []).map((p) => p.player_id))
  const playerProposals: PlayerProposalRow[] = (playerProposalRows ?? [])
    .map((p) => ({
      proposalId: p.id,
      playerId: p.player_id,
      playerName: proposalPlayers.get(p.player_id)?.displayName || "Player",
      currentTeamName: p.current_team?.display_name ?? "Unknown team",
      normalPlacementName: nextSeasonLabel(p.proposed_team_id, p.proposed_team?.display_name ?? null),
      selectedPlacementName: nextSeasonLabel(p.selected_team_id, p.selected_team?.display_name ?? null),
      regulatoryAgeLabel: p.regulatory_age_label,
      reviewState: p.review_state as PlayerReviewState,
      allocationStatus: p.allocation_status,
      movementRequirement: p.movement_requirement,
      dispensationRequired: p.movement_requirement === "external_approval_required",
      reason: p.reason,
      placementApplied: p.placement_applied_at !== null,
      // The club runs no team at the age grade this player belongs in, so the board can offer to run one.
      normalTeamMissing: p.proposed_team === null && p.normal_canonical_team_type_id !== null,
      plannedTeamName: p.planned_team_id ? (plannedById.get(p.planned_team_id)?.label ?? null) : null,
      plannedTeamPending: p.planned_team_id ? (plannedById.get(p.planned_team_id)?.pending ?? false) : false,
      placementChosen: p.selected_at !== null,
    }))
    .sort((a, b) => {
      const rank = (row: PlayerProposalRow) => (row.reviewState === "READY" ? 1 : 0)
      return rank(a) - rank(b) || a.playerName.localeCompare(b.playerName)
    })

  const batches: RolloverBatch[] = (rollovers ?? []).map((rv) => ({
    id: rv.id,
    fromSeasonName: rv.from_season?.name ?? null,
    toSeasonName: rv.to_season?.name ?? "—",
    createdAt: rv.created_at,
    isApplied: rv.applied_at !== null,
    proposals: rv.age_grade_rollover_team_proposals.map((p) => ({
      id: p.id,
      teamId: p.team_id,
      teamDisplayName: (rv.from_season_id && rolloverTeamIdentities.get(teamIdentityKey(p.team_id, rv.from_season_id))?.displayName) || p.teams?.display_name || "Unknown team",
      teamGender: (p.teams?.gender ?? null) as RolloverTeamProposalRow["teamGender"],
      teamSquadDesignation: p.teams?.squad_designation ?? null,
      currentAgeGroup: p.current_age_group,
      proposedAgeGroup: p.proposed_age_group,
      requiresManualChoice: p.requires_manual_choice,
      isMixedBoundary: p.is_mixed_boundary,
      decision: p.decision as TeamDecision,
      decidedAgeGroup: p.decided_age_group,
      girlsTeamCreated: p.girls_team_created,
      createGirlsTeam: p.create_girls_team,
      foldReason: p.fold_reason,
      applied: p.applied_at !== null,
    })),
    groupFlags: rv.age_grade_rollover_group_flags.map((f) => ({
      id: f.id,
      displayTag: f.scheduling_groups?.display_tag ?? "Mini-Rugby Group",
      reason: f.reason,
      resolved: f.resolved,
    })),
  }))

  return {
    club: { id: club.id, name: club.club_directory?.name ?? null, rugbyCode },
    currentSeason,
    upcomingSeasons,
    nextSeason,
    rollover: currentRollover ? { id: currentRollover.id, decisionsRevision: currentRollover.decisions_revision, appliedAt: currentRollover.applied_at, toSeasonId: currentRollover.to_season_id } : null,
    state,
    readiness,
    blockers,
    consequences,
    audit,
    batches,
    playerProposals,
    plannedResolved,
    graduationQueue,
    graduationTargets,
    miniRugbyGroups,
    capabilities,
  }
}

/** "3 teams · 41 players · 2 decisions needed · 1 awaiting governing approval" */
export function readinessSentence(r: HandoverReadiness): string {
  const parts = [
    `${r.teamsTotal} team${r.teamsTotal === 1 ? "" : "s"}`,
    `${r.playersTotal} player${r.playersTotal === 1 ? "" : "s"}`,
    `${r.blockerCount} decision${r.blockerCount === 1 ? "" : "s"} needed`,
  ]
  if (r.dispensationsPending > 0) parts.push(`${r.dispensationsPending} awaiting governing approval`)
  return parts.join(" · ")
}

/** The product sentence under the title -- the same words on both clients, in the state's own tense. */
export function handoverIntroSentence(board: Pick<HandoverBoard, "club" | "state" | "nextSeason">): string {
  const clubName = board.club.name ?? "your club"
  if (board.state === "COMPLETED") {
    return `This handover has run. ${clubName} now runs its ${board.nextSeason?.name ?? "new season"} structure, and what happened is recorded below. Correcting anything from here is an ordinary team or player change. Season dates come from Site Admin → Seasons.`
  }
  return `Review what ${clubName}'s teams and players become next season. Nothing about your club changes until you apply the handover — every decision here can be changed until then. Season dates come from Site Admin → Seasons.`
}

// ---------------------------------------------------------------------------
// Mutations -- each a thin wrapper over the one RPC the web's server action calls
// ---------------------------------------------------------------------------

/** generate_rollover_proposal is read-only against real teams -- it only ever writes to the proposal tables. Returns the rollover id. */
export async function prepareHandover(supabase: Client, clubId: string, rugbyCode: RugbyCode, toSeasonId: string): Promise<string> {
  const { data, error } = await supabase.rpc("generate_rollover_proposal", { p_club_id: clubId, p_rugby_code: rugbyCode, p_to_season_id: toSeasonId })
  if (error) throw error
  return String(data)
}

export interface TeamDecisionInput {
  proposalId: string
  action: TeamDecisionAction
  ageGroup: string | null
  squadDesignation: string | null
  foldReason: string | null
  gender?: "boys" | "girls" | null
}

/**
 * Records what should happen to a team next season. This changes NO live team: the club's teams are
 * untouched until the handover is applied, which is what makes "nothing changes until you apply the
 * handover" literally true and undo possible. Fold and graduate are held to team.lifecycle.manage inside.
 */
export async function decideTeamProposal(supabase: Client, input: TeamDecisionInput): Promise<void> {
  const { error } = await supabase.rpc("confirm_rollover_team_proposal", {
    p_proposal_id: input.proposalId,
    p_action: input.action,
    p_age_group: input.ageGroup ?? undefined,
    p_squad_designation: input.squadDesignation ?? undefined,
    p_fold_reason: input.foldReason ?? undefined,
    p_gender: input.gender ?? undefined,
  })
  if (error) throw error
}

export interface MixedBoundaryDecisionInput {
  proposalId: string
  /** No default on either side of this call: the server refuses null and a client must not submit without an explicit choice. */
  createGirlsTeam: boolean
  boysSquadDesignation: string | null
  girlsSquadDesignation: string | null
}

/** The only path that resolves a U11 Mixed -> U12 structural transition. The Girls team is PLANNED here and created at Apply. */
export async function decideMixedBoundary(supabase: Client, input: MixedBoundaryDecisionInput): Promise<{ boysTeamId: string; girlsTeamId: string | null }> {
  const { data, error } = await supabase
    .rpc("confirm_mixed_boundary_rollover", {
      p_proposal_id: input.proposalId,
      p_create_girls_team: input.createGirlsTeam,
      p_boys_squad_designation: input.boysSquadDesignation ?? undefined,
      p_girls_squad_designation: input.girlsSquadDesignation ?? undefined,
    })
    .single()
  if (error) throw error
  if (!data) throw new Error("Could not record this decision.")
  return { boysTeamId: data.boys_team_id, girlsTeamId: data.girls_team_id ?? null }
}

/** Returns a team decision to undecided. Possible because deciding mutates nothing. */
export async function undoTeamDecision(supabase: Client, proposalId: string): Promise<void> {
  const { error } = await supabase.rpc("undo_rollover_team_decision", { p_proposal_id: proposalId })
  if (error) throw error
}

export async function resolveGroupFlag(supabase: Client, flagId: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_rollover_group_flag", { p_flag_id: flagId })
  if (error) throw error
}

export interface NextSeasonGroupInput {
  sourceGroupId: string
  toSeasonId: string
  teamIds: string[]
  alias: string | null
}

/** Always creates a NEW group for the target season -- the historical group is never mutated. Returns the new group id. */
export async function createNextSeasonGroup(supabase: Client, input: NextSeasonGroupInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_next_season_scheduling_group", {
    p_source_group_id: input.sourceGroupId,
    p_to_season_id: input.toSeasonId,
    p_team_ids: input.teamIds,
    p_alias: input.alias ?? undefined,
  })
  if (error) throw error
  if (!data) throw new Error("Could not create the next-season Mini-Rugby Group.")
  return String(data)
}

/** Real canonical teams for this club, code and target season, as they will be next season. Never free text. */
export async function readPlacementOptions(supabase: Client, proposalId: string): Promise<PlacementOption[]> {
  const { data, error } = await supabase.rpc("rollover_placement_options", { p_proposal_id: proposalId })
  if (error) throw error
  return (data ?? []).map((o) => ({
    teamId: o.team_id ?? null,
    plannedId: o.planned_id ?? null,
    displayName: o.display_name,
    ageGroup: o.age_group ?? null,
    squadDesignation: o.squad_designation ?? null,
    isNormal: o.is_normal,
    isSelected: o.is_selected,
    isPlanned: o.is_planned,
  }))
}

/** Records the club's chosen placement and returns the server's verdict. The verdict is authoritative -- a client displays it, it does not decide it. */
export async function setPlayerPlacement(supabase: Client, proposalId: string, targetTeamId: string): Promise<PlacementVerdict> {
  const { data, error } = await supabase.rpc("set_rollover_player_placement", { p_proposal_id: proposalId, p_target_team_id: targetTeamId })
  if (error) throw error
  const row = (data ?? [])[0]
  if (!row) throw new Error("The placement could not be recorded.")
  return {
    overrideKind: (row.override_kind as PlacementVerdict["overrideKind"]) ?? null,
    movementRequirement: (row.movement_requirement as PlacementVerdict["movementRequirement"]) ?? null,
    reviewState: row.review_state as PlayerReviewState,
    reason: row.reason ?? null,
    dispensationRequired: row.dispensation_required,
  }
}

/** Chooses a team the club has decided to run but which does not exist yet. */
export async function setPlayerPlannedPlacement(supabase: Client, proposalId: string, plannedId: string): Promise<void> {
  const { error } = await supabase.rpc("set_rollover_player_planned_placement", { p_proposal_id: proposalId, p_planned_id: plannedId })
  if (error) throw error
}

/** Puts a player's placement back to whatever the club's decisions say it should be. */
export async function clearPlayerPlacement(supabase: Client, proposalId: string): Promise<void> {
  const { error } = await supabase.rpc("clear_rollover_player_placement", { p_proposal_id: proposalId })
  if (error) throw error
}

/** Records that the club will run the team a player normally belongs in. The real team, and its staff, arrive inside Apply. */
export async function planMissingPlacementTeam(supabase: Client, proposalId: string): Promise<void> {
  const { error } = await supabase.rpc("plan_missing_placement_team", { p_proposal_id: proposalId })
  if (error) throw error
}

/** Withdraws a team the club had decided to run. Only possible before Apply. */
export async function unplanHandoverTeam(supabase: Client, plannedId: string): Promise<void> {
  const { error } = await supabase.rpc("unplan_handover_team", { p_planned_id: plannedId })
  if (error) throw error
}

/** place_graduating_player enforces the real governing-body-approval gate server-side; a client surfaces its sentence verbatim. */
export async function placeGraduatingPlayer(supabase: Client, queueId: string, targetTeamId: string): Promise<void> {
  const { error } = await supabase.rpc("place_graduating_player", { p_queue_id: queueId, p_target_team_id: targetTeamId })
  if (error) throw error
}

export async function markGraduatingPlayerLeft(supabase: Client, queueId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_graduating_player_left", { p_queue_id: queueId })
  if (error) throw error
}

/** The whole of the club's authority here is to ASK. Returns how many guardians were told. Cannot write anything about the child. */
export async function askGuardianForPlayingInformation(supabase: Client, playerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("request_player_playing_pathway", { p_player_id: playerId })
  if (error) throw error
  return data ?? 0
}

export function askGuardianSentence(sent: number, playerName: string): string {
  if (sent > 0) return `Asked ${sent === 1 ? "their guardian" : `their ${sent} guardians`}.`
  return `${playerName.split(" ")[0]} has no guardian on Ovalball to ask yet.`
}

export interface ApplyHandoverOutcome {
  alreadyApplied: boolean
  teamsProgressed: number
  teamsFolded: number
  teamsGraduated: number
  teamsCreated: number
  teamsReactivated: number
  playersMoved: number
  playersHeld: number
}

/**
 * THE SINGLE MUTATION BOUNDARY. One server-side transaction revalidates every decision against live
 * state and then carries the whole handover out -- no client sequences a season transition one request
 * at a time. `expectedRevision` is what the reviewer had in front of them; if someone else changed a
 * decision in the meantime the server refuses rather than applying something nobody reviewed.
 */
export async function applySeasonHandover(supabase: Client, rolloverId: string, expectedRevision: number | null): Promise<ApplyHandoverOutcome> {
  const { data, error } = await supabase.rpc("apply_season_handover", { p_rollover_id: rolloverId, p_expected_revision: expectedRevision ?? undefined })
  if (error) throw error
  const row = (data ?? [])[0]
  if (!row) throw new Error("The handover did not report a result.")
  return {
    alreadyApplied: row.already_applied,
    teamsProgressed: row.teams_progressed,
    teamsFolded: row.teams_folded,
    teamsGraduated: row.teams_graduated,
    teamsCreated: row.teams_created,
    teamsReactivated: row.teams_reactivated,
    playersMoved: row.players_moved,
    playersHeld: row.players_held,
  }
}

export function applyOutcomeSentence(o: ApplyHandoverOutcome): string {
  if (o.alreadyApplied) return "This handover had already been applied, so nothing was changed again."
  return `${o.teamsProgressed} team${o.teamsProgressed === 1 ? "" : "s"} progressed, ${o.teamsCreated + o.teamsReactivated} created or reactivated, ${o.playersMoved} player${o.playersMoved === 1 ? "" : "s"} moved.`
}

/**
 * What a person reads when the server refuses. The handover functions raise product-language sentences
 * on purpose ("These decisions have changed since you reviewed them", "Only this club's Club Admin or a
 * Full Site Admin may apply a season handover."), so those are shown as they are; anything else falls
 * back to the caller's sentence rather than to a code or a table name.
 */
export function handoverErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "23505" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}
