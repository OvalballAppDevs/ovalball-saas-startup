"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleAlert, CircleCheck, Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { DISPENSATION_NOT_A_GRANT, DISPENSATION_REASON_MAX } from "@ovalball/contracts/team/dispensation"
import {
  ageGradeWords,
  teamCodeFitMayBeDispensed,
  teamCodeFitSentence,
  teamCodeOptions,
  type TeamCodeChoices,
  type TeamCodeFit,
  type TeamCodeSubject,
} from "@ovalball/contracts/team/team-code"

import { checkTeamCodeFitAction } from "./actions"

/**
 * WHO A TEAM CODE IS FOR -- the website's half of the one join journey (team codes place players,
 * 20270741000000; the layouts the product owner approved on 2026-10-05). The phone draws the same three
 * steps from the same server answers: Who Is Joining?, Add Your Child, and an adult's Your Details.
 *
 * Every answer is the server's (`team_code_choices`, `team_code_fit_check`), and sending goes through the
 * one redemption path, which re-decides all of it. Nothing here grants anything.
 *
 * A CHILD WHO DOES NOT FIT stays greyed -- the normal way in is closed -- and, where the server says a
 * dispensation may be asked for, the row offers Request Dispensation: a reason, then the place and the
 * dispensation are asked for together, and nothing happens until the club's Safeguarding Officer or a Club
 * Admin approves it (20270742000000).
 */
export function TeamCodeSteps({
  choices,
  secret,
  pending,
  error,
  onSend,
}: {
  choices: TeamCodeChoices
  secret: { token?: string | null; code?: string | null }
  pending: boolean
  error: string | null
  onSend: (subject: TeamCodeSubject) => void
}) {
  const options = useMemo(() => teamCodeOptions(choices), [choices])
  const [picked, setPicked] = useState<string | null>(null)
  const [step, setStep] = useState<"who" | "child" | "details">("who")
  const [asking, setAsking] = useState<{ playerId: string; firstName: string; label: string; misfit: string | null } | null>(null)
  const selected = options.find((o) => o.key === (picked ?? options.find((x) => !x.disabled)?.key)) ?? null

  if (asking) {
    return <DispensationStep child={asking} choices={choices} pending={pending} error={error} onBack={() => setAsking(null)} onSend={onSend} />
  }
  if (step !== "who") {
    return <DetailsStep mode={step} choices={choices} secret={secret} pending={pending} error={error} onBack={() => setStep("who")} onSend={onSend} />
  }

  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault()
        if (!selected || selected.disabled) return
        if (selected.next) setStep(selected.next)
        else if (selected.subject) onSend(selected.subject)
      }}
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className="p-0 text-sm font-medium text-ink">Who Is Joining?</legend>
        <div className="mt-3 flex flex-col gap-2">
          {options.map((o) => {
            const checked = selected?.key === o.key
            const row = (
              <label
                key={o.key}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-4 py-3.5 transition-colors",
                  o.disabled ? "cursor-not-allowed border-ink/10 bg-white opacity-60" : "cursor-pointer",
                  !o.disabled && (checked ? "border-forest-800 bg-forest-800/[0.06]" : "border-ink/12 bg-white hover:border-ink/25"),
                  o.requestDispensation && "rounded-b-none border-b-0"
                )}
              >
                <input
                  type="radio"
                  name="team-code-who"
                  value={o.key}
                  checked={checked}
                  disabled={o.disabled}
                  onChange={() => setPicked(o.key)}
                  className="mt-1 size-4 shrink-0 accent-forest-800"
                />
                <span className="min-w-0">
                  <span className="block text-base font-medium text-ink">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-sm text-ink/60">{o.description}</span>}
                </span>
              </label>
            )
            if (!o.requestDispensation) return row
            const child = o.requestDispensation
            return (
              <div key={o.key}>
                {row}
                {/* The greyed row's one way forward: an exception the club decides, never the normal way in. */}
                <div className="flex flex-col gap-2 rounded-b-lg border border-t-0 border-ink/10 bg-white px-4 pb-3.5 pl-11 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-ink-muted">The club can make an exception.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 self-start sm:self-auto"
                    disabled={pending}
                    aria-label={`Request a dispensation for ${o.label}`}
                    onClick={() => setAsking({ playerId: child.playerId, firstName: child.firstName, label: o.label, misfit: o.description })}
                  >
                    Request Dispensation
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </fieldset>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-5 h-12 w-full px-6 sm:w-auto" disabled={pending || !selected || selected.disabled}>
        {pending ? "Sending…" : selected?.next ? "Continue" : "Send Request"}
      </Button>
    </form>
  )
}

function DetailsStep({
  mode,
  choices,
  secret,
  pending,
  error,
  onBack,
  onSend,
}: {
  mode: "child" | "details"
  choices: TeamCodeChoices
  secret: { token?: string | null; code?: string | null }
  pending: boolean
  error: string | null
  onBack: () => void
  onSend: (subject: TeamCodeSubject) => void
}) {
  const team = choices.team
  const club = team.clubName ?? "the club"
  const child = mode === "child"
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [dob, setDob] = useState("")
  const [gender, setGender] = useState<"MALE" | "FEMALE" | null>(null)
  const [fitAnswer, setFitAnswer] = useState<{ key: string; fit: TeamCodeFit | null } | null>(null)
  const [askDispensation, setAskDispensation] = useState(false)
  const [reason, setReason] = useState("")

  // THE CANONICAL FIT, asked of the server as they type -- it alone holds the season and the rule. An answer
  // counts only for the date and gender it was asked about, so a stale one is never shown.
  const fitKey = `${dob}|${gender ?? ""}`
  const fit = fitAnswer?.key === fitKey ? fitAnswer.fit : null
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !gender) return
    let live = true
    const asked = `${dob}|${gender}`
    const timer = setTimeout(() => {
      checkTeamCodeFitAction(secret, dob, gender).then((v) => live && setFitAnswer({ key: asked, fit: v }))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [dob, gender, secret])

  const named = !child || (first.trim().length > 0 && last.trim().length > 0)
  const mayAsk = child && teamCodeFitMayBeDispensed(fit)
  const asking = mayAsk && askDispensation
  const ready = named && !!dob && !!gender && (fit === "FITS" || (asking && reason.trim().length > 0))
  const grade = ageGradeWords(team.ageGroup)
  const childName = first.trim() || "your child"
  const fitWords = fit && fit !== "FITS" ? teamCodeFitSentence(fit, team) : null

  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || !gender) return
        onSend(
          child
            ? { for: "NEW_CHILD", firstName: first, surname: last, dateOfBirth: dob, playingPathway: gender, dispensationReason: asking ? reason : null }
            : { for: "SELF", dateOfBirth: dob, playingPathway: gender }
        )
      }}
    >
      <h2 className="font-display text-display-s text-ink">{child ? "Add Your Child" : "Your Details"}</h2>
      <p className="mt-1 text-base text-ink/60">{child ? `They join ${team.label} once ${club} approves.` : `Ovalball checks you fit ${team.label} before the team decides.`}</p>

      <div className="mt-5 flex flex-col gap-4">
        {child && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="team-code-first">First Name</Label>
              <Input id="team-code-first" className="mt-2" autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="team-code-last">Last Name</Label>
              <Input id="team-code-last" className="mt-2" autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
        )}
        <div className="sm:max-w-xs">
          <Label htmlFor="team-code-dob">Date of Birth</Label>
          <Input id="team-code-dob" type="date" className="mt-2" value={dob} onChange={(e) => setDob(e.target.value)} />
          <div aria-live="polite" className="mt-2 min-h-5 text-sm">
            {fit === "FITS" && (
              <span className="inline-flex items-center gap-1.5 text-forest-800">
                <CircleCheck className="size-4" aria-hidden="true" />
                {grade ? `Fits ${grade}` : `Fits ${team.label}`}
              </span>
            )}
            {fitWords && (
              <span className="inline-flex items-start gap-1.5 text-amber-800">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {fitWords}
              </span>
            )}
          </div>
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="p-0 text-sm font-medium text-ink">Gender</legend>
          <div className="mt-2 flex gap-2">
            {(["MALE", "FEMALE"] as const).map((g) => (
              <label
                key={g}
                className={cn(
                  "flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 text-base sm:flex-none sm:min-w-32",
                  gender === g ? "border-forest-800 bg-mint-100 text-forest-800" : "border-ink/12 bg-white text-ink hover:border-ink/25"
                )}
              >
                <input type="radio" name="team-code-gender" value={g} checked={gender === g} onChange={() => setGender(g)} className="sr-only" />
                {gender === g && <CircleCheck className="size-4" aria-hidden="true" />}
                {g === "MALE" ? "Male" : "Female"}
              </label>
            ))}
          </div>
        </fieldset>
        {mayAsk && !asking && (
          <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
            <p className="text-sm text-ink">
              {childName === "your child" ? "Your child doesn't" : `${childName} doesn't`} normally fit {team.label}. The club can make an exception.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2 min-h-11" onClick={() => setAskDispensation(true)}>
              Request Dispensation
            </Button>
          </div>
        )}
        {asking && (
          <DispensationReason childName={childName} teamLabel={team.label} reason={reason} onReason={setReason} onCancel={() => setAskDispensation(false)} />
        )}
        {child && (
          <p className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink">
            {asking
              ? `You are added as ${childName}'s parent or guardian. If the club approves the dispensation and the team approves the place, ${childName} joins ${team.label} and you join ${club} as a member.`
              : `You are added as ${childName}'s parent or guardian. When the club approves, ${childName} joins ${team.label} and you join ${club} as a member.`}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="h-12 w-full px-6 sm:w-auto" disabled={pending || !ready}>
          {pending ? "Sending…" : "Send Request"}
        </Button>
        <Button type="button" variant="outline" className="h-12 w-full px-6 sm:w-auto" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  )
}

/** The reason, said once for both ways of asking, with what asking does and does not do. */
function DispensationReason({
  childName,
  teamLabel,
  reason,
  onReason,
  onCancel,
}: {
  childName: string
  teamLabel: string
  reason: string
  onReason: (value: string) => void
  onCancel?: () => void
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-4">
      <p className="flex items-start gap-2 text-sm text-amber-950">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-800" />
        <span>
          A dispensation is an exception the club has to approve. {DISPENSATION_NOT_A_GRANT} The club&apos;s Safeguarding Officer or a Club Admin decides,
          then the team decides.
        </span>
      </p>
      <Label htmlFor="team-code-dispensation-reason" className="mt-4 block">
        Why Should {childName === "your child" ? "Your Child" : childName} Play for {teamLabel}?
      </Label>
      <textarea
        id="team-code-dispensation-reason"
        value={reason}
        rows={3}
        maxLength={DISPENSATION_REASON_MAX}
        onChange={(e) => onReason(e.target.value)}
        aria-required="true"
        aria-describedby="team-code-dispensation-help"
        className="mt-2 w-full resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-base text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-600/30"
      />
      <p id="team-code-dispensation-help" className="mt-1 text-xs text-ink-muted">
        Required. The club&apos;s Safeguarding Officer and Club Admins read it.
      </p>
      {onCancel && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 min-h-11 px-0" onClick={onCancel}>
          Don&apos;t Ask for a Dispensation
        </Button>
      )}
    </div>
  )
}

/** A child already on Ovalball who does not fit: the reason, then the place and the dispensation together. */
function DispensationStep({
  child,
  choices,
  pending,
  error,
  onBack,
  onSend,
}: {
  child: { playerId: string; firstName: string; label: string; misfit: string | null }
  choices: TeamCodeChoices
  pending: boolean
  error: string | null
  onBack: () => void
  onSend: (subject: TeamCodeSubject) => void
}) {
  const [reason, setReason] = useState("")
  const team = choices.team
  const name = child.firstName || child.label
  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault()
        if (!reason.trim()) return
        onSend({ for: "CHILD", playerId: child.playerId, dispensationReason: reason })
      }}
    >
      <h2 className="font-display text-display-s text-ink">Request Dispensation for {name}</h2>
      <p className="mt-1 text-base text-ink/60">
        {name} doesn&apos;t normally fit {team.label}, so the normal way in is closed. {child.misfit ?? ""}
      </p>
      <div className="mt-5">
        <DispensationReason childName={name} teamLabel={team.label} reason={reason} onReason={setReason} />
      </div>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button type="submit" className="h-12 w-full px-6 sm:w-auto" disabled={pending || !reason.trim()}>
          {pending ? "Sending…" : "Send Request"}
        </Button>
        <Button type="button" variant="outline" className="h-12 w-full px-6 sm:w-auto" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  )
}
