"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  addChild,
  previewAllocation,
  requestChildLink,
  searchClubs,
  type AddChildResult,
  type ClubSearchResult,
  type PlayerAllocation,
} from "./actions"
import { TeamConfirmation } from "./team-confirmation"

/**
 * ADDING A PLAYER.
 *
 * Player details -> their team -> confirm -> the real club joining state.
 *
 * The journey exists because the old one did not: every field was filled in,
 * "Add this child" was pressed, and the parent found out afterwards which team
 * their child had been put in, phrased as a result rather than an answer.
 * Which team a child plays for is the thing a parent came here to find out, so
 * it now gets a screen of its own before anything is created.
 *
 * ONE ALLOCATION CHAIN. The team shown comes from preview_player_allocation,
 * which runs the canonical season, regulatory age and canonical identity
 * resolvers. Nothing in this file computes an age, a band, a code mapping or a
 * season. The confirmation is not the authority either: add_child_for_guardian
 * re-runs the same chain at the moment it writes, so a stale preview can never
 * place a child anywhere.
 */

type Stage = "details" | "confirm" | "exception" | "done"

interface ChildDraft {
  key: string
  stage: Stage
  firstName: string
  surname: string
  dateOfBirth: string
  /** MALE or FEMALE. Structured, never free text -- the server validates it. */
  playingPathway: "" | "MALE" | "FEMALE"
  clubQuery: string
  club: ClubSearchResult | null
  clubOptions: ClubSearchResult[]
  allocation: PlayerAllocation | null
  allocating: boolean
  outcome: AddChildResult | null
  /** Set when the trusted path was refused and we fell back to a request. */
  requested: boolean
  submitting: boolean
  error: string | null
}

function emptyDraft(key: string): ChildDraft {
  return {
    key,
    stage: "details",
    firstName: "",
    surname: "",
    dateOfBirth: "",
    playingPathway: "",
    clubQuery: "",
    club: null,
    clubOptions: [],
    allocation: null,
    allocating: false,
    outcome: null,
    requested: false,
    submitting: false,
    error: null,
  }
}

/**
 * What actually happened, in the club's terms rather than the database's.
 *
 * None of these say "you're in the team", because none of them mean it: a
 * confirmed allocation is Ovalball agreeing which team is the normal one, and
 * the club still has to accept the player.
 */
const OUTCOME_COPY: Record<string, { title: string; body: (team: string) => string }> = {
  created_pending_team: {
    title: "Request Sent",
    body: (team) => `${team} is the right team, and the club has been asked to accept this player. They are not a member until the club confirms.`,
  },
  created_needs_club_review: {
    title: "Request Sent",
    body: () => "The club has been asked to confirm which of their teams this player joins. They will be in touch.",
  },
  under_review: {
    title: "Awaiting Verification",
    body: () => "A player profile may already exist for these details. To protect young players' information, we won't create another profile or reveal existing account details. A Team Admin will review your request to link this player to your account.",
  },
  already_linked: {
    title: "Already On Your Account",
    body: () => "This player is already linked to your account.",
  },
}

/**
 * The message add_child_for_guardian raises when its invite-only guard
 * refuses a caller who holds none of the three trusted club relationships.
 *
 * Matching on it is how this form knows to offer the request path instead of
 * stopping. It is not an authorization decision -- the server has already
 * made that, and the request path re-checks everything itself. The string is
 * kept in step with the database by add_child_error_surfacing.test.mts,
 * which reads the live function body.
 */
const INVITE_ONLY_REFUSAL = "You need an invitation from this club"

export function AddChildForm({ clubId: presetClubId, rugbyCode: presetRugbyCode }: { clubId?: string; rugbyCode?: string }) {
  const router = useRouter()
  // The first row's key must be deterministic (never crypto.randomUUID()
  // during the initial render) -- that value would be computed once
  // during SSR and again, differently, during client hydration, causing a
  // real hydration mismatch. Only rows added AFTER mount (the "+ Add
  // another child" handler below, a client-only event) may safely use a
  // random key.
  const [children, setChildren] = useState<ChildDraft[]>([emptyDraft("child-0")])
  const nextKeyRef = useRef(1)

  function updateChild(key: string, patch: Partial<ChildDraft>) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }

  async function handleClubSearch(key: string, query: string) {
    updateChild(key, { clubQuery: query, club: null })
    if (query.trim().length < 2) {
      updateChild(key, { clubOptions: [] })
      return
    }
    const options = await searchClubs(query)
    updateChild(key, { clubOptions: options })
  }

  /** Step one: ask the canonical chain which team, and show the answer. Nothing is created. */
  async function handleContinue(key: string) {
    const child = children.find((c) => c.key === key)
    if (!child) return
    const clubId = presetClubId ?? child.club?.id
    if (!child.firstName.trim() || !child.surname.trim() || !child.dateOfBirth || !child.playingPathway || !clubId) {
      updateChild(key, { error: "We need a first name, surname, date of birth, gender and club before we can work out a team." })
      return
    }
    updateChild(key, { allocating: true, error: null })
    const result = await previewAllocation(clubId, child.dateOfBirth, child.playingPathway, child.firstName)
    if (!result.ok) {
      updateChild(key, { allocating: false, error: result.error })
      return
    }
    updateChild(key, { allocating: false, allocation: result.allocation, stage: "confirm" })
  }

  /** Step two: the parent agrees this is the normal team, and the club is asked. */
  async function handleConfirm(key: string) {
    const child = children.find((c) => c.key === key)
    if (!child) return
    updateChild(key, { submitting: true, error: null, requested: false })
    const clubId = presetClubId ?? child.club!.id
    const rugbyCode = presetRugbyCode ?? child.club!.rugbyCode

    // Try the trusted path first. A parent who already holds a relationship
    // with this club -- an accepted invitation, another child there, or club
    // membership -- gets the immediate, fully-resolved outcome they always
    // did, including age-grade placement.
    const result = await addChild(child.firstName, child.surname, child.dateOfBirth, clubId, rugbyCode, child.playingPathway)

    // A brand-new parent has none of those, so the guard refuses their FIRST
    // child and would have accepted every one after it. That refusal is
    // correct safeguarding, but it used to be the end of the journey. It now
    // becomes a request: still no access, but a real next step instead of a
    // dead end.
    if (!result.ok && result.error.startsWith(INVITE_ONLY_REFUSAL)) {
      const requested = await requestChildLink(child.firstName, child.surname, child.dateOfBirth, clubId, rugbyCode, child.playingPathway)
      if (requested.ok) {
        updateChild(key, { submitting: false, requested: true, outcome: null, stage: "done" })
        router.refresh()
        return
      }
      updateChild(key, { submitting: false, error: requested.error })
      return
    }

    if (!result.ok) {
      updateChild(key, { submitting: false, error: result.error })
      return
    }

    updateChild(key, { submitting: false, outcome: result, stage: "done" })
    router.refresh()
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {children.map((child, index) => {
        const teamName = child.allocation?.displayLabel ?? "The team"
        const clubName = presetClubId ? "This club" : (child.club?.name ?? "This club")

        return (
          <div key={child.key} className="rounded-lg border border-ink/10 bg-white p-4 md:p-5">
            <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Player {index + 1}</p>

            {/*
              Announced, not merely rendered: somebody who cannot see the card
              appear still needs to be told an answer arrived.
            */}
            <div aria-live="polite" className="sr-only">
              {child.allocating ? "Working out this player's team." : child.allocation && child.stage === "confirm" ? `Team resolved: ${teamName}.` : ""}
            </div>

            {child.error && (
              <p role="alert" className="mt-2 text-sm text-destructive-text">
                {child.error}
              </p>
            )}

            {child.stage === "done" ? (
              child.requested ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-900">Awaiting Verification</p>
                  <p className="mt-0.5 text-sm text-amber-900/80">
                    We&rsquo;ve received your request and need to verify the relationship before this player appears on
                    your account. Your club will be in touch.
                  </p>
                </div>
              ) : child.outcome && child.outcome.ok ? (
                <div className="mt-3 rounded-lg bg-forest-50 px-4 py-3">
                  <p className="text-sm font-medium text-ink">{OUTCOME_COPY[child.outcome.result].title}</p>
                  <p className="mt-0.5 text-sm text-ink/60">{OUTCOME_COPY[child.outcome.result].body(teamName)}</p>
                </div>
              ) : null
            ) : child.stage === "confirm" && child.allocation ? (
              <div className="mt-3">
                <TeamConfirmation
                  playerFirstName={child.allocation.normalisedFirstName ?? child.firstName.trim()}
                  clubName={clubName}
                  allocation={child.allocation}
                  confirming={child.submitting}
                  onConfirm={() => handleConfirm(child.key)}
                  onDoesNotLookRight={() => updateChild(child.key, { stage: "exception" })}
                />
              </div>
            ) : child.stage === "exception" ? (
              <DoesNotLookRight
                playerFirstName={child.allocation?.normalisedFirstName ?? child.firstName.trim()}
                allocation={child.allocation}
                onCorrectDetails={() => updateChild(child.key, { stage: "details", allocation: null })}
                onBack={() => updateChild(child.key, { stage: "confirm" })}
              />
            ) : (
              <>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`first-${child.key}`}>First Name</Label>
                    <Input id={`first-${child.key}`} className="h-11" value={child.firstName} onChange={(e) => updateChild(child.key, { firstName: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`surname-${child.key}`}>Surname</Label>
                    <Input id={`surname-${child.key}`} className="h-11" value={child.surname} onChange={(e) => updateChild(child.key, { surname: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`dob-${child.key}`}>Date of Birth</Label>
                    <Input id={`dob-${child.key}`} className="h-11" type="date" max={new Date().toISOString().slice(0, 10)} value={child.dateOfBirth} onChange={(e) => updateChild(child.key, { dateOfBirth: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`pathway-${child.key}`}>Gender</Label>
                    <select
                      id={`pathway-${child.key}`}
                      className="h-11 rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      value={child.playingPathway}
                      onChange={(e) => updateChild(child.key, { playingPathway: e.target.value as ChildDraft["playingPathway"] })}
                      aria-describedby={`pathway-hint-${child.key}`}
                    >
                      <option value="">Select…</option>
                      <option value="MALE">Boys</option>
                      <option value="FEMALE">Girls</option>
                    </select>
                    <p id={`pathway-hint-${child.key}`} className="text-xs text-ink/55">
                      Rugby runs separate boys&apos; and girls&apos; age grades from Under-12. Below that, children play
                      mixed rugby together — we ask now so their age group is right when they get there.
                    </p>
                  </div>
                  {!presetClubId && (
                    <div className="relative">
                      <Label htmlFor={`club-${child.key}`}>Club</Label>
                      <Input id={`club-${child.key}`} className="h-11" placeholder="Search for a club" value={child.club ? child.club.name : child.clubQuery} onChange={(e) => handleClubSearch(child.key, e.target.value)} />
                      {child.clubOptions.length > 0 && !child.club && (
                        <ul className="absolute z-10 mt-1 w-full rounded-md border border-ink/10 bg-white shadow-md">
                          {child.clubOptions.map((opt) => (
                            <li key={opt.id}>
                              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-ink/5" onClick={() => updateChild(child.key, { club: opt, clubOptions: [] })}>
                                {opt.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <Button type="button" className="mt-4 h-11" disabled={child.allocating} onClick={() => handleContinue(child.key)}>
                  {child.allocating ? "Working out their team…" : "Continue"}
                </Button>
              </>
            )}
          </div>
        )
      })}

      <Button type="button" variant="outline" className="h-11 self-start" onClick={() => setChildren((prev) => [...prev, emptyDraft(`child-${nextKeyRef.current++}`)])}>
        + Add another player
      </Button>
    </div>
  )
}

/**
 * THIS DOESN'T LOOK RIGHT.
 *
 * Deliberately not a list of teams to choose from. A player's age grade is a
 * governing-body rule, not a preference, and an open dropdown here would turn
 * a safeguarding boundary into a shopping list. What it offers instead is the
 * set of things that legitimately change the answer.
 */
function DoesNotLookRight({
  playerFirstName,
  allocation,
  onCorrectDetails,
  onBack,
}: {
  playerFirstName: string
  allocation: PlayerAllocation | null
  onCorrectDetails: () => void
  onBack: () => void
}) {
  const who = playerFirstName || "this player"
  return (
    <div className="mt-3 rounded-xl border border-ink/10 bg-white p-6">
      <h3 className="font-display text-lg text-ink">Let&apos;s check</h3>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        {allocation?.displayLabel
          ? `${allocation.displayLabel} is the age group ${who}'s date of birth and gender give under the rugby age-grade rules.`
          : `Ovalball works out an age group from a player's date of birth and gender.`}{" "}
        There are a few reasons it might not be what you expected.
      </p>

      <ul className="mt-4 flex flex-col gap-3 text-sm text-ink-muted">
        <li>
          <span className="font-medium text-ink">The date of birth or gender is wrong.</span> That is the usual reason,
          and it is the one thing here you can fix yourself.
        </li>
        <li>
          <span className="font-medium text-ink">The club has asked {who} to play in another squad.</span> Clubs often
          run more than one side at an age group. Join first, and the club sorts that out.
        </li>
        <li>
          <span className="font-medium text-ink">{who} plays in a different age group by agreement.</span> Playing
          outside your own age grade needs approval from the club, and sometimes from the governing body. Ovalball
          cannot grant either &mdash; your club starts that off once the player has joined.
        </li>
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" className="h-11" onClick={onCorrectDetails}>
          Correct the Details
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 text-sm text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          The Details Are Right, Go Back
        </button>
      </div>
    </div>
  )
}
