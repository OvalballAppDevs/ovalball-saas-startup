import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Text, View } from "react-native"

import { approveTeamPlaceRequest, declineTeamPlaceRequest, teamPeopleErrorMessage } from "@ovalball/contracts/team/people"
import {
  readTeamPlaceRequests,
  requestApprovalSentence,
  requestAskedLine,
  requestDispensationLine,
  requestFitLine,
  type TeamPlaceRequest,
  type TeamPlaceRequests,
} from "@ovalball/contracts/team/team-code"

import { supabase } from "../auth/supabase"
import { ReasonSheet, type ReasonAsk } from "../admin/reason-sheet"
import { PersonAvatar } from "../components/identity"
import { Button, Card } from "../components/ui"
import { CircleAlert, CircleCheck, Clock, ShieldCheck, UserRound } from "../components/icons"
import { ButtonRow, Note } from "../people/ui"
import { colour, space, type } from "../design/tokens"

/**
 * WAITING FOR APPROVAL -- the approver's card (People & Invitations, the sketches approved 2026-10-05).
 *
 * One card for every place somebody has asked for on this team, wherever the team's approvers look:
 * the team's Squad tab and its Requests to Join screen draw this same section. Each card says who it
 * is, whether they fit the team (the canonical age grade and pathway, from the server), how it was asked,
 * and in one sentence exactly what approving does -- then Decline and Approve, the canonical
 * `approve_pending_team_membership` / `reject_pending_team_membership`, which re-decide everything.
 *
 * A child's own request still waiting for a parent is not the team's yet: the server counts it and never
 * names it, and so does this -- one quiet line. A request the viewer may not decide (their own, or their
 * child's) says so instead of offering buttons. A viewer who may not approve anything sees nothing here:
 * the server refuses the read, and the section draws nothing rather than an error about a job that is
 * not theirs.
 */
export function TeamPlaceRequestsSection({
  teamId,
  onChanged,
  empty = null,
  onOpenPlayer,
}: {
  teamId: string
  onChanged?: () => void
  /** What a screen shows when nobody is waiting; the Squad tab shows nothing at all. */
  empty?: ReactNode
  /** Where a request's player opens, for a screen that has somewhere to open it. */
  onOpenPlayer?: (membershipId: string) => void
}) {
  const [data, setData] = useState<TeamPlaceRequests | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setData(await readTeamPlaceRequests(supabase, teamId))
    } catch (caught) {
      if ((caught as { code?: string }).code === "42501") {
        setData({ team: null, requests: [], awaitingGuardian: 0, awaitingDispensation: 0 })
        return
      }
      setProblem(teamPeopleErrorMessage(caught, "Couldn't load the requests. Try again."))
    }
  }, [teamId])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])

  if (problem) {
    return <Note tone="danger">{problem}</Note>
  }
  if (!data) return null
  if (!data.team || (data.requests.length === 0 && data.awaitingGuardian === 0 && data.awaitingDispensation === 0)) {
    return (
      <>
        {notice && <Note>{notice}</Note>}
        {empty}
      </>
    )
  }
  const team = data.team

  function approve(r: TeamPlaceRequest) {
    setNotice(null)
    setAsk({
      title: `Approve ${r.firstName} ${r.surname}?`.trim(),
      body: requestApprovalSentence(r, team.label, team.clubName),
      confirmLabel: "Approve",
      reason: "none",
      onConfirm: async () => {
        await approveTeamPlaceRequest(supabase, r.membershipId)
        setNotice(`${r.firstName} is now on ${team.label}.`)
        await load()
        onChanged?.()
      },
    })
  }

  function decline(r: TeamPlaceRequest) {
    setNotice(null)
    setAsk({
      title: `Decline ${r.firstName} ${r.surname}?`.trim(),
      body: r.askedBy === "PARENT" ? "Say why. The reason is recorded and their parent is told." : "Say why. The reason is recorded and they are told.",
      confirmLabel: "Decline",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        await declineTeamPlaceRequest(supabase, r.membershipId, reason)
        setNotice(`${r.firstName}'s request was declined.`)
        await load()
        onChanged?.()
      },
    })
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Waiting for Approval</Text>
        <Text accessibilityLabel={`${data.requests.length} waiting`} style={[type.title, { color: colour.ink }]}>{data.requests.length}</Text>
      </View>
      {notice && <Note>{notice}</Note>}

      {data.requests.map((r) => (
        <TeamPlaceRequestCard
          key={r.membershipId}
          request={r}
          team={team}
          onApprove={() => approve(r)}
          onDecline={() => decline(r)}
          onOpen={onOpenPlayer ? () => onOpenPlayer(r.membershipId) : undefined}
        />
      ))}

      {data.awaitingGuardian > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs }}>
          <Clock size={16} color={colour.inkSubtle} />
          <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>
            {data.awaitingGuardian === 1 ? "1 more is waiting for a parent to confirm." : `${data.awaitingGuardian} more are waiting for a parent to confirm.`}
          </Text>
        </View>
      )}
      {data.awaitingDispensation > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs }}>
          <Clock size={16} color={colour.inkSubtle} />
          <Text style={[type.small, { color: colour.inkMuted, flex: 1 }]}>
            {data.awaitingDispensation === 1
              ? "1 more is waiting for the club to decide a dispensation."
              : `${data.awaitingDispensation} more are waiting for the club to decide a dispensation.`}
          </Text>
        </View>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void load()} errorMessage={(cause) => teamPeopleErrorMessage(cause, "That didn't work. Try again.")} />
    </View>
  )
}

export function TeamPlaceRequestCard({
  request,
  team,
  onApprove,
  onDecline,
  onOpen,
}: {
  request: TeamPlaceRequest
  team: NonNullable<TeamPlaceRequests["team"]>
  onApprove: () => void
  onDecline: () => void
  onOpen?: () => void
}) {
  const name = `${request.firstName} ${request.surname}`.trim()
  const fits = request.fit === "FITS"
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <PersonAvatar name={name} url={null} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.heading, { color: colour.ink }]}>{name}</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>{`Player · ${team.label}`}</Text>
        </View>
      </View>
      <View style={{ gap: space.xs }}>
        <Fact
          icon={fits ? <CircleCheck size={16} color={colour.forest800} /> : <CircleAlert size={16} color={colour.warning} />}
          text={requestFitLine(request, team)}
          tone={fits ? "good" : "warning"}
        />
        {requestDispensationLine(request) && <Fact icon={<ShieldCheck size={16} color={colour.forest800} />} text={requestDispensationLine(request) as string} tone="good" />}
        <Fact icon={<UserRound size={16} color={colour.inkSubtle} />} text={requestAskedLine(request)} />
      </View>
      {request.decidedByOthers ? (
        <Note>This request is yours, or your child&apos;s, so another approver at the club decides it.</Note>
      ) : (
        <>
          <Note>{requestApprovalSentence(request, team.label, team.clubName)}</Note>
          <ButtonRow>
            <Button label="Decline" variant="secondary" onPress={onDecline} accessibilityHint={`Declines ${name}'s request`} />
            <Button label="Approve" onPress={onApprove} accessibilityHint={`Approves ${name}'s request`} />
          </ButtonRow>
        </>
      )}
      {onOpen && <Button label="See the Player" variant="quiet" onPress={onOpen} />}
    </Card>
  )
}

function Fact({ icon, text, tone = "muted" }: { icon: ReactNode; text: string; tone?: "muted" | "good" | "warning" }) {
  const colourFor = tone === "good" ? colour.forest800 : tone === "warning" ? colour.warning : colour.inkMuted
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <Text style={[type.small, { color: colourFor, flex: 1 }]}>{text}</Text>
    </View>
  )
}
