import { useCallback, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { approveGuardianLinkRequest, canOpenGuardiansPlayers, guardiansPlayersErrorMessage, readGuardianLinkRequests, rejectGuardianLinkRequest, type GuardianLinkRequest } from "@ovalball/contracts/club/guardians-players"

import { AdminScreen } from "../../../../src/admin/screen"
import { useGuardiansPlayersAccess } from "../../../../src/admin/guardians-players"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { Notice } from "../../../../src/admin/chips"
import { supabase } from "../../../../src/auth/supabase"
import { ShieldCheck } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * GUARDIAN LINK REQUESTS -- where a guardian relationship is actually granted (CA-M11.1).
 *
 * The queue is scoped by the database, not by this screen: `guardian_link_requests_for_approval`
 * returns only rows the caller may decide, and every decision re-checks the same authority the moment
 * it is made -- never the requester, never the person asked about; an additional guardian at club
 * level only. The date of birth shown is WHAT WAS TYPED on the request, as the website shows it; the
 * matched player's own record is not read. There is deliberately no "approve all": each of these
 * decides which adult can see a specific child.
 */
export default function GuardianLinkRequests() {
  const router = useRouter()
  const { loading: accessLoading, clubId, caps, refresh: refreshAccess } = useGuardiansPlayersAccess()
  const [rows, setRows] = useState<GuardianLinkRequest[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = usePendingIntent("guardians:link-requests")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || accessLoading || !canOpenGuardiansPlayers(caps)) return
    const gen = ++generation.current
    setError(null)
    try {
      const list = await readGuardianLinkRequests(supabase, clubId)
      if (gen === generation.current) setRows(list)
    } catch (cause) {
      const translated = friendly(cause, "guardian requests")
      logDetail("admin:guardians:link-requests", translated)
      if (gen === generation.current) setError(translated)
    }
  }, [clubId, accessLoading, caps])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  const may = canOpenGuardiansPlayers(caps)

  function decide(r: GuardianLinkRequest, decision: "approve" | "reject") {
    setAsk(
      decision === "approve"
        ? {
            title: `Approve ${r.requesterName} as guardian of ${r.childName}?`,
            body: r.kind === "SELF_ADDED_CHILD" ? "This confirms the adult is responsible for the child they added. They gain access to the child's fixtures, training and attendance." : r.matchedPlayerId ? `This links the adult to the existing player ${r.matchedPlayerName ?? ""}. No duplicate record is created.` : "No existing player matched: approving creates a new player from what was submitted. Only approve if you can confirm this person is responsible for this child.",
            confirmLabel: "Approve",
            reason: "none",
            onConfirm: async () => {
              await approveGuardianLinkRequest(supabase, r.requestId)
              setNotice(`Approved. ${r.requesterName} is now a guardian of ${r.childName}.`)
              await load()
            },
          }
        : {
            title: `Reject the request for ${r.childName}?`,
            body: "Nothing is granted. A reason is optional and is kept with the decision.",
            confirmLabel: "Reject",
            destructive: true,
            reason: "optional",
            onConfirm: async (reason) => {
              await rejectGuardianLinkRequest(supabase, r.requestId, reason)
              setNotice(`Rejected the request for ${r.childName}.`)
              await load()
            },
          }
    )
  }

  return (
    <AdminScreen section="Guardian Link Requests" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <ShieldCheck size={18} color={colour.forest800} />
          <Text style={[type.overline, { color: colour.forest800 }]}>SAFEGUARDING</Text>
        </View>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Guardian Link Requests
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Someone has asked to be recognised as a parent or guardian. Approving one gives that adult access to the child's fixtures, training and attendance. Nothing is granted until you decide.</Text>
      </View>

      {!accessLoading && clubId && !may && <EmptyState title="Not part of your job here" body="Deciding who looks after which player is done by the people the club has given that job to." />}
      {may && notice && <Notice tone="ok" text={notice} />}
      {may && error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {may && !error && rows === null && <CardSkeleton lines={4} />}
      {may && rows !== null && rows.length === 0 && <EmptyState title="Nothing waiting" body="Requests you are able to decide will appear here." />}

      {may &&
        rows?.map((r) => (
          <Card key={r.requestId} style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.sm }}>
              <Text style={[type.title, { color: colour.ink, flex: 1 }]}>{r.childName}</Text>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{r.clubName}</Text>
            </View>
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }}>
              <Line label="Requested by" value={r.kind === "ADDITIONAL_GUARDIAN" ? (r.invitedEmail ?? r.requesterName) : r.requesterName} first />
              {r.kind !== "ADDITIONAL_GUARDIAN" && <Line label="Date of birth given" value={r.submittedDateOfBirth ?? "Not given"} />}
              <Line label="Existing player" value={r.kind === "SELF_ADDED_CHILD" ? "Added by this parent, waiting for you to confirm the relationship" : r.matchedPlayerId ? `${r.matchedPlayerName ?? "Matched"}${r.matchedTeamName ? ` · ${r.matchedTeamName}` : ""}` : "No match found: approving will create a new player"} />
            </View>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {r.kind === "SELF_ADDED_CHILD" ? "Approving confirms this adult is responsible for the child they added. Until then they cannot see the player." : r.matchedPlayerId ? "Approving links this adult to the existing player. No duplicate record is created." : "Only approve if you can confirm this person is responsible for this child."}
            </Text>
            {!r.canApprove && <Text style={[type.caption, { color: colour.warning }]}>Waiting for {r.invitedEmail ?? "the other adult"} to accept. You can approve once they have; you can reject now.</Text>}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button label="Reject" variant="secondary" onPress={() => decide(r, "reject")} style={{ flex: 1 }} />
              <Button label="Approve" disabled={!r.canApprove} onPress={() => decide(r, "approve")} style={{ flex: 1 }} />
            </View>
          </Card>
        ))}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => { void refreshAccess(); void load() }}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/guardians/link-requests" } } as never)
        }}
        errorMessage={(cause) => guardiansPlayersErrorMessage(cause, friendly(cause, "this request").message)}
      />
    </AdminScreen>
  )
}

function Line({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
