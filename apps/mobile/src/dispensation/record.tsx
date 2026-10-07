import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import {
  DISPENSATION_REASON_MAX,
  DISPENSATION_REFERENCE_MAX,
  DISPENSATION_STATUS_LABEL,
  decideDispensation,
  dispensationDate,
  dispensationDecisionPrompt,
  dispensationReferenceAsk,
  dispensationErrorMessage,
  dispensationHistory,
  dispensationMismatchSentence,
  dispensationStateSentence,
  dispensationTone,
  readDispensationRecord,
  recordDispensationReference,
  revokeDispensation,
  withdrawDispensation,
  type DispensationRecord,
} from "@ovalball/contracts/team/dispensation"

import { supabase } from "../auth/supabase"
import { ReasonSheet, type ReasonAsk } from "../admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../admin/pending-intent"
import { invalidateAttention } from "../attention/cache"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../components/ui"
import { Body, ButtonRow, FlowScreen, Note, SectionTitle } from "../people/ui"
import { colour, space, type } from "../design/tokens"
import { AgeGradeBridge } from "./age-grade-bridge"

/**
 * ONE DISPENSATION ON THE PHONE (20270742000000) -- the same record the website's /dispensations/<id> shows,
 * from the same reader (`dispensation_record`) and in the same words. The club's Safeguarding Officer and
 * Club Admins decide it here; the person who asked and the child's family read where it stands; the team's
 * staff see the decision and never the child's date of birth or the family's reasons. Every button is drawn
 * from the record's `viewer` block and every press is re-decided by the server.
 */
const PILL_TONE = { waiting: "caution", granted: "positive", refused: "negative", closed: "neutral" } as const

export function DispensationRecordScreen({ id }: { id: string | null }) {
  const [record, setRecord] = useState<DispensationRecord | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const router = useRouter()
  // A decision needs a recent authenticator code (the server's rule, as for suspending a member). When it asks
  // for one, what the person was confirming is held here, they step up, and the same sheet comes back.
  const pending = usePendingIntent(`dispensation:${id ?? ""}`)

  const load = useCallback(async () => {
    if (!id) {
      setRecord(null)
      return
    }
    setProblem(null)
    try {
      setRecord(await readDispensationRecord(supabase, id))
    } catch (caught) {
      setProblem(dispensationErrorMessage(caught, "Couldn't load the dispensation. Try again."))
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      // Back from a step-up: the same question, the reason put back, and the server asked again on Confirm.
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  const afterChange = async () => {
    invalidateAttention()
    await load()
  }

  const r = record
  const who = r?.player.firstName || "this player"
  const deciding = !!r && !!r.viewer.decidesAs && r.status === "requested"

  function approve() {
    if (!r) return
    if (r.requiresGoverningBody) {
      setAsk({
        title: `Approve the dispensation for ${who}?`,
        body: `${dispensationDecisionPrompt(r)}`,
        confirmLabel: "Approve",
        reason: "required",
        fieldLabel: "Governing Body's Reference",
        placeholder: "As the governing body gave it",
        maxLength: DISPENSATION_REFERENCE_MAX,
        singleLine: true,
        onConfirm: async (reference) => {
          await decideDispensation(supabase, r.id, { approve: true, governingBodyReference: reference })
          await afterChange()
        },
      })
      return
    }
    setAsk({
      title: `Approve the dispensation for ${who}?`,
      body: dispensationDecisionPrompt(r),
      confirmLabel: "Approve",
      reason: "optional",
      fieldLabel: "Note",
      placeholder: "Recorded with the decision, if given",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (note) => {
        await decideDispensation(supabase, r.id, { approve: true, note })
        await afterChange()
      },
    })
  }

  function decline() {
    if (!r) return
    setAsk({
      title: `Decline the dispensation for ${who}?`,
      body: `The person who asked and ${who}'s family are told, and read your reason.`,
      confirmLabel: "Decline Request",
      destructive: true,
      reason: "required",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (note) => {
        await decideDispensation(supabase, r.id, { approve: false, note })
        await afterChange()
      },
    })
  }

  function withdraw() {
    if (!r) return
    setAsk({
      title: "Withdraw this request?",
      body: "It ends before anybody decides it. A new request can be made later.",
      confirmLabel: "Withdraw Request",
      reason: "optional",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (reason) => {
        await withdrawDispensation(supabase, r.id, reason)
        await afterChange()
      },
    })
  }

  function revoke() {
    if (!r) return
    setAsk({
      title: `Revoke the dispensation for ${who}?`,
      body: `Nothing new can rely on it. A place ${who} already holds stays, and shows as outside the age grade. The family and the club's other decision makers are told.`,
      confirmLabel: "Revoke Dispensation",
      destructive: true,
      reason: "required",
      maxLength: DISPENSATION_REASON_MAX,
      onConfirm: async (reason) => {
        await revokeDispensation(supabase, r.id, reason)
        await afterChange()
      },
    })
  }

  function recordReference() {
    if (!r) return
    const words = dispensationReferenceAsk(r)
    setAsk({
      title: words.title,
      body: words.body,
      confirmLabel: "Save Reference",
      reason: "required",
      fieldLabel: "Governing Body's Reference",
      placeholder: "As the governing body gave it",
      maxLength: DISPENSATION_REFERENCE_MAX,
      singleLine: true,
      onConfirm: async (reference) => {
        await recordDispensationReference(supabase, r.id, reference)
        await afterChange()
      },
    })
  }

  return (
    <FlowScreen
      title="Dispensation"
      footer={
        deciding ? (
          <ButtonRow>
            <Button label="Decline" variant="secondary" onPress={decline} />
            <Button label="Approve" onPress={approve} />
          </ButtonRow>
        ) : undefined
      }
    >
      <Body>
        {problem && record === undefined && <ErrorState message={problem} onRetry={() => void load()} />}
        {record === undefined && !problem && <CardSkeleton lines={5} />}
        {record === null && <EmptyState title="Not available" body="This dispensation isn't available to you. If you were sent a link, ask the club." />}
        {r && (
          <>
            <Card style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                {`${r.player.firstName} ${r.player.surname}`.trim() || "A player"}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
                <StatusPill label={DISPENSATION_STATUS_LABEL[r.status]} tone={PILL_TONE[dispensationTone(r.status)]} />
                <Text style={[type.small, { color: colour.inkMuted }]}>{`${r.team.label}, ${r.season.name}`}</Text>
              </View>
            </Card>

            <Card style={{ gap: space.md }}>
              <AgeGradeBridge record={r} />
              <Text style={[type.body, { color: colour.ink }]}>{dispensationMismatchSentence(r)}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {`The normal way onto ${r.team.label} is closed to them. A dispensation is an exception the club has to approve.`}
              </Text>
            </Card>

            <View accessibilityLiveRegion="polite">
              <Note tone={r.status === "requested" ? "warning" : r.status === "approved" ? "positive" : "info"}>{dispensationStateSentence(r)}</Note>
            </View>

            <View style={{ gap: space.md }}>
              <SectionTitle title="The Request" />
              <Fact label="Asked By" value={`${r.requestedBy?.name ?? "Someone at the club"}${r.requestedAt ? `, ${dispensationDate(r.requestedAt)}` : ""}`} />
              {r.reason && <Fact label="Reason" value={r.reason} />}
              {r.player.dateOfBirth && <Fact label="Date of Birth" value={dispensationDate(`${r.player.dateOfBirth}T12:00:00Z`) ?? r.player.dateOfBirth} />}
              {r.sourceTeam && <Fact label="Currently On" value={r.sourceTeam.label} />}
              {r.governingBodyReference && <Fact label="Governing Body's Reference" value={r.governingBodyReference} />}
            </View>

            {deciding && (
              <Note>{`You decide this as ${r.viewer.decidesAs === "SAFEGUARDING_OFFICER" ? "the club's Safeguarding Officer" : "a Club Admin"}. The first decision made is final. ${dispensationDecisionPrompt(r)}`}</Note>
            )}

            {(r.viewer.mayWithdraw || r.viewer.mayRevoke || r.viewer.mayRecordGoverningBody) && (
              <View style={{ gap: space.sm }}>
                {r.viewer.mayRecordGoverningBody && <Button label={dispensationReferenceAsk(r).action} variant="secondary" onPress={recordReference} />}
                {/* The website's openers; the sheet that follows names the whole act ("Revoke Dispensation"). At
                    the largest text sizes "Dispensation" alone is wider than a button and breaks mid-word. */}
                {r.viewer.mayWithdraw && <Button label="Withdraw" variant="secondary" onPress={withdraw} />}
                {r.viewer.mayRevoke && <Button label="Revoke" variant="secondary" onPress={revoke} />}
              </View>
            )}

            <View style={{ gap: space.md }}>
              <SectionTitle title="History" detail="This record can't be edited or deleted. A different team or season needs a new request." />
              {dispensationHistory(r).map((event, i) => (
                <View key={`${event.kind}-${i}`} style={{ flexDirection: "row", gap: space.md }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800, marginTop: 6 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.heading, { color: colour.ink }]}>{event.title}</Text>
                    {(event.who || event.at) && (
                      <Text style={[type.small, { color: colour.inkMuted }]}>{[event.who, dispensationDate(event.at)].filter(Boolean).join(", ")}</Text>
                    )}
                    {event.detail && <Text style={[type.small, { color: colour.ink }]}>{event.detail}</Text>}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </Body>
      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: `/dispensations/${id}` } } as never)
        }}
        errorMessage={(cause) => dispensationErrorMessage(cause, "That didn't work. Try again.")}
      />
    </FlowScreen>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.smallMedium, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.body, { color: colour.ink }]}>{value}</Text>
    </View>
  )
}
