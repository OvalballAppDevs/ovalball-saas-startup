import { useCallback, useEffect, useMemo, useState } from "react"
import { Text, View } from "react-native"

import type { InvitationSecret } from "@ovalball/contracts/invitations"
import { DISPENSATION_NOT_A_GRANT } from "@ovalball/contracts/team/dispensation"
import {
  ageGradeWords,
  checkTeamCodeFit,
  readTeamCodeChoices,
  teamCodeFitMayBeDispensed,
  teamCodeFitSentence,
  teamCodeOptions,
  type TeamCodeChoices,
  type TeamCodeFit,
  type TeamCodeSubject,
} from "@ovalball/contracts/team/team-code"

import { supabase } from "../auth/supabase"
import { EntranceLink, EntranceProblem, EntranceScreen, Field as EntranceField } from "../components/entrance"
import { ChoiceField, DateField, Field, TextField } from "../components/form"
import { Button, Loading } from "../components/ui"
import { CircleAlert, CircleCheck, Clock, UserRound } from "../components/icons"
import { ChoiceRow, Note } from "../people/ui"
import { colour, space, type } from "../design/tokens"

/**
 * WHO A TEAM CODE IS FOR -- the join entrance for a team's code or a personal player link
 * (team codes place players, 20270741000000; the layouts the product owner approved on 2026-10-05).
 *
 *   Who Is Joining?   the holder, each of their children, a child not on Ovalball yet, or -- for an adult
 *                     who does not play -- a plain request to join the club. A child who does not fit is
 *                     shown greyed with the reason, never hidden.
 *   Add Your Child    name, date of birth and gender, with the canonical fit asked of the server as they
 *                     type; the parent becomes the child's guardian, and a member, on the one approval.
 *   Your Details      an adult's own date of birth and gender, when their record does not have them yet.
 *
 * Every answer here is the server's (`team_code_choices`, `team_code_fit_check`), and sending is the one
 * redemption path, which re-decides all of it. Nothing on this screen grants anything.
 *
 * A CHILD WHO DOES NOT FIT stays greyed, and -- where the server says one may be asked for -- offers Request
 * Dispensation: a reason, then the place and the dispensation are asked for together, and nothing happens
 * until the club's Safeguarding Officer or a Club Admin approves it (20270742000000). The website says the
 * same thing in the same words.
 */
export function TeamCodeJourney({
  secret,
  email,
  busy,
  problem,
  onSend,
  onNotNow,
}: {
  secret: InvitationSecret
  email: string | null
  busy: boolean
  problem: string | null
  onSend: (subject: TeamCodeSubject) => Promise<void>
  onNotNow: () => void
}) {
  const [choices, setChoices] = useState<TeamCodeChoices | null | undefined>(undefined)
  const [step, setStep] = useState<"who" | "child" | "details">("who")
  const [picked, setPicked] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ playerId: string; firstName: string; label: string; misfit: string | null } | null>(null)

  const load = useCallback(async () => {
    try {
      setChoices(await readTeamCodeChoices(supabase, secret))
    } catch {
      setChoices(null)
    }
  }, [secret])
  useEffect(() => {
    void load()
  }, [load])

  const options = useMemo(() => (choices ? teamCodeOptions(choices) : []), [choices])
  const selected = options.find((o) => o.key === (picked ?? options.find((x) => !x.disabled)?.key)) ?? null

  if (choices === undefined) {
    return (
      <EntranceScreen title="Checking your code" subtitle="One moment.">
        <View style={{ marginTop: space.xl }}>
          <Loading label="Checking" />
        </View>
      </EntranceScreen>
    )
  }
  if (choices === null) {
    return (
      <EntranceScreen title="That code can't be used" subtitle="It may have been withdrawn or used up. Ask the team for a new one." footer={<EntranceLink label="Back to Ovalball" onPress={onNotNow} />}>
        <View />
      </EntranceScreen>
    )
  }

  const team = choices.team
  const club = team.clubName ?? "the club"

  if (asking) {
    return <DispensationStep child={asking} teamLabel={team.label} busy={busy} problem={problem} onBack={() => setAsking(null)} onSend={onSend} />
  }

  if (step === "child" || step === "details") {
    return (
      <DetailsStep
        mode={step}
        secret={secret}
        team={team}
        club={club}
        busy={busy}
        problem={problem}
        onBack={() => setStep("who")}
        onSend={onSend}
      />
    )
  }

  return (
    <EntranceScreen title={team.label} subtitle={`${club}'s team code. Choose who is joining.`} footer={<EntranceLink label="Not now" onPress={onNotNow} />}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Who Is Joining?" style={{ marginTop: space.xl, gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>
          Who Is Joining?
        </Text>
        {options.map((o) => (
          <View key={o.key} style={{ gap: space.xs }}>
            <ChoiceRow kind="radio" checked={selected?.key === o.key} disabled={o.disabled} label={o.label} description={o.description} onPress={() => setPicked(o.key)} />
            {o.requestDispensation && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm, paddingLeft: space.xl }}>
                <Text style={[type.small, { color: colour.inkMuted, flexShrink: 1 }]}>The club can make an exception.</Text>
                <Button
                  label="Request Dispensation"
                  variant="secondary"
                  accessibilityHint={`Asks the club for a dispensation for ${o.label}`}
                  onPress={() => {
                    const child = o.requestDispensation
                    if (child) setAsking({ playerId: child.playerId, firstName: child.firstName, label: o.label, misfit: o.description })
                  }}
                />
              </View>
            )}
          </View>
        ))}
      </View>
      {email && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.lg }}>
          <UserRound size={16} color={colour.inkSubtle} />
          <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]} numberOfLines={1}>
            Signed in as {email}
          </Text>
        </View>
      )}
      <EntranceProblem message={problem} />
      <Button
        label={selected?.next ? "Continue" : "Send Request"}
        busy={busy}
        disabled={!selected || selected.disabled}
        onPress={() => {
          if (!selected) return
          if (selected.next) setStep(selected.next)
          else if (selected.subject) void onSend(selected.subject)
        }}
      />
    </EntranceScreen>
  )
}

function startingDate(): string {
  const d = new Date()
  return `${d.getFullYear() - 10}-01-01`
}

/** Add Your Child, and an adult's own Your Details: the same shape, the same canonical fit as they type. */
function DetailsStep({
  mode,
  secret,
  team,
  club,
  busy,
  problem,
  onBack,
  onSend,
}: {
  mode: "child" | "details"
  secret: InvitationSecret
  team: TeamCodeChoices["team"]
  club: string
  busy: boolean
  problem: string | null
  onBack: () => void
  onSend: (subject: TeamCodeSubject) => Promise<void>
}) {
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [dob, setDob] = useState(startingDate())
  const [dobChosen, setDobChosen] = useState(false)
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "">("")
  const [fit, setFit] = useState<TeamCodeFit | null>(null)
  const [askDispensation, setAskDispensation] = useState(false)
  const [reason, setReason] = useState("")

  // THE CANONICAL FIT, asked of the server as they type -- it alone holds the season and the rule.
  useEffect(() => {
    setFit(null)
    if (!dobChosen || !gender) return
    let live = true
    const timer = setTimeout(() => {
      checkTeamCodeFit(supabase, secret, dob, gender)
        .then((v) => live && setFit(v))
        .catch(() => live && setFit(null))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [dob, dobChosen, gender, secret])

  const child = mode === "child"
  const named = !child || (first.trim().length > 0 && last.trim().length > 0)
  const mayAsk = child && teamCodeFitMayBeDispensed(fit)
  const asking = mayAsk && askDispensation
  const ready = named && dobChosen && !!gender && (fit === "FITS" || (asking && reason.trim().length > 0))
  const teamLabel = team.label
  const fitWords = fit && fit !== "FITS" ? teamCodeFitSentence(fit, team) : null
  const grade = ageGradeWords(team.ageGroup)
  const childName = first.trim() || "your child"

  return (
    <EntranceScreen
      title={child ? "Add Your Child" : "Your Details"}
      subtitle={child ? `They join ${teamLabel} once ${club} approves.` : `Ovalball checks you fit ${teamLabel} before the team decides.`}
      footer={<EntranceLink label="Back" onPress={onBack} />}
    >
      <View style={{ marginTop: space.lg, gap: space.md }}>
        {child && (
          <>
            <EntranceField label="First Name" value={first} onChangeValue={setFirst} autoCapitalize="words" textContentType="givenName" />
            <EntranceField label="Last Name" value={last} onChangeValue={setLast} autoCapitalize="words" textContentType="familyName" />
          </>
        )}
        <Field label="Date of Birth" hint={dobChosen ? undefined : child ? "Choose their date of birth." : "Choose your date of birth."}>
          <DateField
            label="Date of Birth"
            value={dob}
            onChange={(next) => {
              setDob(next)
              setDobChosen(true)
            }}
          />
        </Field>
        {dobChosen && gender && fit === "FITS" && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: -space.xs }} accessibilityLiveRegion="polite">
            <CircleCheck size={16} color={colour.forest800} />
            <Text style={[type.small, { color: colour.forest800 }]}>{grade ? `Fits ${grade}` : `Fits ${teamLabel}`}</Text>
          </View>
        )}
        {fitWords && (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs, marginTop: -space.xs }} accessibilityLiveRegion="polite">
            <View style={{ paddingTop: 2 }}>
              <CircleAlert size={16} color={colour.warning} />
            </View>
            <Text style={[type.small, { color: colour.warning, flex: 1 }]}>{fitWords}</Text>
          </View>
        )}
        <Field label="Gender">
          <ChoiceField<"MALE" | "FEMALE" | "">
            label="Gender"
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
            ]}
            value={gender}
            onChange={setGender}
          />
        </Field>
        {mayAsk && !asking && (
          <View style={{ gap: space.sm }}>
            <Note>{`${childName === "your child" ? "Your child doesn't" : `${childName} doesn't`} normally fit ${teamLabel}. The club can make an exception.`}</Note>
            <Button label="Request Dispensation" variant="secondary" onPress={() => setAskDispensation(true)} />
          </View>
        )}
        {asking && <DispensationReason childName={childName} teamLabel={teamLabel} reason={reason} onReason={setReason} onCancel={() => setAskDispensation(false)} />}
        {child && (
          <Note>
            {asking
              ? `You are added as ${childName}'s parent or guardian. If the club approves the dispensation and the team approves the place, ${childName} joins ${teamLabel} and you join ${club} as a member.`
              : `You are added as ${childName}'s parent or guardian. When the club approves, ${childName} joins ${teamLabel} and you join ${club} as a member.`}
          </Note>
        )}
      </View>
      <EntranceProblem message={problem} />
      <Button
        label="Send Request"
        busy={busy}
        disabled={!ready}
        onPress={() =>
          void onSend(
            child
              ? { for: "NEW_CHILD", firstName: first, surname: last, dateOfBirth: dob, playingPathway: gender as "MALE" | "FEMALE", dispensationReason: asking ? reason : null }
              : { for: "SELF", dateOfBirth: dob, playingPathway: gender as "MALE" | "FEMALE" }
          )
        }
      />
    </EntranceScreen>
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
  const named = childName === "your child" ? "Your Child" : childName
  return (
    <View style={{ gap: space.md }}>
      <Note tone="warning">
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <View style={{ paddingTop: 2 }}>
            <Clock size={16} color={colour.warning} />
          </View>
          <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
            {`A dispensation is an exception the club has to approve. ${DISPENSATION_NOT_A_GRANT} The club's Safeguarding Officer or a Club Admin decides, then the team decides.`}
          </Text>
        </View>
      </Note>
      <Field label={`Why Should ${named} Play for ${teamLabel}?`} hint="Required. The club's Safeguarding Officer and Club Admins read it.">
        <TextField label={`Why should ${named} play for ${teamLabel}?`} value={reason} onChange={onReason} multiline />
      </Field>
      {onCancel && <EntranceLink label="Don't Ask for a Dispensation" onPress={onCancel} align="right" />}
    </View>
  )
}

/** A child already on Ovalball who does not fit: the reason, then the place and the dispensation together. */
function DispensationStep({
  child,
  teamLabel,
  busy,
  problem,
  onBack,
  onSend,
}: {
  child: { playerId: string; firstName: string; label: string; misfit: string | null }
  teamLabel: string
  busy: boolean
  problem: string | null
  onBack: () => void
  onSend: (subject: TeamCodeSubject) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const name = child.firstName || child.label
  return (
    <EntranceScreen
      title={`Request Dispensation for ${name}`}
      subtitle={`${name} doesn't normally fit ${teamLabel}, so the normal way in is closed.${child.misfit ? ` ${child.misfit}` : ""}`}
      footer={<EntranceLink label="Back" onPress={onBack} />}
    >
      <View style={{ marginTop: space.lg }}>
        <DispensationReason childName={name} teamLabel={teamLabel} reason={reason} onReason={setReason} />
      </View>
      <EntranceProblem message={problem} />
      <Button
        label="Send Request"
        busy={busy}
        disabled={!reason.trim()}
        onPress={() => void onSend({ for: "CHILD", playerId: child.playerId, dispensationReason: reason })}
      />
    </EntranceScreen>
  )
}
