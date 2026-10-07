import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"

import {
  childRequestAnswered,
  childRequestSteps,
  confirmChildTeamRequest,
  declineChildTeamRequest,
  readFamilyTeamRequests,
  type FamilyTeamRequest,
} from "@ovalball/contracts/team/team-code"
import { teamPeopleErrorMessage } from "@ovalball/contracts/team/people"

import { supabase } from "../auth/supabase"
import { ReasonSheet, type ReasonAsk } from "../admin/reason-sheet"
import { PersonAvatar } from "../components/identity"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { CircleCheck, KeyRound } from "../components/icons"
import { Body, ButtonRow, FlowScreen, Note, SectionTitle } from "../people/ui"
import { colour, space, type } from "../design/tokens"

/**
 * CONFIRM A CHILD'S REQUEST -- a parent's answer to the team request their child made from their own
 * account (team codes place players, 20270741000000; the layout the product owner approved 2026-10-05).
 *
 * The request is read from `family_team_requests`, which returns only what waits on THIS parent, so an
 * id from a notification that is no longer waiting -- answered by the other parent, or never theirs --
 * reads as nothing to confirm rather than an error. Confirming hands it to the team's staff; declining
 * ends it and the child is told. Both are the server's own operations, which re-check the parent.
 */
export function ConfirmTeamRequest({ membershipId }: { membershipId: string | null }) {
  const router = useRouter()
  const [request, setRequest] = useState<FamilyTeamRequest | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<"confirmed" | "declined" | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const waiting = await readFamilyTeamRequests(supabase)
      setRequest(waiting.find((r) => r.membershipId === membershipId) ?? (membershipId ? null : waiting[0] ?? null))
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load the request. Try again."))
    }
  }, [membershipId])
  useEffect(() => {
    void load()
  }, [load])

  const leave = () => (router.canGoBack() ? router.back() : router.dismissTo("/family" as never))
  const first = request?.firstName || "your child"

  async function confirm() {
    if (!request) return
    setBusy(true)
    setProblem(null)
    try {
      await confirmChildTeamRequest(supabase, request.membershipId)
      setDone("confirmed")
    } catch (caught) {
      setProblem(teamPeopleErrorMessage(caught, "That didn't work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  function decline() {
    if (!request) return
    setAsk({
      title: `Decline ${first}'s request?`,
      body: `${first} is told. A reason is optional, and ${first} will read it.`,
      confirmLabel: "Decline",
      destructive: true,
      reason: "optional",
      onConfirm: async (reason) => {
        await declineChildTeamRequest(supabase, request.membershipId, reason)
        setDone("declined")
      },
    })
  }

  const title = request ? `Confirm ${request.firstName}'s Request` : "Confirm a Request"

  if (done && request) {
    const answered = childRequestAnswered(done, request)
    return (
      <FlowScreen title={title} footer={<Button label="Done" onPress={leave} />}>
        <Body>
          <View accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: space.md, paddingTop: space.lg }}>
            {done === "confirmed" && <CircleCheck size={40} color={colour.forest800} />}
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink, textAlign: "center" }]}>{answered.title}</Text>
            <Text style={[type.body, { color: colour.inkMuted, textAlign: "center" }]}>{answered.sentence}</Text>
          </View>
        </Body>
      </FlowScreen>
    )
  }

  return (
    <FlowScreen
      title={title}
      footer={
        request ? (
          <ButtonRow>
            <Button label="Decline" variant="secondary" onPress={decline} disabled={busy} />
            <Button label="Confirm" onPress={() => void confirm()} busy={busy} />
          </ButtonRow>
        ) : undefined
      }
    >
      <Body>
        {problem && !request && <ErrorState message={problem} onRetry={() => void load()} />}
        {request === undefined && !problem && <CardSkeleton lines={4} />}
        {request === null && (
          <EmptyState title="Nothing to confirm" body="This request has already been answered, or it isn't waiting on you." />
        )}
        {request && (
          <>
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <PersonAvatar name={`${request.firstName} ${request.surname}`} url={null} size={52} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[type.title, { color: colour.ink }]}>{`${request.firstName} ${request.surname}`.trim()}</Text>
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    {request.clubName ? `Asked to join ${request.teamLabel} at ${request.clubName}` : `Asked to join ${request.teamLabel}`}
                  </Text>
                </View>
              </View>
              <Fact icon={<KeyRound size={16} color={colour.inkSubtle} />} text={`Used the team's code from ${request.firstName}'s own account, ${askedWhen(request.requestedAt)}.`} />
            </Card>

            <View style={{ gap: space.md }}>
              <SectionTitle title="What Happens Next" />
              {childRequestSteps(request).map((step, i) => (
                <Numbered key={step} n={i + 1} text={step} />
              ))}
            </View>

            {problem && <Note tone="danger">{problem}</Note>}
            <Note>{`Nothing happens until you confirm. If ${request.firstName} didn't ask, decline it.`}</Note>
          </>
        )}
      </Body>
      <ReasonSheet ask={ask} onClose={() => setAsk(null)} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That didn't work. Try again.")} />
    </FlowScreen>
  )
}

/** "today at 18:42", "yesterday at 09:10", "on 3 October at 18:42" -- when they asked, in UK form. */
function askedWhen(iso: string | null): string {
  if (!iso) return "recently"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "recently"
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(at)) / 86_400_000)
  if (days === 0) return `today at ${time}`
  if (days === 1) return `yesterday at ${time}`
  return `on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} at ${time}`
}

function Numbered({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Text allowFontScaling={false} style={[type.smallMedium, { color: colour.forest800 }]}>{n}</Text>
      </View>
      <Text style={[type.body, { color: colour.ink, flex: 1, paddingTop: 1 }]}>{text}</Text>
    </View>
  )
}

function Fact({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>{text}</Text>
    </View>
  )
}
