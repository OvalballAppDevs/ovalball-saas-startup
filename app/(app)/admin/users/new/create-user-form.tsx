"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createUser, type IntendedAssignment } from "./actions"

const MIN_REASON = 10

export interface WizardOptions {
  clubs: { id: string; name: string }[]
  teams: { id: string; name: string; clubName: string }[]
  players: { id: string; name: string }[]
  clubRoles: { key: string; label: string }[]
  teamRoles: { key: string; label: string }[]
}

type Step = "identity" | "assignments" | "review"

/**
 * CREATE USER -- AB.4's three steps (S7-6).
 *
 * The RPC has accepted `p_intended` since Slice 7b and applies each entry
 * through the same master-control function the Users & Access screen would call,
 * so each re-checks its own capability. Nothing ever sent it anything. The
 * reconciliation recorded this as PARTIALLY IMPLEMENTED — "delivered as a
 * single-step form" — and the consequence was not cosmetic: creating somebody
 * and then giving them access were two separate audited acts with two separate
 * reasons, and the second one was routinely forgotten, leaving accounts that
 * existed and could do nothing.
 *
 * Why the assignments are applied in ONE call rather than by the new record's own
 * tabs afterwards: the RPC deliberately does not wrap them in a sub-transaction.
 * If an assignment is refused the whole creation fails and the auth identity is
 * deleted, because a half-assigned person is worse than no person — nobody would
 * know which half. That guarantee only exists if they travel together.
 *
 * Site Admin is not offered on this form at any step. It takes two
 * administrators, and a checkbox on a create form is exactly the single-handed
 * route Slice 7c closed; the RPC refuses the kind outright if one ever appears.
 */
export function CreateUserForm({ options }: { options: WizardOptions }) {
  const [step, setStep] = useState<Step>("identity")
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [surname, setSurname] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [reason, setReason] = useState("")
  const [assignments, setAssignments] = useState<IntendedAssignment[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingUserId, setExistingUserId] = useState<string | null>(null)
  const [createdUserId, setCreatedUserId] = useState<string | null>(null)

  const identityReady = email.includes("@") && firstName.trim().length > 0 && surname.trim().length > 0
  const reasonReady = reason.trim().length >= MIN_REASON

  function reset() {
    setCreatedUserId(null)
    setStep("identity")
    setEmail("")
    setFirstName("")
    setSurname("")
    setDateOfBirth("")
    setReason("")
    setAssignments([])
  }

  async function submit() {
    if (!identityReady || !reasonReady) return
    setWorking(true)
    setError(null)
    setExistingUserId(null)
    const result = await createUser({
      email,
      firstName,
      surname,
      dateOfBirth: dateOfBirth || null,
      reason,
      intended: assignments,
    })
    setWorking(false)
    if (result.ok) {
      setCreatedUserId(result.userId)
    } else {
      setError(result.error)
      setExistingUserId(result.existingUserId ?? null)
    }
  }

  if (createdUserId) {
    return (
      <div className="mt-8 rounded-lg border border-pitch-600/25 bg-pitch-50/40 p-5">
        <p className="text-sm font-medium text-ink">Account created</p>
        <p className="mt-1 text-sm text-ink-muted">
          {firstName} {surname} has been emailed a setup link. They choose their own password and set up an
          authenticator before the account becomes active; until then it shows as Setup Incomplete.
          {assignments.length > 0
            ? ` ${assignments.length === 1 ? "One assignment was" : `${assignments.length} assignments were`} applied and recorded against their account.`
            : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" className="h-9" nativeButton={false} render={<a href={`/admin/users/${createdUserId}`} />}>
            Open Their Record
          </Button>
          <Button type="button" variant="ghost" className="h-9" onClick={reset}>
            Create Another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      <StepIndicator step={step} />

      {step === "identity" && (
        <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-email">Email Address</Label>
            <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            <p className="text-xs text-ink-muted">The setup link goes here. It is how they prove the address is theirs.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-first">First Name</Label>
              <Input id="cu-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-surname">Surname</Label>
              <Input id="cu-surname" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-dob">Date of Birth</Label>
            <Input id="cu-dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            <p className="text-xs text-ink-muted">
              Optional here, but needed before they can hold any role &mdash; Ovalball does not guess somebody&apos;s
              age. A role you add on the next step will be refused without it.
            </p>
          </div>

          <div>
            <Button type="button" className="h-10" disabled={!identityReady} onClick={() => setStep("assignments")}>
              Continue to Assignments
            </Button>
          </div>
        </div>
      )}

      {step === "assignments" && (
        <AssignmentsStep
          options={options}
          assignments={assignments}
          onChange={setAssignments}
          onBack={() => setStep("identity")}
          onNext={() => setStep("review")}
        />
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
          <div>
            <p className="text-sm font-medium text-ink">Who this creates</p>
            <p className="mt-1 text-sm text-ink-muted">
              {firstName} {surname} &middot; {email}
              {dateOfBirth ? ` · born ${dateOfBirth}` : " · no date of birth on file"}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-ink">What they will be given</p>
            {assignments.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">
                Nothing. The account will exist and be able to do nothing until somebody gives it access.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {assignments.map((assignment, index) => (
                  <li key={index} className="rounded-md border border-ink/10 bg-white/60 px-3 py-2 text-sm text-ink">
                    {describe(assignment, options)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-muted">
              These are applied together with the account. If any one of them is refused &mdash; an age rule, a
              capability you do not hold &mdash; nothing is created at all, so there is never a half-set-up person.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm text-ink">
            <span className="font-medium">Reason</span>
            <span className="text-xs font-normal text-ink-muted">
              Why this account is being made for them rather than by them. Read later by somebody who was not here, and
              recorded against every assignment above as well.
            </span>
            <textarea
              className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
              value={reason}
              maxLength={500}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder="Their club asked us to set them up; they cannot receive the self-signup email at work."
            />
          </label>

          {error && (
            <div className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2">
              <p className="text-sm text-destructive-text">{error}</p>
              {existingUserId && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-9"
                  nativeButton={false}
                  render={<a href={`/admin/users/${existingUserId}`} />}
                >
                  Open Existing User
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="h-10" disabled={!reasonReady || working} onClick={submit}>
              {working ? "Creating…" : "Create User"}
            </Button>
            <Button type="button" variant="ghost" className="h-10" disabled={working} onClick={() => setStep("assignments")}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "identity", label: "Identity" },
    { key: "assignments", label: "Assignments" },
    { key: "review", label: "Review" },
  ]
  // `flex-wrap` is load-bearing, not tidying: three pills and two arrows are 335
  // pixels wide, and a 320px screen is the narrowest Ovalball supports. Without
  // it the whole page scrolls sideways, which the browser gate measures and which
  // is how this was caught.
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map(({ key, label }, index) => (
        <li key={key} className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 font-medium ${
              key === step ? "bg-forest-800 text-white" : "bg-ink/8 text-ink-muted"
            }`}
          >
            {index + 1}. {label}
          </span>
          {index < steps.length - 1 && <span className="text-ink-muted">&rarr;</span>}
        </li>
      ))}
    </ol>
  )
}

function AssignmentsStep({
  options,
  assignments,
  onChange,
  onBack,
  onNext,
}: {
  options: WizardOptions
  assignments: IntendedAssignment[]
  onChange: (next: IntendedAssignment[]) => void
  onBack: () => void
  onNext: () => void
}) {
  const [kind, setKind] = useState<IntendedAssignment["kind"]>("CLUB_MEMBERSHIP")
  const [draft, setDraft] = useState<IntendedAssignment>({ kind: "CLUB_MEMBERSHIP" })

  function choose(next: IntendedAssignment["kind"]) {
    setKind(next)
    setDraft({ kind: next })
  }

  const complete =
    (kind === "CLUB_MEMBERSHIP" && Boolean(draft.clubId)) ||
    (kind === "CLUB_ROLE" && Boolean(draft.clubId && draft.roleKey)) ||
    (kind === "TEAM_ROLE" && Boolean(draft.teamId && draft.roleKey)) ||
    (kind === "GUARDIAN_LINK" && Boolean(draft.playerId && draft.relationshipType))

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-5">
      <div>
        <p className="text-sm font-medium text-ink">What should this account be able to do?</p>
        <p className="mt-1 text-sm text-ink-muted">
          Optional. An account with nothing here exists and can do nothing, which is a perfectly reasonable thing to
          create &mdash; but it is the step people forget, and then wonder why the person cannot see their club.
        </p>
      </div>

      {assignments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {assignments.map((assignment, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-3 rounded-md border border-ink/10 bg-white/60 px-3 py-2"
            >
              <span className="text-sm text-ink">{describe(assignment, options)}</span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-destructive-text hover:bg-destructive/10"
                onClick={() => onChange(assignments.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-dashed border-ink/20 p-4">
        <label className="flex flex-col gap-1.5 text-sm text-ink">
          <span className="font-medium">Kind</span>
          <select
            id="cu-assignment-kind"
            className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            value={kind}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => choose(e.target.value as IntendedAssignment["kind"])}
          >
            <option value="CLUB_MEMBERSHIP">Club membership</option>
            <option value="CLUB_ROLE">Club role</option>
            <option value="TEAM_ROLE">Team role</option>
            <option value="GUARDIAN_LINK">Guardian of a child</option>
          </select>
        </label>

        {(kind === "CLUB_MEMBERSHIP" || kind === "CLUB_ROLE") && (
          <Picker
            id="cu-assignment-club"
            label="Club"
            value={draft.clubId ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, clubId: v }))}
            options={options.clubs.map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
        {kind === "CLUB_ROLE" && (
          <Picker
            id="cu-assignment-club-role"
            label="Role"
            value={draft.roleKey ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, roleKey: v }))}
            options={options.clubRoles.map((r) => ({ value: r.key, label: r.label }))}
          />
        )}
        {kind === "TEAM_ROLE" && (
          <>
            <Picker
              id="cu-assignment-team"
              label="Team"
              value={draft.teamId ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, teamId: v }))}
              options={options.teams.map((t) => ({ value: t.id, label: `${t.clubName} — ${t.name}` }))}
            />
            <Picker
              id="cu-assignment-team-role"
              label="Role"
              value={draft.roleKey ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, roleKey: v }))}
              options={options.teamRoles.map((r) => ({ value: r.key, label: r.label }))}
            />
          </>
        )}
        {kind === "GUARDIAN_LINK" && (
          <>
            <Picker
              id="cu-assignment-player"
              label="Child"
              value={draft.playerId ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, playerId: v }))}
              options={options.players.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Picker
              id="cu-assignment-relationship"
              label="Relationship"
              value={draft.relationshipType ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, relationshipType: v }))}
              options={[
                { value: "parent", label: "Parent" },
                { value: "guardian", label: "Guardian" },
                { value: "carer", label: "Carer" },
                { value: "other_with_parental_responsibility", label: "Other with parental responsibility" },
              ]}
            />
          </>
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={!complete}
            onClick={() => {
              onChange([...assignments, draft])
              setDraft({ kind })
            }}
          >
            Add This Assignment
          </Button>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        Site Admin access is not offered here. It takes two administrators, and is raised from the person&apos;s own
        record once they exist.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="h-10" onClick={onNext}>
          Continue to Review
        </Button>
        <Button type="button" variant="ghost" className="h-10" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  )
}

function Picker({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-ink">
      <span className="font-medium">{label}</span>
      <select
        id={id}
        className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        <option value="">Choose&hellip;</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function describe(assignment: IntendedAssignment, options: WizardOptions): string {
  const club = options.clubs.find((c) => c.id === assignment.clubId)?.name
  const team = options.teams.find((t) => t.id === assignment.teamId)
  const player = options.players.find((p) => p.id === assignment.playerId)?.name
  switch (assignment.kind) {
    case "CLUB_MEMBERSHIP":
      return `Member of ${club ?? "a club"}`
    case "CLUB_ROLE":
      return `${options.clubRoles.find((r) => r.key === assignment.roleKey)?.label ?? assignment.roleKey} at ${club ?? "a club"}`
    case "TEAM_ROLE":
      return `${options.teamRoles.find((r) => r.key === assignment.roleKey)?.label ?? assignment.roleKey} for ${
        team ? `${team.clubName} — ${team.name}` : "a team"
      }`
    case "GUARDIAN_LINK":
      return `${assignment.relationshipType === "parent" ? "Parent" : "Guardian"} of ${player ?? "a child"}`
  }
}
