"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { addChild, requestChildLink, searchClubs, type AddChildResult, type ClubSearchResult } from "./actions"

interface ChildDraft {
  key: string
  firstName: string
  surname: string
  dateOfBirth: string
  /** MALE or FEMALE. Structured, never free text -- the server validates it. */
  playingPathway: "" | "MALE" | "FEMALE"
  clubQuery: string
  club: ClubSearchResult | null
  clubOptions: ClubSearchResult[]
  outcome: AddChildResult | null
  /** Set when the trusted path was refused and we fell back to a request. */
  requested: boolean
  submitting: boolean
}

function emptyDraft(key: string): ChildDraft {
  return { key, firstName: "", surname: "", dateOfBirth: "", playingPathway: "", clubQuery: "", club: null, clubOptions: [], outcome: null, requested: false, submitting: false }
}

const OUTCOME_COPY: Record<string, { title: string; body: (ageGrade: string) => string }> = {
  created_pending_team: {
    title: "Added — awaiting the club",
    body: (g) => `We've resolved this player's rugby age group as ${g}. The club needs to confirm them onto the team before they're a full member.`,
  },
  created_needs_club_review: {
    title: "Added — needs the club's confirmation",
    body: (g) => `We've resolved this player's rugby age group as ${g}. The club doesn't have a single obvious team for this age group yet, so they'll confirm the right team directly.`,
  },
  under_review: {
    title: "We need the club to confirm this relationship",
    body: () => "A player profile may already exist for these details. To protect young players' information, we won't create another profile or reveal existing account details. A Team Admin will review your request to link this player to your account.",
  },
  already_linked: {
    title: "Already on your account",
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

/**
 * Add one or more children in one journey. Each child is submitted
 * independently server-side (add_child_for_guardian) -- one child failing
 * or needing club review never rolls back another child's success, and
 * each row shows its own outcome using the RPC's own server-resolved
 * result, never a client-side guess.
 */
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

  async function handleSubmit(key: string) {
    const child = children.find((c) => c.key === key)
    if (!child) return
    if (!child.firstName.trim() || !child.surname.trim() || !child.dateOfBirth || !child.playingPathway || !(presetClubId ?? child.club?.id)) {
      updateChild(key, { outcome: { ok: false, error: "First name, surname, date of birth, and club are all required." } })
      return
    }
    updateChild(key, { submitting: true, outcome: null, requested: false })
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
        updateChild(key, { submitting: false, requested: true, outcome: null })
        router.refresh()
        return
      }
      updateChild(key, { submitting: false, outcome: { ok: false, error: requested.error } })
      return
    }

    updateChild(key, { submitting: false, outcome: result })
    if (result.ok) router.refresh()
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {children.map((child, index) => (
        <div key={child.key} className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Child {index + 1}</p>

          {child.outcome && !child.outcome.ok && <p className="mt-2 text-sm text-destructive-text">{child.outcome.error}</p>}

          {child.requested ? (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-medium text-amber-900">Pending verification</p>
              <p className="mt-0.5 text-sm text-amber-900/80">
                We&rsquo;ve received your request and need to verify the relationship before this child appears on your account. Your club will be in
                touch. You&rsquo;ll see the request under &ldquo;Awaiting verification&rdquo; until then.
              </p>
            </div>
          ) : child.outcome && child.outcome.ok ? (
            <div className="mt-2 rounded-md bg-forest-50 px-3 py-2.5">
              <p className="text-sm font-medium text-ink">{OUTCOME_COPY[child.outcome.result].title}</p>
              <p className="mt-0.5 text-sm text-ink/60">{OUTCOME_COPY[child.outcome.result].body(child.outcome.ageGrade)}</p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`first-${child.key}`}>First name</Label>
                <Input id={`first-${child.key}`} value={child.firstName} onChange={(e) => updateChild(child.key, { firstName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`surname-${child.key}`}>Surname</Label>
                <Input id={`surname-${child.key}`} value={child.surname} onChange={(e) => updateChild(child.key, { surname: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`dob-${child.key}`}>Date of birth</Label>
                <Input id={`dob-${child.key}`} type="date" max={new Date().toISOString().slice(0, 10)} value={child.dateOfBirth} onChange={(e) => updateChild(child.key, { dateOfBirth: e.target.value })} />
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
                  <Input id={`club-${child.key}`} placeholder="Search for a club" value={child.club ? child.club.name : child.clubQuery} onChange={(e) => handleClubSearch(child.key, e.target.value)} />
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
          )}

          {!child.requested && !(child.outcome && child.outcome.ok) && (
            <Button type="button" className="mt-3 h-9" disabled={child.submitting} onClick={() => handleSubmit(child.key)}>
              {child.submitting ? "Adding…" : "Add this child"}
            </Button>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" className="self-start" onClick={() => setChildren((prev) => [...prev, emptyDraft(`child-${nextKeyRef.current++}`)])}>
        + Add another child
      </Button>
    </div>
  )
}
