import "server-only"

import { createClient } from "@/lib/supabase/server"
import { createFixtureRequest } from "@/app/(app)/fixtures/new/actions"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { canActOnTeam } from "./actor-context"
import { formatDistanceMiles } from "./distance"
import { extractOvieIntent, type OvieIntent } from "./intent"
import { findSuitableOpponents } from "./opponent-search"
import {
  EMPTY_OVIE_STATE,
  type DraftFixtureRequest,
  type OpponentSearchCriteria,
  type OvieActorContext,
  type OvieConversationState,
  type OvieTurn,
  type OvieTurnResult,
  type SafeOpponentCandidate,
} from "./types"

/**
 * Ties intent -> deterministic resolution -> confirmation -> (only on
 * explicit confirm) -> the existing createFixtureRequest() write path.
 * State lives entirely in the conversation object returned to and passed
 * back by the caller (the "Ask Ovie" widget's own React state) -- there is
 * deliberately no server-side conversation table (see the module comment
 * on supabase/migrations/20260918000000_ovie_foundation.sql). This keeps
 * Ovie stateless between requests the same way every other server action
 * in this app is, and means a page refresh simply starts a fresh
 * conversation -- an accepted, disclosed Phase 1 limitation, not a bug.
 *
 * CONFIRMATION SAFETY: the only path that calls createFixtureRequest() is
 * runOvieTurn()'s "confirm_send" branch, and it re-resolves and re-checks
 * canActOnTeam() at that exact point -- never trusting that an earlier
 * search or selection in the same conversation was itself proof of
 * permission (a permission could change mid-conversation; the object is
 * never assumed still valid).
 */

interface OwnTeamMatch {
  teamId: string
  clubId: string
  rugbyCode: "union" | "league"
  label: string
}

/** Resolves a free-text description ("Burnley U12", "our U12s") against ONLY the teams this actor can actually manage -- never the whole Team Directory. No fuzzy library; a small deterministic word-overlap score is enough for the vocabulary rugby club volunteers actually use, and ties are surfaced as a clarifying question rather than guessed. */
async function resolveOwnTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: OvieActorContext,
  description: string
): Promise<{ match: OwnTeamMatch | null; ambiguous: OwnTeamMatch[] }> {
  const manageableClubIds = actor.clubs.filter((c) => c.canManageClubFixtures).map((c) => c.clubId)
  const scopedTeamIds = actor.teamScopes.filter((t) => t.canManageTeam).map((t) => t.teamId)
  if (manageableClubIds.length === 0 && scopedTeamIds.length === 0 && !actor.isSiteAdmin) {
    return { match: null, ambiguous: [] }
  }

  let query = supabase.from("teams").select("id, club_id, rugby_code, display_name, category, age_group, gender, squad_designation").eq("active", true)
  if (!actor.isSiteAdmin) {
    const orParts: string[] = []
    if (manageableClubIds.length > 0) orParts.push(`club_id.in.(${manageableClubIds.join(",")})`)
    if (scopedTeamIds.length > 0) orParts.push(`id.in.(${scopedTeamIds.join(",")})`)
    query = query.or(orParts.join(","))
  }
  const { data } = await query
  const teams = data ?? []
  if (teams.length === 0) return { match: null, ambiguous: [] }

  // Strip a trailing "s" off an age-group-shaped token ("u12s" -> "u12") --
  // rugby volunteers say "our U12s" but every stored display name/label is
  // singular ("U12"), and a plain substring match would otherwise never hit.
  const STOPWORDS = new Set(["our", "the", "a", "an", "us", "team", "teams", "s"])
  const needle = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^(u\d+)s$/, "$1"))
    .filter((w) => !STOPWORDS.has(w))

  const clubNameById = new Map(actor.clubs.map((c) => [c.clubId, c.clubName]))
  const scored = teams
    .map((t) => {
      const label = fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation })
      const clubName = clubNameById.get(t.club_id) ?? ""
      // Include the club's own name in the haystack -- without it, a user
      // who administers more than one club (a real, tested scenario here)
      // gets a false "ambiguous" tie the moment two clubs share a team
      // name like "U12", even though "Burnley U12" unambiguously names one.
      // Tokenized to whole words, not a raw substring match -- "women's"
      // contains "men" as a literal substring, which would otherwise tie
      // every men's-team search against the women's team too.
      const haystackWords = new Set(
        `${clubName} ${t.display_name} ${label}`
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter(Boolean)
      )
      const score = needle.reduce((acc, word) => acc + (haystackWords.has(word) ? 1 : 0), 0)
      return { teamId: t.id, clubId: t.club_id, rugbyCode: t.rugby_code as "union" | "league", label: `${clubName} ${t.display_name} (${label})`, score }
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { match: null, ambiguous: [] }
  if (scored.length === 1 || scored[0]!.score > scored[1]!.score) return { match: scored[0]!, ambiguous: [] }
  const topScore = scored[0]!.score
  return { match: null, ambiguous: scored.filter((t) => t.score === topScore) }
}

function resolveCandidate(description: string, results: SafeOpponentCandidate[]): SafeOpponentCandidate | null {
  const trimmed = description.trim().toLowerCase()
  const ordinals: Record<string, number> = { first: 0, "1st": 0, top: 0, second: 1, "2nd": 1, third: 2, "3rd": 2 }
  if (trimmed in ordinals) return results[ordinals[trimmed]!] ?? null
  const byName = results.find((r) => r.clubDisplayName.toLowerCase().includes(trimmed) || trimmed.includes(r.clubDisplayName.toLowerCase()))
  return byName ?? null
}

function formatCandidateLine(c: SafeOpponentCandidate): string {
  const distance = c.approximateDistanceMiles != null ? formatDistanceMiles(c.approximateDistanceMiles) : "distance unknown"
  return `${c.clubDisplayName} -- ${c.canonicalTeamLabel}, ${distance} (${c.reasons.join(", ")})`
}

/**
 * A natural, explainable sentence for the single best-ranked candidate --
 * Section 13's "Why Ovie recommends them" -- built entirely from the same
 * safe, already-computed fields formatCandidateLine uses (distance,
 * partnership, meeting count), never a raw score. The plain candidate list
 * still follows for every result, best match included -- this sentence is
 * additive framing, not a replacement for seeing the full list.
 */
function explainTopMatch(c: SafeOpponentCandidate, teamLabel: string | null): string {
  const bits: string[] = []
  if (c.approximateDistanceMiles != null) bits.push(`nearby (${formatDistanceMiles(c.approximateDistanceMiles)})`)
  if (c.partnershipState === "partner") bits.push("already connected to your club as a Partner")
  if (c.fixtureAvailabilityState === "AVAILABLE") bits.push(`available in Ovalball`)
  else if (c.fixtureAvailabilityState === "PENDING_COMMITMENT") bits.push("shows a pending, unconfirmed commitment on that date")
  bits.push(c.meetingsThisSeason === 0 ? "not played this season" : `only ${c.meetingsThisSeason} meeting${c.meetingsThisSeason === 1 ? "" : "s"} this season`)
  return `${c.clubDisplayName} ${c.canonicalTeamLabel} looks the strongest match for ${teamLabel ?? "your team"} -- ${bits.join(", ")}.`
}

/** Section 22: never a bare "nothing found" -- offer the specific, concrete refinements this exact search hasn't already tried. */
function emptyResultsReply(teamLabel: string | null, date: string, criteria: OpponentSearchCriteria, excludedCount: number): string {
  const offers: string[] = []
  if (!criteria.includeUnclaimed) offers.push("include clubs not yet on Ovalball")
  if (!criteria.includeInactiveTeam) offers.push("include clubs whose team is currently inactive")
  const widerRadius = (criteria.radiusMiles ?? 20) + 10
  offers.push(`try ${widerRadius} miles instead of ${criteria.radiusMiles ?? 20}`)
  const base = `I couldn't find an active Ovalball team for ${teamLabel ?? "that team"} within the current criteria on ${date}${excludedCount > 0 ? ` (${excludedCount} excluded by availability, meeting limits, or partner-only)` : ""}.`
  return `${base} Want me to ${offers.join(", or ")}?`
}

/**
 * PERMANENT INVARIANT: OVIE CAPABILITY <= CURRENT USER CAPABILITY -- but
 * read and write are authorized SEPARATELY, never as one blanket gate.
 * There used to be a single `if (actor.viewOnly) return blocked` here,
 * before even calling the model -- that blocked a view-only actor from
 * every intent, including harmless ones (narrate/clarify/cancel carry no
 * data of their own; extractOvieIntent's model has zero database access
 * regardless of who's asking, see lib/ovie/intent.ts's own module
 * comment), and it silently became Ovie's ONLY authorization boundary --
 * exactly the "all-or-nothing gate" pattern this architecture must never
 * fall back on. The real, permanent boundary is applied per skill, at the
 * point each skill is invoked, in applyOvieIntent() below:
 *   - narrate/clarify/cancel: allowed for any authenticated actor, view-only
 *     included -- no team resolution, no cross-club query, no write.
 *   - search_opponents: resolveOwnTeam() already restricts to exactly the
 *     clubs/teams this actor can manage (a view-only actor manages none,
 *     so it naturally resolves to "no matching team", never a blanket
 *     block) -- this is the READ boundary, and it is real authorization,
 *     not a UI hint.
 *   - select_candidate/prepare_fixture_request/confirm_send: every path
 *     either operates on an already-correctly-scoped `state.lastResults`/
 *     `state.selected`, or is re-checked directly against canActOnTeam()
 *     at the moment it would write -- this is the WRITE boundary,
 *     independent of whatever the read boundary already allowed.
 * Today, Ovie has no genuine read-only skill yet (every Phase 1/2 skill
 * ultimately serves arranging a fixture, which is inherently a write-
 * adjacent, manage-this-team action) -- so in practice a view-only actor's
 * only reachable outcomes are narrate/clarify/cancel, or a correctly-
 * scoped-to-empty search_opponents rejection. That is Phase 1/2's actual,
 * documented product policy (view-only accounts have no fixture-arranging
 * skill to use), not a gate accidentally achieving it -- and the very
 * first thing a future genuine read-only skill (e.g. "what fixtures can I
 * see this weekend") must do on arrival is its OWN explicit read-boundary
 * check here, never lean on this comment or a resurrected blanket gate.
 */
export async function runOvieTurn(actor: OvieActorContext, priorState: OvieConversationState, userMessage: string): Promise<OvieTurnResult> {
  const todayIso = new Date().toISOString().slice(0, 10)
  const intentResult = await extractOvieIntent(userMessage, priorState.history, todayIso)

  if (intentResult.status === "not_configured") {
    return {
      state: priorState,
      reply: "Ovie isn't connected yet -- no ANTHROPIC_API_KEY is configured for this environment, so I can't understand free-text messages here.",
      candidates: null,
      confirmationCard: null,
      sentSummary: null,
      error: "not_configured",
    }
  }
  if (intentResult.status === "error") {
    return { state: priorState, reply: intentResult.message, candidates: null, confirmationCard: null, sentSummary: null, error: "error" }
  }

  return applyOvieIntent(actor, priorState, userMessage, intentResult.intent)
}

/**
 * The deterministic core, split out from runOvieTurn() so it can be
 * exercised directly with a hand-constructed OvieIntent -- this is what
 * makes it possible to prove the resolution/search/confirmation/write
 * pipeline works WITHOUT a live ANTHROPIC_API_KEY (none is configured in
 * this local environment). Every branch below is exactly what a real
 * extractOvieIntent() call would have driven; only the natural-language
 * parsing step itself is untested locally -- see the Ovie Phase 1 report's
 * LIVE TEST RESULTS section.
 */
export async function applyOvieIntent(actor: OvieActorContext, priorState: OvieConversationState, userMessage: string, intent: OvieIntent): Promise<OvieTurnResult> {
  const supabase = await createClient()
  const history: OvieTurn[] = [...priorState.history, { role: "user", content: userMessage }]
  let state: OvieConversationState = { ...priorState, history }

  if (intent.kind === "narrate") {
    state = { ...state, history: [...history, { role: "assistant", content: intent.message }] }
    return { state, reply: intent.message, candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  if (intent.kind === "clarify") {
    state = { ...state, history: [...history, { role: "assistant", content: intent.question }] }
    return { state, reply: intent.question, candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  if (intent.kind === "cancel") {
    state = { ...EMPTY_OVIE_STATE, history: [...history, { role: "assistant", content: "No problem -- I've dropped that search." }] }
    return { state, reply: "No problem -- I've dropped that search.", candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  if (intent.kind === "search_opponents") {
    let requestingTeamId = state.criteria.requestingTeamId
    let requestingClubId = state.criteria.requestingClubId
    let rugbyCode = state.criteria.rugbyCode
    let teamLabel = state.requestingTeamLabel

    if (intent.delta.teamDescription) {
      const { match, ambiguous } = await resolveOwnTeam(supabase, actor, intent.delta.teamDescription)
      if (!match) {
        const reply =
          ambiguous.length > 0
            ? `I found more than one team matching "${intent.delta.teamDescription}": ${ambiguous.map((a) => a.label).join(", ")}. Which one did you mean?`
            : `I couldn't find a team matching "${intent.delta.teamDescription}" that you can arrange fixtures for.`
        state = { ...state, history: [...history, { role: "assistant", content: reply }] }
        return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
      }
      requestingTeamId = match.teamId
      requestingClubId = match.clubId
      rugbyCode = match.rugbyCode
      teamLabel = match.label
    }

    if (!requestingTeamId || !requestingClubId || !rugbyCode) {
      const reply = "Which of your teams should I find an opponent for?"
      state = { ...state, history: [...history, { role: "assistant", content: reply }] }
      return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
    }
    if (!canActOnTeam(actor, requestingTeamId, requestingClubId)) {
      const reply = "I don't think you have permission to arrange fixtures for that team."
      state = { ...state, history: [...history, { role: "assistant", content: reply }] }
      return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
    }

    const date = intent.delta.date ?? state.criteria.date
    if (!date) {
      const reply = "What date are you looking to play?"
      state = { ...state, history: [...history, { role: "assistant", content: reply }] }
      return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
    }

    const criteria: OpponentSearchCriteria = {
      requestingClubId,
      requestingTeamId,
      rugbyCode,
      date,
      radiusMiles: intent.delta.radiusMiles ?? state.criteria.radiusMiles,
      homeAwayPreference: intent.delta.homeAwayPreference ?? state.criteria.homeAwayPreference ?? null,
      partnerPreference: intent.delta.partnerPreference ?? state.criteria.partnerPreference,
      maxPreviousMeetings: intent.delta.maxPreviousMeetings ?? state.criteria.maxPreviousMeetings ?? null,
      maxResults: 5,
    }

    if (intent.delta.excludeTeamDescription) {
      const { data: dirRows } = await supabase.from("club_directory").select("id, name").ilike("name", `%${intent.delta.excludeTeamDescription}%`).limit(5)
      const ids = (dirRows ?? []).map((r) => r.id)
      criteria.excludeClubDirectoryIds = [...(state.criteria.excludeClubDirectoryIds ?? []), ...ids]
    }

    const result = await findSuitableOpponents(supabase, actor, criteria)
    const candidates = result.candidates

    let reply: string
    if (candidates.length === 0) {
      reply = emptyResultsReply(teamLabel, date, criteria, result.excludedCount)
    } else {
      const rest = candidates.slice(1).map((c, i) => `${i + 2}. ${formatCandidateLine(c)}`)
      reply = [
        `I found ${candidates.length} suitable team${candidates.length === 1 ? "" : "s"}.`,
        explainTopMatch(candidates[0]!, teamLabel),
        [`1. ${formatCandidateLine(candidates[0]!)} -- BEST MATCH`, ...rest].join("\n"),
      ].join("\n\n")
    }

    state = {
      ...state,
      criteria,
      requestingTeamLabel: teamLabel,
      lastResults: candidates,
      selected: null,
      draft: null,
      status: candidates.length > 0 ? "awaiting_selection" : "idle",
      history: [...history, { role: "assistant", content: reply }],
    }
    return { state, reply, candidates, confirmationCard: null, sentSummary: null, error: null }
  }

  if (intent.kind === "select_candidate") {
    const selected = resolveCandidate(intent.description, state.lastResults)
    if (!selected) {
      const reply = `I'm not sure which one you mean by "${intent.description}" -- could you name the club?`
      state = { ...state, history: [...history, { role: "assistant", content: reply }] }
      return { state, reply, candidates: state.lastResults, confirmationCard: null, sentSummary: null, error: null }
    }
    const reply = `Got it -- ${selected.clubDisplayName}. Home, away, or either, and what kickoff time?`
    state = { ...state, selected, draft: null, status: "awaiting_confirmation", history: [...history, { role: "assistant", content: reply }] }
    return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  if (intent.kind === "prepare_fixture_request") {
    if (!state.selected || !state.criteria.date) {
      const reply = "Let's find an opponent first -- who and when would you like to play?"
      state = { ...state, history: [...history, { role: "assistant", content: reply }] }
      return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
    }

    // Resolve the requesting club's own default venue ONLY for a Home
    // fixture -- never guessed, never asked of the model, and never
    // resolved for Away/Either (that's the opponent's or an undecided
    // venue, not something this club's own lookup can answer). Reuses the
    // exact same venues table/is_default_home flag the Venues & Pitches
    // Lookup Administration and Fixture Admin's own venue picker already
    // read from -- one source of truth, never a second lookup.
    let venueId: string | null = null
    let venueName: string | null = null
    if (intent.venuePreference === "home" && state.criteria.requestingClubId) {
      const { data: defaultVenue } = await supabase
        .from("venues")
        .select("id, name")
        .eq("club_id", state.criteria.requestingClubId)
        .eq("is_default_home", true)
        .eq("active", true)
        .maybeSingle()
      venueId = defaultVenue?.id ?? null
      venueName = defaultVenue?.name ?? null
    }

    const draft: DraftFixtureRequest = { venuePreference: intent.venuePreference, kickoffTime: intent.kickoffTime, note: intent.note, venueId, venueName }
    const card = {
      clubDisplayName: state.selected.clubDisplayName,
      teamLabel: state.selected.canonicalTeamLabel,
      date: state.criteria.date,
      venuePreference: draft.venuePreference,
      kickoffTime: draft.kickoffTime,
      venueName,
    }
    const venuePart = venueName ? ` at ${venueName}` : intent.venuePreference === "home" ? " (no default venue set yet)" : ""
    const reply = `Here's the request I'll send: ${state.requestingTeamLabel ?? "your team"} vs ${card.clubDisplayName} (${card.teamLabel}) on ${card.date}, ${draft.venuePreference}${venuePart}${draft.kickoffTime ? ` at ${draft.kickoffTime}` : ""}. Shall I send it?`
    state = { ...state, draft, status: "awaiting_confirmation", history: [...history, { role: "assistant", content: reply }] }
    return { state, reply, candidates: null, confirmationCard: card, sentSummary: null, error: null }
  }

  // intent.kind === "confirm_send"
  if (state.status !== "awaiting_confirmation" || !state.selected || !state.draft || !state.criteria.requestingTeamId || !state.criteria.requestingClubId) {
    const reply = "There's nothing ready to send yet -- let's find and confirm an opponent first."
    state = { ...state, history: [...history, { role: "assistant", content: reply }] }
    return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  // Re-check permission at the actual write boundary -- never trust that
  // an earlier turn's check is still valid.
  if (!canActOnTeam(actor, state.criteria.requestingTeamId, state.criteria.requestingClubId)) {
    const reply = "I can no longer confirm you have permission to send this request."
    state = { ...EMPTY_OVIE_STATE, history: [...history, { role: "assistant", content: reply }] }
    return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: null }
  }

  const selected = state.selected
  const { data: activatedClub } = await supabase.from("clubs").select("id").eq("directory_id", selected.clubDirectoryId).eq("status", "active").maybeSingle()

  let targetTeamId: string | null = null
  let targetTeamAgeGroup: string | null = null
  let targetTeamGender: "boys" | "girls" | null = null
  if (activatedClub) {
    const { data: candidateTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("club_id", activatedClub.id)
      .eq("canonical_team_type_id", selected.canonicalTeamTypeId)
      .eq("active", true)
      .maybeSingle()
    if (candidateTeam) {
      targetTeamId = candidateTeam.id
    } else {
      const { data: canonicalType } = await supabase.from("canonical_team_types").select("age_group, gender").eq("id", selected.canonicalTeamTypeId).maybeSingle()
      targetTeamAgeGroup = canonicalType?.age_group ?? null
      targetTeamGender = (canonicalType?.gender as "boys" | "girls" | null) ?? null
    }
  }

  // Re-resolve the default venue fresh at the actual write boundary --
  // never trust the draft's venueId as still current just because an
  // earlier turn in this same conversation looked it up (Section 13:
  // canonical ids carried between steps are never trusted merely because
  // they came from earlier state; only server-side revalidation at action
  // time counts).
  let venueId: string | null = null
  if (state.draft.venuePreference === "home") {
    const { data: defaultVenue } = await supabase
      .from("venues")
      .select("id")
      .eq("club_id", state.criteria.requestingClubId)
      .eq("is_default_home", true)
      .eq("active", true)
      .maybeSingle()
    venueId = defaultVenue?.id ?? null
  }

  const writeResult = await createFixtureRequest({
    requestingClubId: state.criteria.requestingClubId,
    opponentDirectoryId: selected.clubDirectoryId,
    opponentClubId: activatedClub?.id ?? null,
    rawOpponentText: selected.clubDisplayName,
    proposedDate: state.criteria.date!,
    notes: state.draft.note,
    teams: [
      {
        teamId: state.criteria.requestingTeamId,
        venuePreference: state.draft.venuePreference,
        preferredKickoffTime: state.draft.kickoffTime,
        note: state.draft.note,
        venueId,
        targetTeamId,
        targetTeamAgeGroup,
        targetTeamGender,
        targetTeamSquadDesignation: null,
      },
    ],
    skipRedirect: true,
    source: "ovie_assistant",
  })

  if (!writeResult.ok) {
    const reply = `I couldn't send that: ${writeResult.error}`
    state = { ...state, history: [...history, { role: "assistant", content: reply }] }
    return { state, reply, candidates: null, confirmationCard: null, sentSummary: null, error: "write_failed" }
  }

  const summary = `Sent -- your request to ${selected.clubDisplayName} for ${state.criteria.date} is now in Fixture Requests.`
  state = { ...EMPTY_OVIE_STATE, history: [...history, { role: "assistant", content: summary }], status: "sent" }
  return { state, reply: summary, candidates: null, confirmationCard: null, sentSummary: summary, error: null }
}
