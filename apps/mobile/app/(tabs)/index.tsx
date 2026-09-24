import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { isFamilyFacingContext, type HeroPage } from "@ovalball/contracts"

import { useAppContexts } from "../../src/context/contexts"
import { loadHomeSummary, type HomeSummary } from "../../src/context/home-data"
import { HomeAttention } from "../../src/attention/home-attention"
import { routeForAgendaItem } from "../../src/links/destinations"
import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { friendly, logDetail } from "../../src/errors/translate"
import { AppHeader } from "../../src/components/app-header"
import { ChildFilter } from "../../src/components/child-filter"
import { useFamily } from "../../src/family/family"
import { ContextSheet } from "../../src/components/context-sheet"
import { RugbyHero } from "../../src/components/home/rugby-hero"
import { TeamHome } from "../../src/team/home"
import { AnnouncementPreview, NewsRail, SubscriptionStatusCard } from "../../src/components/home/sections"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../src/components/ui"
import { ExternalLink, OvalIcon } from "../../src/components/icons"
import { colour, space, surface, type } from "../../src/design/tokens"

/**
 * PARENT HOME — what do I need to know now.
 *
 * WHAT THIS REPLACED, AND WHY. The old Home led with a greeting, then "Next Up",
 * then "This Week", then a Calendar link -- a week's schedule browsed on a screen
 * whose whole job is somewhere else. Fixtures answers "what matches are coming".
 * The Calendar answers "what is happening across my rugby life". Home answering
 * the same question a third time made it the busiest screen in the app and the
 * least useful. So This Week is gone, and with it the Calendar shortcut, the
 * quick actions and the promotional band.
 *
 * WHAT IS LEFT IS THE ORDER A PARENT ACTUALLY ASKS IN:
 *
 *   who am I, and whose rugby am I reading
 *   what is next
 *   what has my club told me
 *   what is new
 *   is my child's membership in order
 *
 * AND EVERY ATTRACTIVE THING ON IT IS CONNECTED. The crest is the canonical club
 * logo, the colours are the club's own home kit through the measured accent
 * projection, the sides and the kick-off are the same participant match model the
 * Calendar card uses, the announcement is a published `club_announcements` row the
 * database decided this person may see, and the membership is the GoCardless
 * record the website reads. Nothing on this screen is decoration pretending to be
 * data -- a section with no canonical content is simply not drawn.
 */
export default function Home() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { loading, error, active, sessionContext, reload } = useAppContexts()
  const { selectedPlayerId, projection } = useFamily()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [summaryError, setSummaryError] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // A TEAM CONTEXT HAS ITS OWN HOME (CA-M7). The parent/participant summary below is not loaded for it:
  // the Team Home reads the shared team overview instead, and reading both would be two answers.
  const teamContext = active?.kind === "team"

  const loadSummary = useCallback(async () => {
    if (!active || !sessionContext || active.kind === "team") return
    setSummaryError(null)
    try {
      setSummary(await loadHomeSummary(supabase, sessionContext, active, selectedPlayerId, projection))
    } catch (caught) {
      const problem = friendly(caught, "your rugby")
      logDetail("home summary", problem)
      // A FAILED READ NEVER LEAVES YESTERDAY'S ANSWER DRESSED AS TODAY'S. An
      // out-of-date kick-off looks like a fact.
      setSummary(null)
      setSummaryError({ message: problem.message, offline: problem.retryable && /connection/i.test(problem.message) })
    }
  }, [active, sessionContext, selectedPlayerId, projection])

  // CLEARED BEFORE EVERY RE-READ. One child's rugby must never sit under another
  // child's name for the moment the next read is in flight.
  useEffect(() => {
    setSummary(null)
    void loadSummary()
  }, [loadSummary])

  // Answering elsewhere changes the canonical record, so coming back re-reads it.
  useFocusEffect(
    useCallback(() => {
      void loadSummary()
    }, [loadSummary])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    await loadSummary()
    setRefreshing(false)
  }, [reload, loadSummary])

  const family = active !== null && isFamilyFacingContext(active.kind)

  const openEvent = useCallback(
    (page: HeroPage) => {
      if (!active) return
      const route = routeForAgendaItem(page.item, active.kind)
      if (route) router.push(route as never)
    },
    [router, active]
  )

  return (
    /*
      A LIGHT APPLICATION SHELL. The page is chalk and the header stands on it,
      exactly as the Calendar's sheet and the rest of the product do. Forest is
      the signature -- the hero's feature ground, the active tab, the icons -- and
      a signature keeps its force by not being written over every inch of the
      page. The previous build was forest on forest on forest; this is the same
      application the Calendar belongs to.
    */
    <View style={{ flex: 1, backgroundColor: surface.page }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <ScrollView
        contentContainerStyle={{ paddingTop: space.md, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {/* The family chips, where there is a family to choose between. */}
        <ChildFilter style={{ paddingHorizontal: space.lg }} />

        {error && (
          <View style={{ paddingHorizontal: space.lg }}>
            <ErrorState message={error.message} onRetry={reload} />
          </View>
        )}

        {!loading && !error && !active && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title="No rugby here yet"
              body="Your account is not connected to a club or team. Ask your club to add you, or join one on the Ovalball website."
            />
          </View>
        )}

        {/* THE TEAM WORKSPACE. Home becomes the team's operational overview: what needs me, what is
            next, who has answered, who is in the side, what the club has said, what I may change. */}
        {teamContext && <TeamHome />}

        {!teamContext && !!summaryError && (
          <View style={{ paddingHorizontal: space.lg }}>
            <ErrorState message={summaryError.message} offline={summaryError.offline} onRetry={loadSummary} />
          </View>
        )}

        {!teamContext && !summaryError && !!active && summary === null && (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={1} />
          </View>
        )}

        {/* WHAT NEEDS ME, compactly: the shared attention projection for THIS context (CA-M8). Home shows the
            first few and hands the rest to the Notifications screen; the Team Home draws its own from the same
            projection. Absent, not empty, where there is nothing -- Home does not draw furniture for calm. */}
        {!teamContext && !!active && (active.kind !== "site_admin" && active.kind !== "governing") && <HomeAttention />}

        {!teamContext && !!summary && !!active && (
          <>
            {/* ============================================================
                  WHAT IS NEXT. The strongest thing on the screen, swiped rather
                  than spun -- a parent reading the training must not have it
                  taken away mid-sentence.
               ============================================================ */}
            {summary.hero.length > 0 ? (
              <RugbyHero
                pages={summary.hero}
                accents={summary.accents}
                crestUrl={summary.clubLogoUrl}
                clubName={summary.clubName}
                onOpen={openEvent}
              />
            ) : (
              <View style={{ paddingHorizontal: space.lg }}>
                <EmptyState
                  title="Nothing coming up"
                  body={
                    family
                      ? "No matches or training scheduled yet. When the club adds one, it will appear here."
                      : `${active.label} has nothing scheduled yet.`
                  }
                  icon={<OvalIcon size={22} color={colour.inkSubtle} />}
                />
              </View>
            )}

            {/* ============================================================
                  WHAT THE CLUB HAS SAID, WHAT IS NEW, AND THE MEMBERSHIP.

                  Each drawn only where the canonical product has something. A
                  club with nothing pinned gets no heading at all: the mock-up
                  shows a full screen, it does not authorise furniture for an
                  empty one.
               ============================================================ */}
            <AnnouncementPreview
              notices={summary.notices}
              accents={summary.accents}
              showClub={summary.voiceClubs > 1}
              onOpen={(notice) => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: notice.id } } as never)}
              onViewAll={() => router.push({ pathname: "/news", params: { tab: "announcements" } } as never)}
            />

            <NewsRail
              news={summary.news}
              accents={summary.accents}
              onOpen={(article) => router.push({ pathname: "/news/[articleId]", params: { articleId: article.id } } as never)}
              onViewAll={() => router.push({ pathname: "/news", params: { tab: "news" } } as never)}
            />

            {summary.subscriptions.map((subscription) => (
              <SubscriptionStatusCard
                key={subscription.playerId}
                subscription={subscription}
                accents={summary.accents}
                /* PROVIDER-HOSTED, DELIBERATELY. A GoCardless mandate is entered on
                   GoCardless's own pages and never recreated natively, so this hands
                   off to the canonical parent subscription surface. */
                onPress={() =>
                  void Linking.openURL(`${webUrl}/parent/players/${subscription.playerId}/subscription`)
                }
              />
            ))}

            {/* The club's own colours as a quiet rule, and the honest handoff for
                what the app does not hold yet. */}
            <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
              <Card onPress={() => void Linking.openURL(webUrl)} accessibilityLabel="Open Ovalball on the web">
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <ExternalLink size={20} color={colour.forest800} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>Everything else is on the web</Text>
                    <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                      People, club administration and the rest, until they arrive in the app.
                    </Text>
                  </View>
                </View>
              </Card>
            </View>
          </>
        )}

        {/* A site admin or a governing body is not a parent, and Home says so
            rather than drawing a family's hero with nothing in it. */}
        {!!active && (active.kind === "site_admin" || active.kind === "governing") && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Card>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                {active.kind === "site_admin" ? "Site Admin is on the web" : active.label}
              </Text>
              <Text style={[type.body, { color: colour.inkMuted, marginTop: space.xs }]}>
                {active.kind === "site_admin"
                  ? "Platform administration — users, clubs, seasons, the team directory and release control — is a desk job with wide authority. It stays on the website rather than being squeezed onto a phone."
                  : "Competitions, affiliated clubs and the rest of a governing body’s work are not in the mobile build yet."}
              </Text>
              <Button
                label="Open on the Web"
                variant="secondary"
                style={{ marginTop: space.md }}
                onPress={() => void Linking.openURL(`${webUrl}/${active.kind === "site_admin" ? "admin" : "dashboard"}`)}
              />
            </Card>
          </View>
        )}
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}
