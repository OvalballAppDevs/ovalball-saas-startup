import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"

import { useBackToSurface } from "../links/back"
import { matchTypeLabel } from "@ovalball/contracts/fixtures/game-type"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { loadFixtureDetail, loadOppositionContacts, type FixtureDetail, type OppositionContact } from "../agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../agenda/authority"
import { cancelFixture, rejectKickoffChange, type MutationResult } from "../agenda/mutations"
import { exactDate, relativeDate, shortVenue, statusTone } from "../agenda/presentation"
import { todayIso } from "../agenda/load"
import { openConversationWith } from "../messages/recipients"
import { routeForIntent } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { FixtureHero } from "../components/fixture-hero"
import { CancelSheet } from "../components/field-sheet"
import { ChevronRight, ExternalLink, MessageSquare, OvalIcon } from "../components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * FIXTURE DETAIL (owner decision: the architecture fork is resolved) -- what/when/where/authorised
 * actions, READ-ONLY. Edit Fixture and Match Centre are its two doors out, each its own destination;
 * this screen mutates nothing of its own except Cancel Fixture (a decision made HERE, not a field edit)
 * and responding to a proposed kick-off change (also a decision, not an edit). Reuses the exact same
 * canonical read (`loadFixtureDetail`) and authority (`loadFixtureAuthority`) the former all-in-one
 * console used -- no second fixture model, no duplicated state.
 */
export function FixtureDetailScreen() {
  const router = useRouter()
  const back = useBackToSurface("/fixtures")
  const { sessionContext, active } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")
  const today = todayIso()

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [contacts, setContacts] = useState<OppositionContact[]>([])
  const [opening, setOpening] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelProblem, setCancelProblem] = useState<string | null>(null)
  const [responding, setResponding] = useState(false)

  const myTeamIds = useMemo(
    () =>
      new Set([
        ...(sessionContext?.teamPermissions ?? []).map((t) => t.teamId),
        ...(sessionContext?.guardianRelationships ?? []).map((g) => g.teamId),
        ...(sessionContext?.linkedPlayerTeams ?? []).map((p) => p.teamId),
      ]),
    [sessionContext]
  )

  const load = useCallback(async () => {
    if (!id) return
    setProblem(null)
    try {
      const loaded = await loadFixtureDetail(supabase, id, myTeamIds)
      if (!loaded) {
        setMissing(true)
        return
      }
      setFixture(loaded)
      setContacts(await loadOppositionContacts(supabase, id))
    } catch (caught) {
      const failure = friendly(caught, "this fixture")
      logDetail("fixture detail", failure)
      setProblem(failure.message)
    }
  }, [id, myTeamIds])

  useEffect(() => {
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    let live = true
    setAuthority(null)
    void loadFixtureAuthority(supabase, active).then((result) => live && setAuthority(result))
    return () => {
      live = false
    }
  }, [active])

  async function messageOpposition(contact: OppositionContact) {
    if (opening) return
    setOpening(true)
    const result = await openConversationWith(supabase, contact.userId)
    setOpening(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "direct", id: result.conversationId } })
  }

  async function respondToKickoffChange() {
    if (responding) return
    setResponding(true)
    const result = await rejectKickoffChange(supabase, id)
    setResponding(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await load()
  }

  async function confirmCancel(reason: string) {
    setCancelSaving(true)
    setCancelProblem(null)
    const result: MutationResult = await cancelFixture(supabase, id, reason)
    setCancelSaving(false)
    if (!result.ok) {
      setCancelProblem(result.message)
      return
    }
    setCancelOpen(false)
    await load()
  }

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Fixture" onBack={back} />
        <View style={{ padding: space.lg }}>
          <EmptyState
            title="This fixture isn't available"
            body="It may have been removed, or it may not be one you have access to."
            icon={<OvalIcon size={24} color={colour.inkSubtle} />}
          />
        </View>
      </View>
    )
  }

  const status = statusTone(fixture?.status ?? null)
  const cancelled = fixture?.status === "Cancelled"

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Fixture" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} onRetry={load} />}
        {!problem && !fixture && (
          <>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={2} />
          </>
        )}

        {!!fixture && (
          <>
            <FixtureHero
              us={fixture.us}
              them={fixture.them}
              homeAway={fixture.homeAway}
              onOvalball={fixture.opposition.onOvalball}
              result={fixture.result}
              editable={false}
              onEdit={() => undefined}
            />

            {!!status && status.tone !== "confirmed" && !cancelled && !fixture.result && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>{status.label}</Text>
            )}

            {!!fixture.proposedKickoff && !cancelled && (
              <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, gap: space.xs }}>
                <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.warning }]}>
                  {fixture.proposedKickoff.byUs ? "Change proposed — waiting for the other club" : "The other club has proposed a change"}
                </Text>
                <Text style={[type.small, { color: colour.warning }]}>
                  {exactDate(fixture.proposedKickoff.date)}
                  {fixture.proposedKickoff.time ? ` · ${fixture.proposedKickoff.time}` : ""}. Until they agree, this
                  fixture stays at {fixture.kickoff ?? "the agreed time"}.
                </Text>
                {authority?.edit && (
                  <Button
                    label={fixture.proposedKickoff.byUs ? "Withdraw" : "Decline"}
                    variant="secondary"
                    busy={responding}
                    onPress={() => void respondToKickoffChange()}
                  />
                )}
              </View>
            )}

            {cancelled && (
              <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: 2 }}>
                <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.danger }]}>
                  This fixture is cancelled
                </Text>
                {!!fixture.cancellationReason && <Text style={[type.small, { color: colour.danger }]}>{fixture.cancellationReason}</Text>}
              </View>
            )}

            <Group title="Fixture Details">
              {!!matchTypeLabel(fixture.gameType) && <Row label="Type" value={matchTypeLabel(fixture.gameType)!} />}
              <Row label="Date" value={`${relativeDate(fixture.date, today)}${relativeDate(fixture.date, today) === exactDate(fixture.date) ? "" : ` · ${exactDate(fixture.date)}`}`} />
              <Row label="Kick-off" value={fixture.kickoff ?? "Not set"} muted={!fixture.kickoff} />
              <Row label="Meet" value={fixture.meetTime ?? "Not set"} muted={!fixture.meetTime} />
              <Row label="Venue" value={shortVenue(fixture.venue) ?? "Not set"} muted={!fixture.venue} />
              <Row label="Pitch" value={fixture.pitch ?? "Not set"} muted={!fixture.pitch} />
              {!!fixture.competitionName && <Row label="Competition" value={fixture.competitionName} />}
              <Row label="Status" value={status?.label ?? fixture.status ?? "Not set"} last={!fixture.notes} />
              {!!fixture.notes && <Row label="Notes" value={fixture.notes} last />}
            </Group>

            {contacts.length > 0 && (
              <Group title="Communication">
                <Action
                  icon={<MessageSquare size={20} color={colour.forest800} strokeWidth={1.9} />}
                  label="Fixture Messages"
                  detail="The conversation for this fixture"
                  onPress={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id: fixture.id } })}
                />
                {contacts.map((contact, index) => (
                  <Action
                    key={contact.userId}
                    icon={<ExternalLink size={20} color={colour.forest800} strokeWidth={1.9} />}
                    label={contacts.length === 1 ? "Message Opposition" : `Message ${contact.displayName}`}
                    detail={[contact.displayName, contact.clubLabel].filter(Boolean).join(" · ")}
                    busy={opening}
                    onPress={() => void messageOpposition(contact)}
                    last={index === contacts.length - 1}
                  />
                ))}
              </Group>
            )}

            {contacts.length === 0 && (
              <Group title="Communication">
                <Action
                  icon={<MessageSquare size={20} color={colour.forest800} strokeWidth={1.9} />}
                  label="Fixture Messages"
                  detail="The conversation for this fixture"
                  onPress={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id: fixture.id } })}
                  last
                />
              </Group>
            )}

            <View style={{ gap: space.sm }}>
              <Button
                label="Match Centre"
                onPress={() => {
                  const route = routeForIntent({ kind: "MATCH_CENTRE", fixtureId: fixture.id })
                  if (route) router.push(route as never)
                }}
              />
              {authority?.edit && (
                <Button
                  label="Edit Fixture"
                  variant="secondary"
                  onPress={() => router.push(routeForIntent({ kind: "EDIT_FIXTURE", fixtureId: fixture.id }) as never)}
                />
              )}
            </View>

            {authority?.cancel && !cancelled && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel this fixture"
                onPress={() => {
                  setCancelProblem(null)
                  setCancelOpen(true)
                }}
                style={({ pressed }) => ({
                  marginTop: space.md,
                  minHeight: TOUCH_TARGET + 6,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.md,
                  backgroundColor: colour.danger,
                  opacity: pressed ? 0.88 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>Cancel Fixture</Text>
              </Pressable>
            )}

            <CancelSheet
              visible={cancelOpen}
              summary={{
                teams: `${fixture.us.teamName ?? fixture.us.clubName} ${fixture.homeAway === "Away" ? "at" : "v"} ${fixture.them.teamName ?? fixture.them.clubName}`,
                when: `${exactDate(fixture.date)}${fixture.kickoff ? ` · ${fixture.kickoff}` : ""}`,
              }}
              onClose={() => setCancelOpen(false)}
              saving={cancelSaving}
              problem={cancelProblem}
              onConfirm={(reason) => void confirmCancel(reason)}
            />
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  )
}

function Row({ label, value, muted, last }: { label: string; value: string; muted?: boolean; last?: boolean }) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colour.line,
      }}
    >
      <Text style={[type.small, { color: colour.inkMuted, width: 78 }]}>{label}</Text>
      <Text style={[type.bodyMedium, { color: muted ? colour.inkSubtle : colour.ink, fontSize: 15, flex: 1 }]}>{value}</Text>
    </View>
  )
}

function Action({ icon, label, detail, onPress, busy, last }: { icon: React.ReactNode; label: string; detail?: string; onPress: () => void; busy?: boolean; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 10,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: busy ? 0.6 : 1,
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        {!!detail && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {detail}
          </Text>
        )}
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
