"use client"

import { useEffect, useRef } from "react"
import { Check, Info } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

import type { PlayerAllocation } from "./actions"

/**
 * YOUR TEAM.
 *
 * The moment a parent finds out where their child plays. It has one job: give
 * the answer, say why in a sentence a person would actually say out loud, and
 * offer one obvious next step.
 *
 * GREEN MEANS RESOLVED, NOT APPROVED. The tick says Ovalball has worked out
 * the normal team for this player under the governing-body rules. It does not
 * say the club has agreed, and the copy after confirmation is careful about
 * the difference -- a parent told "you're in the team" who then turns up to
 * find nobody expecting them has been failed by the software, not the club.
 *
 * WHAT IS DELIBERATELY NOT HERE: the canonical team type id, the regulatory
 * age enum, the date-of-birth window, the rule reference, the internal pathway
 * value. A parent needs the answer, the reason, and what happens next. The
 * regulatory detail exists and is real -- it belongs in Rugby Hub, where there
 * is room to explain it properly.
 *
 * Colour is never the meaning: the tick, the words "Your Team", and the team
 * name all say the same thing without it.
 */

/** The one status where a normal team was found. Everything else is a real, different situation. */
const RESOLVED = "NORMAL_PLACEMENT"

function whyThisTeam(allocation: PlayerAllocation): string {
  const code = allocation.rugbyCode === "league" ? "Rugby League" : "Rugby Union"
  const season = allocation.seasonName ? ` for the ${allocation.seasonName} season` : ""
  return `This is worked out from the player's date of birth, their gender, and the ${code} age grades${season}.`
}

export function TeamConfirmation({
  playerFirstName,
  clubName,
  allocation,
  confirming,
  onConfirm,
  onDoesNotLookRight,
}: {
  playerFirstName: string
  clubName: string
  allocation: PlayerAllocation
  confirming: boolean
  onConfirm: () => void
  onDoesNotLookRight: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Focus moves to the answer, not to the button that acts on it: somebody
  // using a screen reader should hear which team before they are offered the
  // control that agrees to it.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const resolved = allocation.status === RESOLVED && allocation.displayLabel

  if (!resolved) {
    return <UnresolvedAllocation playerFirstName={playerFirstName} allocation={allocation} onFix={onDoesNotLookRight} />
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-6 md:p-8">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-pitch-600">
          <Check className="size-3 text-white" strokeWidth={3} />
        </span>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your Team</p>
      </div>

      <h2 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-display-m text-ink outline-none">
        {allocation.displayLabel}
      </h2>

      <p className="mt-2 max-w-md text-sm text-ink-muted">
        {allocation.displayLabel} is the team for {playerFirstName || "this player"}&apos;s age group.
      </p>

      {/*
        The club's own answer, kept separate from the identity. A club that does
        not run this team has NOT made the player a different age -- so the age
        group stays exactly where it is and no near-enough side is offered.
      */}
      {!allocation.clubRunsTeam && (
        <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3">
          <p className="text-sm text-ink">
            {clubName} does not currently run an {allocation.displayLabel} team.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            You can still request to join. The club will be in touch about where {playerFirstName || "this player"} plays
            &mdash; we will not put them in a different age group without asking.
          </p>
        </div>
      )}

      {allocation.operationalTeamCount > 1 && (
        <p className="mt-4 text-sm text-ink-muted">
          {clubName} runs more than one {allocation.displayLabel} squad. The club decides which one, once
          {playerFirstName ? ` ${playerFirstName}` : " this player"} has joined.
        </p>
      )}

      <details className="group mt-5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
          <Info className="size-3.5" aria-hidden="true" />
          Why this team?
        </summary>
        <div className="mt-2 max-w-md text-sm text-ink-muted">
          <p>{whyThisTeam(allocation)}</p>
          {allocation.rugbyCode === "union" && allocation.displayLabel?.includes("Girls") && (
            <p className="mt-2">
              Girls&apos; age grades in Rugby Union are grouped into bands covering two years, so a player&apos;s team
              name is not always the same as their own age.
            </p>
          )}
          {allocation.displayLabel?.includes("Mixed") && (
            <p className="mt-2">
              At this age everyone plays together, so boys and girls are in the same team.
            </p>
          )}
          <Link
            href="/rugby-hub"
            className="mt-2 inline-block text-forest-800 underline underline-offset-2 hover:text-forest-950"
          >
            More about age grades in Rugby Hub
          </Link>
        </div>
      </details>

      <div className="mt-6 flex flex-col gap-3">
        <Button type="button" className="h-11 w-full sm:w-auto sm:self-start sm:px-8" disabled={confirming} onClick={onConfirm}>
          {confirming ? "Sending request…" : "Confirm team"}
        </Button>
        {/*
          Deliberately quiet, and deliberately NOT a team dropdown. Picking a
          different age grade is a governing-body question, not a preference,
          so this leads to the reasons it can legitimately change.
        */}
        <button
          type="button"
          onClick={onDoesNotLookRight}
          className="min-h-11 self-start text-sm text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          This doesn&apos;t look right
        </button>
      </div>

      <p className="mt-4 max-w-md text-xs text-ink-muted">
        Confirming means you agree this is the normal team for this player. The club still needs to accept the request.
      </p>
    </div>
  )
}

/**
 * Everything that is not a normal placement, each said in its own words.
 *
 * Collapsing these into one "something went wrong" would be the easy thing and
 * the wrong one: a player at the end of the youth pathway, a competition that
 * runs no team at their age, and a missing season are three different
 * situations with three different next steps.
 */
function UnresolvedAllocation({
  playerFirstName,
  allocation,
  onFix,
}: {
  playerFirstName: string
  allocation: PlayerAllocation
  onFix: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const who = playerFirstName || "This player"

  const copy: Record<string, { title: string; body: string }> = {
    CLUB_HOLDING: {
      title: "Past the youth age grades",
      body: `${who} is older than the last youth age grade, so there is no youth team to place them in. The club can add them to an adult side themselves — Ovalball does not do that automatically.`,
    },
    NEEDS_ATTENTION: {
      title: "The club needs to look at this",
      body: `There is no team at ${who}'s age group in this competition, so a person needs to decide where they play. Ovalball will not put them in a different age group on its own.`,
    },
    CLASSIFICATION_REQUIRED: {
      title: "We need to know one more thing",
      body: `From this age the boys' and girls' age grades are separate, so Ovalball needs to know which ${who} plays in before it can say which team.`,
    },
    DOB_REQUIRED: {
      title: "Date of birth needed",
      body: "A date of birth is what decides a player's age group, so we cannot work out a team without it.",
    },
    SEASON_UNAVAILABLE: {
      title: "No season set up yet",
      body: "Ovalball does not have a season set up for this rugby code yet, so it cannot work out an age group. Your club can sort this out.",
    },
  }

  const shown = copy[allocation.status] ?? {
    title: "We could not work out a team",
    body: allocation.reason ?? "Ovalball could not resolve a team for this player. Your club can help.",
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-white p-6 md:p-8">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your Team</p>
      <h2 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-display-m text-ink outline-none">
        {shown.title}
      </h2>
      <p className="mt-2 max-w-md text-sm text-ink-muted">{shown.body}</p>
      {allocation.regulatoryAgeLabel && allocation.status === "NEEDS_ATTENTION" && (
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          {who}&apos;s age group is {allocation.regulatoryAgeLabel}.
        </p>
      )}
      <button
        type="button"
        onClick={onFix}
        className="mt-5 min-h-11 text-sm text-forest-800 underline underline-offset-2 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        Check the player&apos;s details
      </button>
    </div>
  )
}
