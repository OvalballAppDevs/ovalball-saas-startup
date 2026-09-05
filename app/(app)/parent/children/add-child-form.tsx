"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { addChild, searchClubs, type AddChildResult, type ClubSearchResult } from "./actions"

interface ChildDraft {
  key: string
  firstName: string
  surname: string
  dateOfBirth: string
  clubQuery: string
  club: ClubSearchResult | null
  clubOptions: ClubSearchResult[]
  outcome: AddChildResult | null
  submitting: boolean
}

function emptyDraft(key: string): ChildDraft {
  return { key, firstName: "", surname: "", dateOfBirth: "", clubQuery: "", club: null, clubOptions: [], outcome: null, submitting: false }
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
    if (!child.firstName.trim() || !child.surname.trim() || !child.dateOfBirth || !(presetClubId ?? child.club?.id)) {
      updateChild(key, { outcome: { ok: false, error: "First name, surname, date of birth, and club are all required." } })
      return
    }
    updateChild(key, { submitting: true, outcome: null })
    const clubId = presetClubId ?? child.club!.id
    const rugbyCode = presetRugbyCode ?? child.club!.rugbyCode
    const result = await addChild(child.firstName, child.surname, child.dateOfBirth, clubId, rugbyCode)
    updateChild(key, { submitting: false, outcome: result })
    if (result.ok) router.refresh()
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {children.map((child, index) => (
        <div key={child.key} className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Child {index + 1}</p>

          {child.outcome && !child.outcome.ok && <p className="mt-2 text-sm text-destructive">{child.outcome.error}</p>}

          {child.outcome && child.outcome.ok ? (
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

          {!(child.outcome && child.outcome.ok) && (
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
