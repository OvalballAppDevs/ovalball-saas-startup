import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { useAppContexts } from "../../src/context/contexts"
import { loadHomeSummary, readableDate, type HomeSummary } from "../../src/context/home-data"
import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { friendly, logDetail } from "../../src/errors/translate"
import { ContextSwitcher } from "../../src/components/context-switcher"
import { ClubCrest, PersonAvatar } from "../../src/components/identity"
import { Button, Card, EmptyState, ErrorState, Loading, SectionHeading, StatusPill } from "../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * HOME IS WHATEVER THE SELECTED CONTEXT MAKES IT.
 *
 * Switching context has to change the product or the switcher is decoration. A coach standing in
 * Under 12 Boys gets that side's next fixture; the same person switching to the club gets the club's
 * home; switching to a child gets the child's. One identity, one app, one screen that answers to the
 * scope it is in.
 *
 * SITE ADMIN IS DELIBERATELY SMALL HERE. Master control is a desk job with wide, destructive
 * authority, and reproducing it on a phone in a foundation build would be both a lot of work and a bad
 * idea. It says what it is and opens the website, which is honest and is what somebody in that context
 * would do anyway.
 *
 * THE HEADER NAMES THE PERSON, NOT THE SCOPE. Selecting a child does not turn the greeting into the
 * child -- you are still you. The CONTEXT strip below carries what you are looking at, with a crest
 * that came from the canonical resolver and is never a kit.
 */
export default function Home() {
  const insets = useSafeAreaInsets()
  const { loading, error, person, active, contexts, reload } = useAppContexts()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadSummary = useCallback(async () => {
    if (!active) return
    setSummaryError(null)
    try {
      setSummary(await loadHomeSummary(supabase, active))
    } catch (caught) {
      const problem = friendly(caught, "this week")
      logDetail("home summary", problem)
      setSummaryError(problem.message)
    }
  }, [active])

  useEffect(() => {
    // Cleared first: a fixture belonging to the side you just switched AWAY from must never sit on
    // screen under the new context's name while the next read is in flight.
    setSummary(null)
    void loadSummary()
  }, [loadSummary])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    await loadSummary()
    setRefreshing(false)
  }, [reload, loadSummary])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ backgroundColor: colour.chalk, paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <PersonAvatar name={person.firstName} url={person.avatarUrl} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>{greeting()},</Text>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]} numberOfLines={1}>
              {person.firstName ?? "Welcome"}
            </Text>
          </View>
        </View>

        {active && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Context: ${active.label}, ${active.roleLabel}. Change context`}
            accessibilityHint="Opens the list of clubs, teams and children you can switch to"
            onPress={() => setSwitcherOpen(true)}
            style={({ pressed }) => ({
              marginTop: space.lg,
              minHeight: TOUCH_TARGET + 16,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              backgroundColor: colour.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colour.line,
              padding: space.md,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <ClubCrest clubName={summary?.clubName ?? active.label} url={summary?.clubLogoUrl ?? active.logoUrl} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={1}>
                {active.label}
              </Text>
              <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>
                {summary?.clubName && summary.clubName !== active.label
                  ? `${summary.clubName} · ${active.roleLabel}`
                  : active.roleLabel}
              </Text>
            </View>
            <Text style={[type.small, { color: colour.forest800 }]}>{contexts.length > 1 ? "Switch" : ""}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
      >
        {loading && <Loading label="Loading your teams…" />}
        {error && <ErrorState message={error.message} onRetry={reload} />}
        {!loading && !error && !active && (
          <EmptyState
            title="No rugby here yet"
            body="Your account is not connected to a club or team. Ask your club to add you, or join one on the Ovalball website."
          />
        )}

        {!loading && active && <ContextHome context={active.kind} summary={summary} error={summaryError} label={active.label} />}
      </ScrollView>

      <ContextSwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  )
}

function ContextHome({
  context,
  summary,
  error,
  label,
}: {
  context: string
  summary: HomeSummary | null
  error: string | null
  label: string
}) {
  if (context === "site_admin") {
    return (
      <Card>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Site Admin is on the web
        </Text>
        <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
          Platform administration — users, clubs, seasons, the team directory and release control — is a
          desk job with wide authority, and it stays on the website rather than being squeezed onto a
          phone. Everything else in Ovalball is here.
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

  if (context === "governing") {
    return (
      <Card>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {label}
        </Text>
        <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
          Competitions, affiliated clubs and the rest of a governing body&rsquo;s work are not in the
          mobile build yet. You can see them on the Ovalball website today.
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
    <View style={{ gap: space.lg }}>
      <View>
        <SectionHeading>Next Fixture</SectionHeading>
        {error ? (
          <ErrorState message={error} />
        ) : summary?.nextFixture ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
              <View style={{ alignItems: "center", minWidth: 52 }}>
                <Text style={[type.overline, { color: colour.inkSubtle }]}>
                  {readableDate(summary.nextFixture.date).split(" ")[0].toUpperCase()}
                </Text>
                <Text style={[type.displaySmall, { color: colour.ink }]}>
                  {readableDate(summary.nextFixture.date).split(" ")[1]}
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  {readableDate(summary.nextFixture.date).split(" ")[2]?.toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={2}>
                  vs {summary.nextFixture.opponent}
                </Text>
                <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>
                  {[summary.nextFixture.kickoff?.slice(0, 5), homeAwayLabel(summary.nextFixture.homeAway)]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {summary.nextFixture.status && (
                <StatusPill label={titleise(summary.nextFixture.status)} tone={summary.nextFixture.status === "Booked" ? "positive" : "neutral"} />
              )}
            </View>
          </Card>
        ) : context === "team" ? (
          <EmptyState title="Nothing scheduled yet" body={`${label} has no upcoming fixture on Ovalball.`} />
        ) : (
          <EmptyState
            title="Pick a team to see its next fixture"
            body="A club or family context covers several teams. Switch to one of them, or open Fixtures."
          />
        )}
      </View>

      <View>
        <SectionHeading>This Week</SectionHeading>
        <EmptyState
          title="Training and events are coming"
          body="The week's training, meetings and club events arrive with the mobile Calendar. The website has them all today."
        />
      </View>
    </View>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function homeAwayLabel(value: string | null): string | null {
  if (!value) return null
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function titleise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, " ")
}
