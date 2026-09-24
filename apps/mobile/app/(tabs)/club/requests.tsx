import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { acceptFixtureRequest, declineFixtureRequest } from "@ovalball/contracts/team/requests"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { readClubAuthority } from "@ovalball/contracts/club/overview"
import { matchTypeLabel } from "@ovalball/contracts/fixtures/game-type"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { exactDate } from "../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../src/errors/translate"
import { ChevronRight, Megaphone, MessageSquare } from "../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * FIXTURE REQUESTS ACROSS THE CLUB (CA-M10): what other clubs have asked any of our sides, and what
 * our sides have asked. The same rows and the same two operations as the Team workspace, read across
 * every side and naming which of ours each concerns. Accept and decline are offered only where the
 * club-scope probe says this person holds `fixture.request.respond`; the server refuses regardless.
 * A request is a thread too: "Open the conversation" is the same one the website opens.
 */
const STATUS: Record<string, { label: string; tone: "positive" | "caution" | "neutral" }> = {
  sent: { label: "Waiting", tone: "caution" },
  accepted: { label: "Accepted", tone: "positive" },
  declined: { label: "Declined", tone: "neutral" },
  counter_proposed: { label: "Counter-proposed", tone: "caution" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
}

export default function ClubRequests() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [data, setData] = useState<{ incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] } | null>(null)
  const [canRespond, setCanRespond] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const [teams, authority] = await Promise.all([readClubTeams(supabase, clubId), readClubAuthority(supabase, clubId)])
      setCanRespond(authority.requestRespond)
      setData(await readClubFixtureRequests(supabase, teams.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.displayName }))))
    } catch (caught) {
      const failure = friendly(caught, "the club's fixture requests")
      logDetail("club requests", failure)
      setProblem(failure.message)
    }
  }, [clubId])
  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function decide(r: ClubFixtureRequest, decision: "accept" | "decline") {
    setBusy(r.id)
    setProblem(null)
    try {
      if (decision === "accept") await acceptFixtureRequest(supabase, r.id)
      else await declineFixtureRequest(supabase, r.id, session?.user.id ?? "")
      invalidateAttention()
      await load()
    } catch (caught) {
      setProblem(friendly(caught, "this request").message)
    } finally {
      setBusy(null)
    }
  }

  const waiting = (data?.incoming ?? []).filter((r) => r.status === "sent")
  const earlier = (data?.incoming ?? []).filter((r) => r.status !== "sent")

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>Fixture Requests</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} tintColor={colour.forest800} />}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {data === null && !problem && <CardSkeleton lines={3} />}
        {data && (
          <>
            <Section title={waiting.length > 0 ? `Waiting on us (${waiting.length})` : "Waiting on us"}>
              {waiting.length === 0 ? (
                <EmptyState title="Nothing waiting" body="When another club asks one of your sides for a match, it appears here." icon={<Megaphone size={22} color={colour.inkSubtle} />} />
              ) : (
                waiting.map((r) => <RequestCard key={r.id} r={r} canRespond={canRespond} busy={busy === r.id} onDecide={(d) => void decide(r, d)} onOpen={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)} />)
              )}
            </Section>
            <Section title="What we have asked">
              {data.outgoing.length === 0 ? (
                <Text style={[type.small, { color: colour.inkMuted }]}>No requests sent by our sides.</Text>
              ) : (
                data.outgoing.slice(0, 20).map((r) => <RequestCard key={r.id} r={r} canRespond={false} busy={false} onOpen={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)} />)
              )}
            </Section>
            {earlier.length > 0 && (
              <Section title="Earlier">
                {earlier.slice(0, 20).map((r) => <RequestCard key={r.id} r={r} canRespond={false} busy={false} onOpen={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "request", id: r.id } } as never)} />)}
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{title}</Text>
      {children}
    </View>
  )
}

function RequestCard({ r, canRespond, busy, onDecide, onOpen }: { r: ClubFixtureRequest; canRespond: boolean; busy: boolean; onDecide?: (d: "accept" | "decline") => void; onOpen: () => void }) {
  const status = STATUS[r.status] ?? { label: r.status, tone: "neutral" as const }
  const what = [r.proposedDate ? exactDate(r.proposedDate) : null, r.preferredKickoffTime ? r.preferredKickoffTime.slice(0, 5) : null, r.venuePreference ? (r.venuePreference === "home" ? "Their place" : r.venuePreference === "away" ? "Our place" : "Either ground") : null, matchTypeLabel(r.gameType)].filter(Boolean).join(" · ")
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: r.status === "sent" && r.direction === "incoming" ? "rgba(138,90,0,0.35)" : colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: colour.inkSubtle, letterSpacing: 0.6 }]}>{r.ourTeam.toUpperCase()}</Text>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{r.direction === "incoming" ? `${r.otherClub} would like a match` : `We asked ${r.otherClub}`}</Text>
          {!!r.otherTeam && <Text style={[type.caption, { color: colour.inkMuted }]}>{r.otherTeam}</Text>}
        </View>
        <StatusPill label={status.label} tone={status.tone} />
      </View>
      {!!what && <Text style={[type.small, { color: colour.ink }]}>{what}</Text>}
      {!!r.note && <Text style={[type.caption, { color: colour.inkMuted }]}>{r.note}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Open the conversation about this request" onPress={onOpen} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, opacity: pressed ? 0.6 : 1 })}>
        <MessageSquare size={15} color={colour.forest800} />
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>Open the conversation</Text>
      </Pressable>
      {canRespond && r.status === "sent" && r.direction === "incoming" && onDecide && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Decline" variant="secondary" style={{ flex: 1 }} busy={busy} onPress={() => onDecide("decline")} />
          <Button label="Accept" style={{ flex: 1 }} busy={busy} onPress={() => onDecide("accept")} />
        </View>
      )}
    </View>
  )
}
