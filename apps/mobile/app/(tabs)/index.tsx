import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { useAppContexts } from "../../src/context/contexts"
import { loadHomeSummary, type HomeSummary } from "../../src/context/home-data"
import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { friendly, logDetail } from "../../src/errors/translate"
import { AppHeader } from "../../src/components/app-header"
import { ContextSheet } from "../../src/components/context-sheet"
import { FixtureCard } from "../../src/components/fixture-card"
import { NeedsAttention, type AttentionItem } from "../../src/components/needs-attention"
import { CalendarDays, ExternalLink, OvalIcon } from "../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, SectionHeading } from "../../src/components/ui"
import { colour, space, type } from "../../src/design/tokens"

/**
 * HOME — what matters now, what is next, what needs me.
 *
 * THE ORDER IS THE DESIGN. A person opening Ovalball on a Friday night is answering one of three
 * questions, and they are not equal: is anything waiting on me, what is the next match, what else is
 * on. So Needs Attention comes FIRST when it has anything in it and vanishes entirely when it does
 * not -- an empty "nothing needs you" panel is a permanent reminder of a thing that is not happening.
 *
 * NOT A GRID OF CARDS. Every card here earns its place by answering one of those three questions, and
 * the greeting is one line rather than a hero, because the person already knows who they are.
 *
 * SWITCHING CONTEXT CLEARS THE PAGE FIRST. The previous side's fixture must never sit under the new
 * side's name for the moment the next read is in flight -- and the skeleton, not a spinner, holds the
 * shape so the card does not shove the page down when it lands.
 */
export default function Home() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { loading, error, person, active, reload, unreadMessages } = useAppContexts()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [summaryError, setSummaryError] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadSummary = useCallback(async () => {
    if (!active) return
    setSummaryError(null)
    try {
      setSummary(await loadHomeSummary(supabase, active))
    } catch (caught) {
      const problem = friendly(caught, "this week")
      logDetail("home summary", problem)
      setSummaryError({ message: problem.message, offline: problem.retryable && /connection/i.test(problem.message) })
    }
  }, [active])

  useEffect(() => {
    setSummary(null)
    void loadSummary()
  }, [loadSummary])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    await loadSummary()
    setRefreshing(false)
  }, [reload, loadSummary])

  const attention = buildAttention(summary, active?.kind ?? null, {
    openFixtures: () => router.push("/(tabs)/fixtures"),
    openMessages: () => router.push("/(tabs)/messages"),
    unreadMessages,
  })

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[type.body, { color: colour.inkMuted }]}>
          {greeting()}, <Text style={[type.bodyMedium, { color: colour.ink }]}>{person.firstName ?? "there"}</Text>
        </Text>

        {error && <ErrorState message={error.message} onRetry={reload} />}

        {!loading && !error && !active && (
          <EmptyState
            title="No rugby here yet"
            body="Your account is not connected to a club or team. Ask your club to add you, or join one on the Ovalball website."
          />
        )}

        {attention.length > 0 && <NeedsAttention items={attention} />}

        {active && <ContextHome active={active.kind} label={active.label} summary={summary} error={summaryError} onRetry={loadSummary} loading={loading} />}
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

function ContextHome({
  active,
  label,
  summary,
  error,
  onRetry,
  loading,
}: {
  active: string
  label: string
  summary: HomeSummary | null
  error: { message: string; offline: boolean } | null
  onRetry: () => void
  loading: boolean
}) {
  if (active === "site_admin") {
    return (
      <Card>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Site Admin is on the web
        </Text>
        <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
          Platform administration — users, clubs, seasons, the team directory and release control — is a
          desk job with wide authority. It stays on the website rather than being squeezed onto a phone.
        </Text>
        <Button
          label="Open Ovalball Web Admin"
          variant="secondary"
          style={{ marginTop: space.md }}
          onPress={() => void Linking.openURL(`${webUrl}/admin`)}
        />
      </Card>
    )
  }

  if (active === "governing") {
    return (
      <Card>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {label}
        </Text>
        <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
          Competitions, affiliated clubs and the rest of a governing body&rsquo;s work are not in the
          mobile build yet. They are on the Ovalball website today.
        </Text>
        <Button
          label="Open on the Web"
          variant="secondary"
          style={{ marginTop: space.md }}
          onPress={() => void Linking.openURL(`${webUrl}/dashboard`)}
        />
      </Card>
    )
  }

  return (
    <View style={{ gap: space.xl }}>
      <View>
        <SectionHeading>Next Up</SectionHeading>
        {error ? (
          <ErrorState message={error.message} offline={error.offline} onRetry={onRetry} />
        ) : loading || summary === null ? (
          <CardSkeleton lines={2} />
        ) : summary.nextFixture ? (
          <FixtureCard fixture={summary.nextFixture} />
        ) : active === "team" ? (
          <EmptyState
            title="Nothing scheduled yet"
            body={`${label} has no upcoming fixture on Ovalball.`}
            icon={<OvalIcon size={22} color={colour.inkSubtle} />}
          />
        ) : (
          <EmptyState
            title="Pick a team to see its next match"
            body="A club covers several sides. Switch to one of them from the header, or open Fixtures."
            icon={<OvalIcon size={22} color={colour.inkSubtle} />}
          />
        )}
      </View>

      <View>
        <SectionHeading>This Week</SectionHeading>
        <EmptyState
          title="Training and events are coming"
          body="The week's training, meetings and club events arrive with the mobile Calendar."
          icon={<CalendarDays size={22} color={colour.inkSubtle} />}
        />
      </View>

      <Card onPress={() => void Linking.openURL(webUrl)} accessibilityLabel="Open Ovalball on the web">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <ExternalLink size={20} color={colour.forest800} />
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Everything else is on the web</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              Messages, People, Subscriptions and club administration, until they arrive in the app.
            </Text>
          </View>
        </View>
      </Card>
    </View>
  )
}

/**
 * WHAT ACTUALLY NEEDS SOMEBODY, from data already on this page.
 *
 * Only real state: if nobody has answered for the next fixture, that is a job. Nothing is invented and
 * nothing is shown speculatively -- an attention list that is sometimes wrong is one people stop
 * reading. The rest of the sources (fixture requests, join requests, subscriptions) arrive with the
 * domains that own them, and land in this same component.
 */
function buildAttention(
  summary: HomeSummary | null,
  kind: string | null,
  { openFixtures, openMessages, unreadMessages }: { openFixtures: () => void; openMessages: () => void; unreadMessages: number }
): AttentionItem[] {
  const items: AttentionItem[] = []

  // UNREAD MESSAGES ARE SOMETHING THAT NEEDS SOMEBODY, and the count is the canonical one -- the same
  // rows the inbox lists and the same number on the tab badge. Not urgent: an unread message is a job,
  // not an alarm, and colouring it as one would teach people to ignore the panel.
  if (unreadMessages > 0) {
    items.push({
      key: "unread-messages",
      label: unreadMessages === 1 ? "1 unread message" : `${unreadMessages} unread messages`,
      detail: "In Messages",
      onPress: openMessages,
    })
  }
  const fixture = summary?.nextFixture
  const availability = fixture?.availability
  if (fixture && availability && availability.awaiting > 0 && kind === "team") {
    items.push({
      key: "availability",
      label:
        availability.awaiting === 1
          ? "1 player has not said whether they can play"
          : `${availability.awaiting} players have not said whether they can play`,
      detail: `vs ${fixture.opponent}`,
      // Urgent only when the match is close enough that chasing is the actual job.
      urgent: daysUntil(fixture.date) <= 3,
      onPress: openFixtures,
    })
  }
  return items
}

function daysUntil(iso: string): number {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 99
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((date.getTime() - start.getTime()) / 86400000)
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}
