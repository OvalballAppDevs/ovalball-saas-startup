"use client"

import { BadgeCheck, ShieldCheck } from "lucide-react"
import { useEffect, useImperativeHandle, useState, type Ref } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  AUTHORITY_DECLARATION_TEXT,
  CLAIM_ELIGIBLE_ROLES,
  CLUB_ROLES,
  COUNTRY_OPTIONS,
  EMPTY_DIRECTORY_REQUEST,
  TEAM_CATEGORY_GROUPS,
  type ClubDirectoryResult,
  type ClubSelection,
  type DirectoryRequestProposal,
  type RugbyCode,
  type SelectedTeam,
} from "@/lib/signup/types"

import { searchClubDirectory } from "../actions"
import { FormField } from "../form-field"
import { FormSelect } from "../form-select"

/**
 * What the wizard's own Back button should do while this step is active.
 * ClubStep has its own internal sub-navigation (sport code -> search ->
 * claim/join/not-found form) that the wizard has no visibility into; without
 * this, the wizard's Back always jumped straight to the *previous wizard
 * step*, skipping over whichever of those sub-screens the user was actually
 * on -- from deep in a claim form, Back would silently dump you on "Your
 * details" instead of returning to the club search, which is what read as
 * "Back does nothing useful" in practice.
 */
export interface ClubStepHandle {
  /** Returns true if handled locally (wizard should not also change step). */
  handleBack: () => boolean
}

interface ClubStepProps {
  rugbyCode: RugbyCode | null
  onRugbyCodeChange: (code: RugbyCode) => void
  /** Returns to the sport-code choice screen within this step. */
  onRugbyCodeClear: () => void
  club: ClubSelection
  onClubChange: (club: ClubSelection) => void
  /**
   * Advances the wizard to Review. Called immediately after a successful
   * claim/join/proposal submit, instead of leaving the user to find a
   * second, separate "Continue" -- an earlier version required both,
   * which read as two competing CTAs for what should be one action.
   */
  onAdvance: () => void
  ref?: Ref<ClubStepHandle>
}

type Mode = "search" | "claim" | "join" | "not-found"

export function ClubStep({
  rugbyCode,
  onRugbyCodeChange,
  onRugbyCodeClear,
  club,
  onClubChange,
  onAdvance,
  ref,
}: ClubStepProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ClubDirectoryResult[]>([])
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<Mode>("search")
  const [selected, setSelected] = useState<ClubDirectoryResult | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      handleBack: () => {
        // Deepest first: leave a claim/join/not-found form -> back to search.
        if (mode !== "search") {
          setMode("search")
          return true
        }
        // Still actively choosing a club (not yet confirmed) -> back to the
        // sport-code screen. Once a club IS confirmed, this falls through
        // (returns false) so the wizard's own Back goes to "Your details" --
        // "Change" is the deliberate, separate action for reconsidering a
        // confirmed club.
        if (rugbyCode && club.kind === "unselected") {
          onRugbyCodeClear()
          return true
        }
        return false
      },
    }),
    [mode, rugbyCode, club.kind, onRugbyCodeClear]
  )

  const queryIsSearchable = query.trim().length >= 2

  useEffect(() => {
    if (!rugbyCode || !queryIsSearchable) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see personal-details-step's sibling comment: this flags loading before the debounced fetch below resolves, not state mirrored from props.
    setSearching(true)
    const timer = setTimeout(async () => {
      const rows = await searchClubDirectory(rugbyCode, query)
      if (!cancelled) {
        setResults(rows)
        setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [rugbyCode, query, queryIsSearchable])

  const visibleResults = queryIsSearchable ? results : []

  if (!rugbyCode) {
    return (
      <div className="flex flex-col gap-6">
        <StepHeader step="Step 3" title="Your club">
          Which code does your club play?
        </StepHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CodeCard label="Rugby Union" onClick={() => onRugbyCodeChange("union")} />
          <CodeCard label="Rugby League" onClick={() => onRugbyCodeChange("league")} />
        </div>
      </div>
    )
  }

  if (mode === "claim" && selected) {
    return (
      <ClaimForm
        directory={selected}
        onBack={() => setMode("search")}
        onSubmit={(role, authorityConfirmed, teams) => {
          onClubChange({
            kind: "existing-unclaimed",
            directory: selected,
            role,
            authorityConfirmed,
            teams,
          })
          onAdvance()
        }}
      />
    )
  }

  if (mode === "join" && selected) {
    return (
      <JoinForm
        directory={selected}
        onBack={() => setMode("search")}
        onSubmit={(role) => {
          onClubChange({ kind: "existing-claimed", directory: selected, role })
          onAdvance()
        }}
      />
    )
  }

  if (mode === "not-found") {
    return (
      <NotFoundForm
        initial={club.kind === "not-found" ? club.proposal : EMPTY_DIRECTORY_REQUEST}
        initialTeams={club.kind === "not-found" ? club.teams : []}
        onBack={() => setMode("search")}
        onSubmit={(proposal, teams) => {
          onClubChange({ kind: "not-found", proposal, teams })
          onAdvance()
        }}
      />
    )
  }

  const confirmed =
    club.kind === "existing-unclaimed"
      ? { label: "Claim requested", name: club.directory.name }
      : club.kind === "existing-claimed"
        ? { label: "Access requested", name: club.directory.name }
        : club.kind === "not-found"
          ? { label: "New club proposed", name: club.proposal.clubName }
          : null

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step="Step 3" title="Your club">
        Playing {rugbyCode === "union" ? "Rugby Union" : "Rugby League"}.{" "}
        <button
          type="button"
          onClick={() => onRugbyCodeChange(rugbyCode === "union" ? "league" : "union")}
          className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          Change
        </button>
      </StepHeader>

      {confirmed && (
        <div className="flex items-center justify-between rounded-lg border border-pitch-600/30 bg-mint-100/50 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <BadgeCheck className="size-5 shrink-0 text-forest-800" />
            <div>
              <p className="text-sm font-medium text-forest-900">{confirmed.label}</p>
              <p className="text-sm text-forest-900/70">{confirmed.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClubChange({ kind: "unselected" })}
            className="shrink-0 text-sm text-ink/60 underline underline-offset-2 hover:text-ink"
          >
            Change
          </button>
        </div>
      )}

      {!confirmed && (
        <>
          <FormField
            id="club-search"
            label="Search by club name, town or postcode"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Ovalball RFC, Guildford, GU1"
          />

          {searching && (
            <div className="flex items-center gap-2 text-sm text-ink/50">
              <span className="size-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-pitch-600" />
              Searching&hellip;
            </div>
          )}

          {!searching && visibleResults.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {visibleResults.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(result)
                      setMode(result.claimed ? "join" : "claim")
                    }}
                    className="group flex w-full items-start justify-between gap-3 rounded-lg border border-ink/12 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-pitch-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-base font-medium text-ink">
                          {result.name}
                        </span>
                        {result.verified && (
                          <ShieldCheck
                            className="size-4 shrink-0 text-pitch-600"
                            aria-label="Verified"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink/55">
                        {[result.town, result.county, result.postcode]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                        result.claimed
                          ? "bg-ink/8 text-ink/60"
                          : "bg-pitch-600/12 text-forest-800"
                      )}
                    >
                      {result.claimed ? "Already on Ovalball" : "Unclaimed"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!searching && queryIsSearchable && visibleResults.length === 0 && (
            <p className="text-sm text-ink/50">
              No clubs matched &ldquo;{query}&rdquo;.
            </p>
          )}

          <div className="rounded-lg border border-dashed border-ink/15 px-4 py-3.5">
            <p className="text-sm text-ink/60">Can&apos;t find your club?</p>
            <button
              type="button"
              onClick={() => setMode("not-found")}
              className="mt-1 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Add your club for review
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function StepHeader({
  step,
  title,
  children,
}: {
  step: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
        {step}
      </p>
      <h1 className="mt-2 font-display text-display-l text-ink">{title}</h1>
      <p className="mt-3 text-base text-ink/60">{children}</p>
    </div>
  )
}

function CodeCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-ink/15 bg-white px-6 py-8 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-pitch-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
    >
      <span className="font-display text-2xl text-ink">{label}</span>
      <span className="mt-1 block text-sm text-ink/50 group-hover:text-forest-800">
        Select &rarr;
      </span>
    </button>
  )
}

function SelectedClubSummary({ directory }: { directory: ClubDirectoryResult }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <p className="text-base font-medium text-ink">{directory.name}</p>
      <p className="mt-0.5 text-sm text-ink/55">
        {[directory.town, directory.county, directory.postcode].filter(Boolean).join(" · ")}
      </p>
    </div>
  )
}

function RolePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (role: string) => void
}) {
  const isKnownRole = CLUB_ROLES.includes(value as (typeof CLUB_ROLES)[number])
  const [customRole, setCustomRole] = useState(isKnownRole ? "" : value)
  const selectValue = isKnownRole ? value : value === "" ? "" : "Other"

  return (
    <div className="flex flex-col gap-2.5">
      <FormSelect
        id="role"
        label="What is your role at the club?"
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value
          if (next === "Other") {
            onChange(customRole)
          } else {
            setCustomRole("")
            onChange(next)
          }
        }}
      >
        <option value="">Select a role&hellip;</option>
        {CLUB_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </FormSelect>
      {selectValue === "Other" && (
        <FormField
          id="role-other"
          label="Your role"
          placeholder="Tell us your role"
          value={customRole}
          onChange={(event) => {
            setCustomRole(event.target.value)
            onChange(event.target.value)
          }}
        />
      )}
    </div>
  )
}

function TeamsPicker({
  value,
  onChange,
}: {
  value: SelectedTeam[]
  onChange: (teams: SelectedTeam[]) => void
}) {
  function getTeam(category: string) {
    return value.find((t) => t.category === category)
  }

  function toggleCategory(category: string) {
    if (getTeam(category)) {
      onChange(value.filter((t) => t.category !== category))
    } else {
      onChange([...value, { category, additionalLetters: [] }])
    }
  }

  function toggleLetter(category: string, letter: string) {
    onChange(
      value.map((t) => {
        if (t.category !== category) return t
        const has = t.additionalLetters.includes(letter)
        return {
          ...t,
          additionalLetters: has
            ? t.additionalLetters.filter((l) => l !== letter)
            : [...t.additionalLetters, letter],
        }
      })
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm leading-none font-medium text-ink/80">
          Which teams does your club run?
        </p>
        <p className="mt-1.5 text-sm text-ink/45">
          Optional &mdash; tick everything that applies. If a level has more
          than one team, tick B and/or C once it&apos;s ticked; each
          registers as its own team with its own fixtures.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-4">
        {TEAM_CATEGORY_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-medium tracking-[0.06em] text-ink/40 uppercase">
              {group.label}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.categories.map((category) => {
                const team = getTeam(category)
                const checked = !!team
                return (
                  <div
                    key={category}
                    className={cn(
                      "rounded-lg border px-3.5 py-2.5 transition-colors",
                      checked ? "border-pitch-600 bg-mint-100/30" : "border-ink/12"
                    )}
                  >
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(category)}
                        className="size-4 shrink-0 accent-pitch-600"
                      />
                      <span className={checked ? "font-medium text-ink" : "text-ink/70"}>
                        {category}
                      </span>
                    </label>
                    {checked && group.allowMultiple && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
                        <span className="text-xs text-ink/45">More than one team?</span>
                        {["B", "C"].map((letter) => {
                          const active = team.additionalLetters.includes(letter)
                          return (
                            <button
                              key={letter}
                              type="button"
                              onClick={() => toggleLetter(category, letter)}
                              className={cn(
                                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                                active
                                  ? "border-forest-900 bg-forest-900 text-white"
                                  : "border-ink/15 text-ink/55 hover:border-pitch-600 hover:text-ink"
                              )}
                            >
                              {category} {letter}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ClaimForm({
  directory,
  onBack,
  onSubmit,
}: {
  directory: ClubDirectoryResult
  onBack: () => void
  onSubmit: (role: string, authorityConfirmed: boolean, teams: SelectedTeam[]) => void
}) {
  const [role, setRole] = useState("")
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false)
  const [teams, setTeams] = useState<SelectedTeam[]>([])

  const isKnownIneligibleRole = role.length > 0 && !CLAIM_ELIGIBLE_ROLES.includes(role)

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step="Step 3 · Claim" title={`Claim ${directory.name}`}>
        No one manages this club on Ovalball yet.
      </StepHeader>

      <SelectedClubSummary directory={directory} />

      <RolePicker value={role} onChange={setRole} />

      {isKnownIneligibleRole ? (
        <ClaimAuthorityNotice role={role} onChangeRole={() => setRole("")} onBack={onBack} />
      ) : (
        <>
          <TeamsPicker value={teams} onChange={setTeams} />

          <label className="flex items-start gap-3 rounded-lg border border-ink/12 bg-white px-4 py-3.5">
            <input
              type="checkbox"
              checked={authorityConfirmed}
              onChange={(event) => setAuthorityConfirmed(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-pitch-600"
            />
            <span className="text-sm text-ink/75">{AUTHORITY_DECLARATION_TEXT}</span>
          </label>
          <p className="-mt-3 text-sm text-ink/45">
            Submitting this request does not automatically grant control of the
            club. Ovalball may verify your authority before approving access.
          </p>

          <div className="flex gap-3">
            <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={onBack}>
              Back to search
            </Button>
            <Button
              type="button"
              className="h-11 rounded-lg"
              disabled={!role.trim() || !authorityConfirmed}
              onClick={() => onSubmit(role.trim(), authorityConfirmed, teams)}
            >
              Confirm claim request
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Shown instead of the rest of the claim form the moment an ineligible role
 * is selected -- never a technical error, and never lets the request reach
 * submission (club_claims_claimed_role_eligible would reject it server-side
 * regardless, but this is the honest, respectful version of that same
 * boundary). The role picker above stays visible and live, so changing the
 * answer there also clears this notice -- "Change my role" is offered again
 * here as an explicit, deliberate action for anyone who'd rather not scroll
 * back up.
 */
function ClaimAuthorityNotice({
  role,
  onChangeRole,
  onBack,
}: {
  role: string
  onChangeRole: () => void
  onBack: () => void
}) {
  return (
    <div className="rounded-lg border border-ink/12 bg-white p-5">
      <p className="text-base font-medium text-ink">
        Only people authorised to act on behalf of the club can create its
        Ovalball account.
      </p>
      <p className="mt-2 text-sm text-ink/60">
        As a {role.toLowerCase()}, your club administrator can invite you once
        the club has been set up on Ovalball &mdash; you don&apos;t need to be
        the one who sets it up.
      </p>
      <p className="mt-2 text-sm text-ink/60">
        Please make sure you have authority from the club before continuing.
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={onChangeRole}>
          Change my role
        </Button>
        <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={onBack}>
          Back to club search
        </Button>
        <Button type="button" variant="ghost" className="h-10 rounded-lg text-ink/60" onClick={onBack}>
          I&apos;ll ask my club administrator
        </Button>
      </div>
    </div>
  )
}

function JoinForm({
  directory,
  onBack,
  onSubmit,
}: {
  directory: ClubDirectoryResult
  onBack: () => void
  onSubmit: (role: string) => void
}) {
  const [role, setRole] = useState("")

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step="Step 3 · Request access" title="This club is already on Ovalball">
        An existing verified Club Admin will need to approve your request.
      </StepHeader>

      <SelectedClubSummary directory={directory} />

      <RolePicker value={role} onChange={setRole} />

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={onBack}>
          Back to search
        </Button>
        <Button
          type="button"
          className="h-11 rounded-lg"
          disabled={!role.trim()}
          onClick={() => onSubmit(role.trim())}
        >
          Confirm access request
        </Button>
      </div>
    </div>
  )
}

function NotFoundForm({
  initial,
  initialTeams,
  onBack,
  onSubmit,
}: {
  initial: DirectoryRequestProposal
  initialTeams: SelectedTeam[]
  onBack: () => void
  onSubmit: (proposal: DirectoryRequestProposal, teams: SelectedTeam[]) => void
}) {
  const [proposal, setProposal] = useState(initial)
  const [teams, setTeams] = useState<SelectedTeam[]>(initialTeams)

  function field<K extends keyof DirectoryRequestProposal>(key: K) {
    return {
      value: proposal[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setProposal({ ...proposal, [key]: event.target.value }),
    }
  }

  const canSubmit = proposal.clubName.trim().length > 0

  return (
    <div className="flex flex-col gap-6">
      <StepHeader step="Step 3 · New club" title="Add your club for review">
        New clubs are reviewed before being added to the Ovalball directory.
      </StepHeader>

      <FormField id="clubName" label="Club name" required {...field("clubName")} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm leading-none font-medium text-ink/80">
          Short description
        </label>
        <textarea
          id="bio"
          className="min-h-20 rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={proposal.bio}
          onChange={(event) => setProposal({ ...proposal, bio: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-4">
        <FormField id="addressLine1" label="Address line 1" {...field("addressLine1")} />
        <FormField id="addressLine2" label="Address line 2" {...field("addressLine2")} />
        <FormField id="addressLine3" label="Address line 3" {...field("addressLine3")} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="town" label="Town" {...field("town")} />
          <FormField id="county" label="County" {...field("county")} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormSelect
            id="country"
            label="Country"
            value={proposal.country}
            onChange={(event) => setProposal({ ...proposal, country: event.target.value })}
          >
            <option value="">Select&hellip;</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </FormSelect>
          <FormField id="postcode" label="Club postcode" {...field("postcode")} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id="phone" label="Club telephone" type="tel" {...field("phone")} />
          <FormField id="email" label="Club email" type="email" {...field("email")} />
        </div>
      </div>

      <TeamsPicker value={teams} onChange={setTeams} />

      <p className="text-sm text-ink/45">
        Club logo upload is added once your account is confirmed, on the next
        screen after signup &mdash; not part of this form.
      </p>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={onBack}>
          Back to search
        </Button>
        <Button
          type="button"
          className="h-11 rounded-lg"
          disabled={!canSubmit}
          onClick={() => onSubmit(proposal, teams)}
        >
          Confirm proposal
        </Button>
      </div>
    </div>
  )
}
