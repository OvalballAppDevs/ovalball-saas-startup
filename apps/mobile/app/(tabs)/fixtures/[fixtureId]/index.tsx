import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { loadFixtureDetail, type FixtureDetail } from "../../../../src/agenda/fixture-detail"
import { loadFixtureAuthority, type FixtureAuthority } from "../../../../src/agenda/authority"
import { exactDate, homeAwayLabel, kickoffLabel, relativeDate, statusTone } from "../../../../src/agenda/presentation"
import { todayIso } from "../../../../src/agenda/load"
import { searchClubDocuments, readableSize, type ClubDocument } from "../../../../src/messages/documents"
import { openAttachment } from "../../../../src/messages/open-attachment"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { ClubCrest } from "../../../../src/components/identity"
import { HomeAwayBadge } from "../../../../src/components/agenda-row"
import {
  CalendarDays,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  OvalIcon,
  Users,
} from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * ONE FIXTURE.
 *
 * The most important screen in the product after Home, and the one somebody opens standing in a car
 * park. So it is ordered by what is asked in that moment: who, when, where, how do I get there, who is
 * going, and then everything else.
 *
 * NOTHING HERE DECIDES AUTHORITY. The fixture arrives through RLS, the availability summary through an
 * RPC that returns nothing to somebody who may not see a squad's answers, and which fields may be
 * changed from `fixture_editable_fields` -- which also returns the REASON, so a refusal can be said
 * rather than implied by a greyed-out control.
 *
 * DIRECTIONS OPEN THE PHONE'S OWN MAPS. Ovalball is not building a map product: the device already has
 * one, it is better, and it knows about traffic on the M65.
 *
 * THE DOORS OUT ARE THE ONES THAT ALREADY EXIST. Messages routes into the M4 conversation; documents
 * reuse the M4 renderer and its security. Neither is rebuilt here, because a second fixture chat and a
 * second document reader are two more things to keep in step.
 */
export default function FixtureDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>()
  const id = String(fixtureId ?? "")
  const today = todayIso()

  const [fixture, setFixture] = useState<FixtureDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [documents, setDocuments] = useState<ClubDocument[] | null>(null)
  const [openingDocument, setOpeningDocument] = useState<string | null>(null)

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

  /**
   * VISITOR INFORMATION, WHERE THE CLUB HAS PUBLISHED IT.
   *
   * The same library the M4 document sharing reads, through the same RLS -- so this lists exactly what
   * this person may already see, and nothing appears here because it is a fixture. The categories are
   * the visitor-facing ones: a guide, ground and pitch information, parking, match-day instructions.
   * A committee minute filed under "other" is not fixture information and is not offered.
   */
  useEffect(() => {
    let live = true
    setDocuments(null)
    void (async () => {
      try {
        const all = await searchClubDocuments(supabase, "", "direct")
        if (live) setDocuments(all.slice(0, 6))
      } catch {
        if (live) setDocuments([])
      }
    })()
    return () => {
      live = false
    }
  }, [id])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  async function openDocument(document: ClubDocument) {
    if (openingDocument) return
    setOpeningDocument(document.id)
    const { data } = await supabase.storage.from("club-documents").createSignedUrl(await storagePath(document.id), 3600)
    const result = await openAttachment({
      id: document.id,
      filename: document.filename ?? `${document.title}.pdf`,
      mimeType: document.mimeType ?? "application/pdf",
      signedUrl: data?.signedUrl ?? null,
    })
    setOpeningDocument(null)
    if (!result.ok) setProblem(result.message)
  }

  if (missing) {
    return (
      <Shell title="Fixture" onBack={() => router.back()} insets={insets}>
        <EmptyState
          title="This fixture isn't available"
          body="It may have been removed, or it may not be one you have access to."
          icon={<OvalIcon size={24} color={colour.inkSubtle} />}
        />
      </Shell>
    )
  }

  const status = statusTone(fixture?.status ?? null)
  const home = homeAwayLabel(fixture?.homeAway ?? null)
  const time = kickoffLabel(fixture?.kickoff ?? null)
  const canEdit = (authority?.edit ?? false) && (fixture?.editable.details?.editable ?? fixture?.editable.schedule?.editable ?? false)
  const canCancel = (authority?.cancel ?? false) && fixture?.status !== "Cancelled"

  return (
    <Shell
      title={fixture ? (fixture.them.teamName ? `${fixture.them.clubName} ${fixture.them.teamName}` : fixture.them.clubName) : "Fixture"}
      subtitle={fixture ? `${fixture.us.teamName ?? fixture.us.clubName} · ${relativeDate(fixture.date, today)}` : undefined}
      onBack={() => router.back()}
      insets={insets}
      refreshing={refreshing}
      onRefresh={refresh}
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
          {/* THE MATCH ITSELF: two sides, and which of them is at home said in words. */}
          <View style={{ backgroundColor: colour.forest800, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ClubCrest clubName={fixture.us.clubName} url={fixture.us.crestUrl} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[type.smallMedium, { color: colour.onForest }]}>
                  {fixture.us.teamName ?? fixture.us.clubName}
                </Text>
                <Text style={[type.caption, { color: colour.onForestMuted }]}>{fixture.us.clubName}</Text>
              </View>
              {/* THE SAME MARK AS EVERY FIXTURE ROW. The two sides are stacked here, so the badge sits
                  on OUR line: it says where WE are playing, which is the question being asked. */}
              {!!home && <HomeAwayBadge home={home} size={30} />}
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <ClubCrest clubName={fixture.them.clubName} url={fixture.them.crestUrl} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={[type.smallMedium, { color: colour.onForest }]}>
                  {fixture.them.teamName ?? fixture.them.clubName}
                </Text>
                {!!fixture.them.teamName && (
                  <Text style={[type.caption, { color: colour.onForestMuted }]}>{fixture.them.clubName}</Text>
                )}
              </View>
              {/* A RESULT ONLY WHERE THE SERVER GAVE ONE. Youth rugby does not always publish a score,
                  and the reader carries that decision -- this just renders what arrived. */}
              {!!fixture.result && (
                <Text style={[type.title, { color: colour.onForest }]}>
                  {fixture.result.ourScore}–{fixture.result.theirScore}
                </Text>
              )}
            </View>

            {!!status && status.tone !== "confirmed" && (
              <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 }}>
                <Text style={[type.caption, { color: colour.onForest, fontSize: 11 }]}>{status.label}</Text>
              </View>
            )}
          </View>

          {/* A CANCELLATION SAYS WHY. The reason is required by the database precisely so that it can be
              read here rather than leaving everybody to ring round. */}
          {fixture.status === "Cancelled" && (
            <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: 2 }}>
              <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.danger }]}>
                This fixture is cancelled
              </Text>
              {!!fixture.cancellationReason && (
                <Text style={[type.small, { color: colour.danger }]}>{fixture.cancellationReason}</Text>
              )}
            </View>
          )}

          <Facts>
            <Fact
              icon={<CalendarDays size={18} color={colour.forest800} strokeWidth={1.9} />}
              label={relativeDate(fixture.date, today)}
              detail={exactDate(fixture.date)}
            />
            {!!time && (
              <Fact
                icon={<Clock size={18} color={colour.forest800} strokeWidth={1.9} />}
                label={`Kick-off ${time}`}
                detail={fixture.meetTime ? `Meet at ${fixture.meetTime}` : undefined}
              />
            )}
            {!!fixture.venue && (
              <Fact
                icon={<MapPin size={18} color={colour.forest800} strokeWidth={1.9} />}
                label={fixture.venue}
                detail={[fixture.pitch, fixture.venueAddress].filter(Boolean).join(" · ") || undefined}
                action={
                  fixture.venueAddress
                    ? { label: "Directions", onPress: () => void openDirections(fixture.venueAddress!) }
                    : undefined
                }
              />
            )}
            {!!fixture.competitionName && (
              <Fact icon={<OvalIcon size={18} color={colour.forest800} />} label={fixture.competitionName} detail="Competition" />
            )}
          </Facts>

          {!!fixture.venueDirections && (
            <Section title="Getting There">
              <Text style={[type.small, { color: colour.inkMuted }]}>{fixture.venueDirections}</Text>
            </Section>
          )}

          {!!fixture.notes && (
            <Section title="Notes">
              <Text style={[type.small, { color: colour.inkMuted }]}>{fixture.notes}</Text>
            </Section>
          )}

          {/* WHO IS GOING. Absent entirely where this viewer may not see the squad's answers -- a
              guardian sees their own child's response elsewhere, not the team's tally. M6 owns doing
              anything about it; this only reports it. */}
          {!!fixture.availability && (
            <Section title="Availability">
              <View
                accessible
                accessibilityLabel={`${fixture.availability.available} available, ${fixture.availability.unavailable} unavailable, ${fixture.availability.awaiting} awaiting a response, from a squad of ${fixture.availability.squad}.`}
                style={{ flexDirection: "row", gap: space.lg }}
              >
                <Count value={fixture.availability.available} label="Available" tone={colour.forest800} />
                <Count value={fixture.availability.unavailable} label="Unavailable" tone={colour.danger} />
                <Count value={fixture.availability.awaiting} label="Awaiting" tone={colour.warning} />
              </View>
            </Section>
          )}

          <Section title="This Fixture">
            {!!fixture.conversationId && (
              <Row
                icon={<MessageSquare size={19} color={colour.forest800} strokeWidth={1.9} />}
                label="Messages"
                detail="The conversation for this fixture"
                onPress={() => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id: fixture.id } })}
              />
            )}
            <Row
              icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />}
              label="Match Centre"
              detail="Team sheet, availability and match day"
              onPress={() => router.push({ pathname: "/fixtures/[fixtureId]/match-centre", params: { fixtureId: fixture.id } })}
            />
          </Section>

          {!!documents?.length && (
            <Section title="Club Documents">
              {documents.map((document) => (
                <Row
                  key={document.id}
                  icon={<FileText size={19} color={colour.forest800} strokeWidth={1.9} />}
                  label={document.title}
                  detail={[document.category, readableSize(document.sizeBytes)].filter(Boolean).join(" · ")}
                  busy={openingDocument === document.id}
                  onPress={() => void openDocument(document)}
                />
              ))}
            </Section>
          )}

          {(canEdit || canCancel) && (
            <Section title="Manage">
              {canEdit && (
                <Row
                  icon={<CalendarDays size={19} color={colour.forest800} strokeWidth={1.9} />}
                  label="Edit Fixture"
                  detail="Date, kick-off, venue and details"
                  onPress={() => router.push({ pathname: "/fixtures/[fixtureId]/edit", params: { fixtureId: fixture.id } })}
                />
              )}
              {canCancel && (
                <Row
                  icon={<OvalIcon size={19} color={colour.danger} />}
                  label="Cancel Fixture"
                  detail="Tells the other side and the players why"
                  danger
                  onPress={() => router.push({ pathname: "/fixtures/[fixtureId]/cancel", params: { fixtureId: fixture.id } })}
                />
              )}
            </Section>
          )}

          {/* WHERE A REFUSAL HAS A REASON, IT IS SAID. `fixture_editable_fields` returns the sentence
              the database would have used; a greyed-out control that explains nothing makes somebody
              guess whether the app is broken. */}
          {authority?.edit && fixture.editable.schedule?.editable === false && !!fixture.editable.schedule.reason && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>{fixture.editable.schedule.reason}</Text>
          )}
        </>
      )}
    </Shell>
  )
}

/**
 * DIRECTIONS, IN THE PHONE'S OWN MAPS.
 *
 * Apple Maps on iOS and the geo: scheme on Android, both falling back to a web map so the button
 * always does something. The address is encoded rather than interpolated: a ground called "St Mary's &
 * St John's" would otherwise break the URL and open nothing.
 */
async function openDirections(address: string): Promise<void> {
  const query = encodeURIComponent(address)
  const native = Platform.OS === "ios" ? `maps://?daddr=${query}` : `geo:0,0?q=${query}`
  const web = `https://maps.google.com/?q=${query}`
  try {
    if (await Linking.canOpenURL(native)) {
      await Linking.openURL(native)
      return
    }
    await Linking.openURL(web)
  } catch {
    Alert.alert("Directions", "This device can't open a map for that address.")
  }
}

/** The signed URL needs the storage path, which the search projection deliberately does not carry. */
async function storagePath(documentId: string): Promise<string> {
  const { data } = await supabase.from("club_documents").select("storage_path").eq("id", documentId).maybeSingle()
  return data?.storage_path ?? ""
}

function Shell({
  title,
  subtitle,
  onBack,
  insets,
  children,
  refreshing,
  onRefresh,
}: {
  title: string
  subtitle?: string
  onBack: () => void
  insets: { top: number; bottom: number }
  children: React.ReactNode
  refreshing?: boolean
  onRefresh?: () => void
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Fixtures"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
            {title}
          </Text>
          {!!subtitle && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colour.forest800} /> : undefined}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  )
}

function Facts({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {children}
    </View>
  )
}

function Fact({
  icon,
  label,
  detail,
  action,
}: {
  icon: React.ReactNode
  label: string
  detail?: string
  action?: { label: string; onPress: () => void }
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        minHeight: TOUCH_TARGET + 6,
      }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        {!!detail && (
          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{detail}</Text>
        )}
      </View>
      {!!action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: space.sm,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ExternalLink size={15} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800, fontSize: 13 }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  )
}

function Row({
  icon,
  label,
  detail,
  onPress,
  danger,
  busy,
}: {
  icon: React.ReactNode
  label: string
  detail?: string
  onPress: () => void
  danger?: boolean
  busy?: boolean
}) {
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
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
        opacity: busy ? 0.6 : 1,
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: danger ? colour.danger : colour.ink }]}>
          {label}
        </Text>
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

function Count({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View accessible={false} style={{ alignItems: "flex-start", paddingVertical: space.md, paddingHorizontal: space.md }}>
      <Text style={[type.title, { color: tone }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}
