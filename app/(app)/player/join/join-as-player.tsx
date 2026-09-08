"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  createOwnPlayerProfile,
  previewMyCategory,
  requestToJoinClub,
  searchClubsForPlayer,
  type AdultCategory,
  type ClubSearchResult,
} from "./actions"

/**
 * Profile -> club -> your rugby category -> request.
 *
 * The confirmation deliberately mirrors the guardian journey's, because it is
 * the same moment: this is what Ovalball has worked out, here is why, and here
 * is what happens next. What it must never do is put a number on it. A Union
 * club runs a 1st, a 2nd and a 3rd XV, and which one somebody plays in is the
 * club's judgement after seeing them play -- so this screen says the category
 * and stops, and the club decides the squad on approval.
 */
export function JoinAsPlayer({
  playerId,
  firstName,
  hasProfile,
  className,
}: {
  playerId: string | null
  firstName: string
  /** True once a date of birth and gender are recorded. */
  hasProfile: boolean
  className?: string
}) {
  const router = useRouter()
  const [stage, setStage] = useState<"profile" | "club" | "confirm" | "sent">(hasProfile ? "club" : "profile")

  const [first, setFirst] = useState(firstName)
  const [surname, setSurname] = useState("")
  const [dob, setDob] = useState("")
  const [pathway, setPathway] = useState<"" | "MALE" | "FEMALE">("")

  const [clubQuery, setClubQuery] = useState("")
  const [clubOptions, setClubOptions] = useState<ClubSearchResult[]>([])
  const [club, setClub] = useState<ClubSearchResult | null>(null)

  const [category, setCategory] = useState<AdultCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSaveProfile() {
    if (!first.trim() || !surname.trim() || !dob || !pathway) {
      setError("We need your first name, surname, date of birth and whether you play in the men's or women's game.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await createOwnPlayerProfile(first, surname, dob, pathway)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // The server now holds the profile. Re-reading it is what makes a refresh
    // or a re-login land back here rather than starting again.
    router.refresh()
    setStage("club")
  }

  async function handleClubSearch(value: string) {
    setClubQuery(value)
    setClub(null)
    if (value.trim().length < 2) {
      setClubOptions([])
      return
    }
    setClubOptions(await searchClubsForPlayer(value))
  }

  async function handleContinue() {
    if (!club) {
      setError("Choose the club you want to join.")
      return
    }
    setBusy(true)
    setError(null)
    // The profile is the authority: the server reads this player's own stored
    // date of birth and pathway rather than anything held in this browser.
    const result = await previewMyCategory(club.id, dob, pathway || "")
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCategory(result.category)
    setStage("confirm")
  }

  async function handleRequest() {
    if (!playerId || !club) return
    setBusy(true)
    setError(null)
    const result = await requestToJoinClub(playerId, club.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStage("sent")
    router.refresh()
  }

  return (
    <div className={className}>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive-text">
          {error}
        </p>
      )}

      {stage === "profile" && (
        <div className="rounded-xl border border-ink/10 bg-white p-6">
          <h2 className="font-display text-lg text-ink">Your Player Profile</h2>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            Your date of birth and whether you play in the men&apos;s or women&apos;s game are what decide your rugby
            category. Ovalball never assumes either.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="player-first">First Name</Label>
              <Input id="player-first" className="h-11" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="player-surname">Surname</Label>
              <Input id="player-surname" className="h-11" value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="player-dob">Date of Birth</Label>
              <Input
                id="player-dob"
                className="h-11"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="player-pathway">Gender</Label>
              <select
                id="player-pathway"
                className="h-11 rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
                value={pathway}
                onChange={(e) => setPathway(e.target.value as "" | "MALE" | "FEMALE")}
                aria-describedby="player-pathway-hint"
              >
                <option value="">Select…</option>
                <option value="MALE">Men&apos;s</option>
                <option value="FEMALE">Women&apos;s</option>
              </select>
              <p id="player-pathway-hint" className="text-xs text-ink/55">
                Adult rugby is played as a men&apos;s or a women&apos;s game. This is recorded once.
              </p>
            </div>
          </div>
          <Button type="button" className="mt-4 h-11" disabled={busy} onClick={handleSaveProfile}>
            {busy ? "Saving…" : "Continue"}
          </Button>
        </div>
      )}

      {stage === "club" && (
        <div className="rounded-xl border border-ink/10 bg-white p-6">
          <h2 className="font-display text-lg text-ink">Which club?</h2>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            Search for the club you want to join. Finding a club here does not join you to it &mdash; they still decide.
          </p>
          <div className="relative mt-4 max-w-sm">
            <Label htmlFor="player-club">Club</Label>
            <Input
              id="player-club"
              className="h-11"
              placeholder="Search for a club"
              value={club ? club.name : clubQuery}
              onChange={(e) => handleClubSearch(e.target.value)}
            />
            {clubOptions.length > 0 && !club && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-ink/10 bg-white shadow-md">
                {clubOptions.map((opt) => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-ink/5"
                      onClick={() => {
                        setClub(opt)
                        setClubOptions([])
                      }}
                    >
                      {opt.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="button" className="mt-4 h-11" disabled={busy || !club} onClick={handleContinue}>
            {busy ? "Working Out Your Category…" : "Continue"}
          </Button>
        </div>
      )}

      {stage === "confirm" && category && club && (
        <CategoryConfirmation
          category={category}
          clubName={club.name}
          busy={busy}
          onRequest={handleRequest}
          onBack={() => setStage("club")}
        />
      )}

      {stage === "sent" && (
        <div className="rounded-xl border border-ink/10 bg-white p-6">
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Request Sent</p>
          <h2 className="mt-3 font-display text-display-m text-ink">{club?.name}</h2>
          <p className="mt-2 max-w-md text-sm text-ink-muted">
            Your request has been sent. The club will place you in the right side and let you know. You are not a member
            of a team until they do.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * YOUR RUGBY CATEGORY.
 *
 * Two genuinely different answers, and the difference is not cosmetic.
 *
 * Where the code offers one adult identity -- Rugby League's Open Age -- there
 * IS a team, and it is named.
 *
 * Where it offers several -- Rugby Union's numbered XVs -- there is a category
 * and no honest way to pick between them from a date of birth. Saying "Your
 * Team: Men's 1st Team" to a new player would be an invention, and a
 * conspicuous one to anybody who has played club rugby.
 */
function CategoryConfirmation({
  category,
  clubName,
  busy,
  onRequest,
  onBack,
}: {
  category: AdultCategory
  clubName: string
  busy: boolean
  onRequest: () => void
  onBack: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const isTeam = category.status === "ADULT_TEAM"
  const isCategory = category.status === "ADULT_CATEGORY"

  if (!isTeam && !isCategory) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-white p-6">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Your Rugby Category</p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-display-m text-ink outline-none">
          We could not work this out
        </h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          {category.reason ?? "Ovalball could not resolve a rugby category for you at this club."}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 min-h-11 text-sm text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          Choose a Different Club
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-6 md:p-8">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-pitch-600">
          <Check className="size-3 text-white" strokeWidth={3} />
        </span>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
          {isTeam ? "Your Team" : "Your Rugby Category"}
        </p>
      </div>

      <h2 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-display-m text-ink outline-none">
        {category.displayLabel}
      </h2>

      {isTeam ? (
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          {category.displayLabel} is the team you would be registering for at {clubName}.
        </p>
      ) : (
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          Your request will be sent to {clubName} so they can place you in the right side. Which team you play in is
          theirs to decide once they have seen you play &mdash; it is not something a date of birth can answer.
        </p>
      )}

      {!category.clubRunsTeam && (
        <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-50/60 px-4 py-3">
          <p className="text-sm text-ink">{clubName} does not currently run a side in this category.</p>
          <p className="mt-1 text-sm text-ink-muted">
            You can still ask to join, and the club will be in touch.
          </p>
        </div>
      )}

      <details className="group mt-5">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
          <Info className="size-3.5" aria-hidden="true" />
          Why this category?
        </summary>
        <div className="mt-2 max-w-md text-sm text-ink-muted">
          <p>{category.reason}</p>
        </div>
      </details>

      <div className="mt-6 flex flex-col gap-3">
        <Button type="button" className="h-11 w-full sm:w-auto sm:self-start sm:px-8" disabled={busy} onClick={onRequest}>
          {busy ? "Sending Request…" : "Request to Join"}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 self-start text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Choose a Different Club
        </button>
      </div>

      <p className="mt-4 max-w-md text-xs text-ink-muted">
        Requesting does not join you to a team. {clubName} still has to accept you.
      </p>
    </div>
  )
}
