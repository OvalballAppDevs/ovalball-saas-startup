import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { isFamilyFacingContext, memberFor, type AgendaItem, type ParentAttention } from "@ovalball/contracts"

import { useAppContexts } from "../../src/context/contexts"
import { loadHomeSummary, type HomeSummary } from "../../src/context/home-data"
import { todayIso } from "../../src/agenda/load"
import { routeForAgendaItem } from "../../src/links/destinations"
import { ClubNews, ClubNotices, RugbyHubCard } from "../../src/components/club-voice"
import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { friendly, logDetail } from "../../src/errors/translate"
import { AppHeader } from "../../src/components/app-header"
import { ChildFilter } from "../../src/components/child-filter"
import { ChildMark } from "../../src/components/child-mark"
import { useFamily } from "../../src/family/family"
import { ContextSheet } from "../../src/components/context-sheet"
import { AgendaRow, NextFixtureCard } from "../../src/components/agenda-row"
import { HomeSkeleton, NextUpAnswer, ThisWeek } from "../../src/components/parent-home"
import { NeedsAttention, type AttentionItem } from "../../src/components/needs-attention"
import { CalendarDays, ExternalLink, OvalIcon } from "../../src/components/icons"
import { Button, Card, EmptyState, ErrorState, SectionHeading } from "../../src/components/ui"
import { colour, radius, space, type } from "../../src/design/tokens"

/**
 * HOME — what needs me, what is next, what is on this week.
 *
 * THE ORDER IS THE PRODUCT, and it is the order somebody actually asks in. A
 * parent opening Ovalball on a Friday night wants to know whether anything is
 * waiting on them, then what the next thing is, then what else is coming. Those
 * three questions are not equal and they are not a grid of cards, so:
 *
 *   NEEDS ATTENTION  first, and gone entirely when there is nothing in it. An
 *                    empty "nothing needs you" panel is a permanent reminder of
 *                    something that is not happening.
 *   NEXT UP          the one thing to get ready for, with room to say it.
 *   THIS WEEK        the rest, by day, so the week can be read at a glance.
 *
 * ALL THREE COME FROM ONE READ AND ONE PROJECTION. `projectParentHome` in the
 * shared package answers them from the same canonical agenda rows, so the
 * headline, the attention list and the week cannot disagree about the same match
 * -- and the website cannot disagree with any of them.
 *
 * WHOSE RUGBY, ALWAYS. Every child-specific row carries the child's own name and
 * picture from `FamilyProjection`, never an age grade the parent has to decode.
 * Selecting a child narrows what is shown; it does not change who the signed-in
 * person is or what they may do.
 *
 * AND NOTHING HERE IS ADMINISTRATION. A match card is an entrance to the Match
 * Centre and a session card to the Training Centre -- decided once, in
 * `src/links/destinations` -- never to the fixture console.
 */
export default function Home() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { loading, error, person, active, sessionContext, reload, unread } = useAppContexts()
  // The selected child, already normalised against the resolved family.
  const { selectedPlayerId, projection, loading: familyLoading } = useFamily()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [summaryError, setSummaryError] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadSummary = useCallback(async () => {
    if (!active || !sessionContext) return
    setSummaryError(null)
    try {
      setSummary(await loadHomeSummary(supabase, sessionContext, active, selectedPlayerId))
    } catch (caught) {
      const problem = friendly(caught, "this week")
      logDetail("home summary", problem)
      /*
        A FAILED READ DOES NOT LEAVE YESTERDAY'S ANSWER ON SCREEN DRESSED AS
        TODAY'S. The summary is cleared before the error is shown, so nobody reads
        "Saturday, 10:30" that the app can no longer confirm -- an out-of-date
        kick-off is worse than no kick-off, because it looks like a fact.
      */
      setSummary(null)
      setSummaryError({ message: problem.message, offline: problem.retryable && /connection/i.test(problem.message) })
    }
  // Re-read when the child changes, so the headline is that child's next thing.
  }, [active, sessionContext, selectedPlayerId])

  /*
    CLEAR BEFORE READING, EVERY TIME THE QUESTION CHANGES.

    A context switch already did this; a CHILD switch has to as well. Leaving
    George's match under Pippa's chip for the moment the next read is in flight is
    the same defect wearing a smaller hat, and it is worse here because the two
    answers look alike -- both are a match, both are this weekend, and only the
    name says which child it belongs to.
  */
  useEffect(() => {
    setSummary(null)
    void loadSummary()
  }, [loadSummary])

  /*
    COMING BACK FROM ANSWERING IS A REASON TO RE-READ.

    Somebody taps an attention row, says yes in the Match Centre and comes back.
    The canonical record has changed, so Home's copy of it is stale -- and the row
    telling them to answer would still be sitting there. Re-reading on focus is
    how the two stay the same thing; nothing is written locally to paper over it.
  */
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

  const family = active ? isFamilyFacingContext(active.kind) : false

  const open = useCallback(
    (item: AgendaItem) => {
      if (!active) return
      const route = routeForAgendaItem(item, active.kind)
      if (route) router.push(route as never)
    },
    [router, active]
  )

  const attention = useMemo(
    () =>
      buildAttention(summary, {
        family,
        projection,
        openItem: open,
        nextAvailability: summary?.nextAvailability ?? null,
        openFixtures: () => router.push("/fixtures"),
      }),
    [summary, family, projection, open, router]
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      {/* The family filter sits directly under the identity row, where a parent
          of two looks first: it answers "whose week am I reading" before any of
          the week is read. */}
      <ChildFilter style={{ paddingHorizontal: space.lg, paddingTop: space.md }} />

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

        {/* NOTHING IS CLAIMED WHILE IT IS STILL BEING READ. Attention is the one
            section that must never appear speculatively: a row that says somebody
            has not answered, shown before the answers have arrived, is a row that
            is sometimes wrong -- and a panel that is sometimes wrong is one people
            stop reading. */}
        {attention.length > 0 && summary !== null && <NeedsAttention items={attention} />}

        {active && (
          <ContextHome
            active={active.kind}
            label={active.label}
            summary={summary}
            error={summaryError}
            onRetry={loadSummary}
            loading={loading || familyLoading}
            family={family}
            projection={projection}
            onOpen={open}
            onOpenCalendar={() => router.push("/calendar")}
          />
        )}
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
  family,
  projection,
  onOpen,
  onOpenCalendar,
}: {
  active: string
  label: string
  summary: HomeSummary | null
  error: { message: string; offline: boolean } | null
  onRetry: () => void
  loading: boolean
  family: boolean
  projection: React.ComponentProps<typeof ThisWeek>["family"]
  onOpen: (item: AgendaItem) => void
  onOpenCalendar: () => void
}) {
  const today = todayIso()
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

  /* A FAILED READ IS SAID ONCE, not repeated under three headings. */
  if (error) return <ErrorState message={error.message} offline={error.offline} onRetry={onRetry} />
  if (loading || summary === null) return <HomeSkeleton />

  const { next, week, nextIsInWeek } = summary.home

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <SectionHeading>Next Up</SectionHeading>
        {next ? (
          <>
            <NextFixtureCard
              item={next}
              today={today}
              // THE CLUB'S OWN COLOURS. The website's club home has been the
              // club's kit since the Club Digital Home landed -- a Burnley member
              // opens it and it is amber and blue. Ovalball's forest is the
              // fallback, for a club with no recorded kit.
              theme={summary.theme}
              child={family ? memberFor(projection, next.playerId) : null}
              onPress={() => onOpen(next)}
            />
            {/* WHETHER THIS FAMILY HAS ANSWERED, stated but not answerable here:
                the answer belongs where the server decides who may give it. */}
            {family && <NextUpAnswer item={next} family={projection} viewerIsThePlayer={active === "player"} />}
          </>
        ) : (
          <EmptyState
            title="Nothing coming up"
            body={
              family
                ? "There are no matches or training sessions scheduled yet. When the club adds one, it will appear here."
                : `${label} has nothing scheduled yet.`
            }
            icon={<OvalIcon size={22} color={colour.inkSubtle} />}
          />
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionHeading
          action={
            week.length > 0 ? (
              <Button label="Calendar" variant="quiet" onPress={onOpenCalendar} />
            ) : undefined
          }
        >
          This Week
        </SectionHeading>
        {week.length > 0 ? (
          <ThisWeek
            days={week}
            today={today}
            family={projection}
            nextKey={nextIsInWeek ? (next?.key ?? null) : null}
            onOpen={onOpen}
          />
        ) : (
          /* A QUIET WEEK IS AN ANSWER, not a broken region. And it must not
             contradict the card above it: when there IS something next, this says
             so rather than announcing an empty diary. */
          <EmptyState
            title={next ? "Nothing else this week" : "A quiet week"}
            body={
              next
                ? "The next thing is above. Nothing else is scheduled between now and Sunday."
                : "No matches or training between now and Sunday."
            }
            icon={<CalendarDays size={22} color={colour.inkSubtle} />}
          />
        )}
      </View>

      {/* WHAT THE CLUB HAS SAID.
          Below the rugby, because somebody opening Ovalball on a Saturday
          morning is asking when and where before they are asking anything else
          -- and above the web handoff, because it IS the app rather than a
          reason to leave it. Both sections collapse when the club has nothing
          to say, which is most weeks for most clubs. */}
      {!!summary.notices.length && <ClubNotices notices={summary.notices} />}
      {!!summary.news.length && (
        <ClubNews
          news={summary.news}
          theme={summary.theme}
          // The article opens on the club's own page. A news reader is its own
          // product; reproducing the body here would be a second one.
          onOpen={(article) => void Linking.openURL(`${webUrl}/club/${summary.clubSlug ?? ""}/news/${article.slug}`)}
        />
      )}
      <RugbyHubCard theme={summary.theme} onOpen={() => void Linking.openURL(`${webUrl}/rugby-hub`)} />

      <Card onPress={() => void Linking.openURL(webUrl)} accessibilityLabel="Open Ovalball on the web">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <ExternalLink size={20} color={colour.forest800} />
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Everything else is on the web</Text>
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
              People, Subscriptions and club administration, until they arrive in the app.
            </Text>
          </View>
        </View>
      </Card>
    </View>
  )
}

/**
 * WHAT ACTUALLY NEEDS SOMEBODY.
 *
 * THE DOMAIN DECIDES, NOT THE INTERFACE. Every item here comes from
 * `projectParentHome`, which applies the canonical rule -- the very same
 * `needsAttendanceResponse` the website's own outstanding-response count uses.
 * This function turns that into rows; it does not decide what is outstanding.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   UNREAD MESSAGES. They used to be the first row. An unread message is not a
 *   domain state requiring action -- it is a thing you have not looked at, and it
 *   already has its own badge in the header. Repeating it taught the panel to be a
 *   list of numbers, and a list of numbers is one people scroll past.
 *
 *   UNREAD NOTIFICATIONS. The same, and worse: READ IS NOT RESOLVED. A
 *   notification about a cancelled match is still a cancelled match after it has
 *   been opened, and the cancellation belongs on the fixture, not in a counter.
 *
 *   A SQUAD'S OUTSTANDING ANSWERS, for a family context. "Nine players have not
 *   said whether they can play" is a coach's job; a guardian sees their own
 *   child's answer and nobody else's.
 *
 *   A GUARDIAN LINK REQUEST. It reads like a parent's job and is not one:
 *   `internal.can_decide_guardian_link_request` requires
 *   `family.relationship.approve` at the CLUB, so the queue belongs to a Club
 *   Admin or a Safeguarding Officer. Putting it here would drop a club
 *   safeguarding queue into a parent's context -- and somebody who holds both
 *   hats would meet it while wearing the wrong one.
 */
function buildAttention(
  summary: HomeSummary | null,
  {
    family,
    projection,
    openItem,
    nextAvailability,
    openFixtures,
  }: {
    family: boolean
    projection: React.ComponentProps<typeof ThisWeek>["family"]
    openItem: (item: AgendaItem) => void
    nextAvailability: HomeSummary["nextAvailability"]
    openFixtures: () => void
  }
): AttentionItem[] {
  if (!summary) return []

  const items: AttentionItem[] = summary.home.attention.map((entry) => ({
    key: entry.key,
    label: entry.label,
    detail: entry.detail,
    urgent: entry.urgent,
    // A CHILD'S FACE ON THEIR OWN JOB. In a family of two, "Can Pippa make it?"
    // is already unambiguous, and the picture makes the row findable at a glance.
    leading: leadingFor(entry, projection),
    // EVERY ATTENTION ROW OPENS THE THING ITSELF. An item with nowhere to go is a
    // notification rather than attention, and the projection produces none.
    onPress: entry.item ? () => openItem(entry.item!) : undefined,
  }))

  /*
    THE STAFF SIDE OF THE SAME QUESTION, for a staff context only.

    A coach's job is the squad's outstanding answers, and it is urgent when the
    match is close enough that chasing is the actual work. This is the item a
    family context must never see, which is why it is gated on `!family` rather
    than on the server happening to refuse the read.
  */
  const next = summary.home.next
  if (!family && next?.kind === "fixture" && nextAvailability && nextAvailability.awaiting > 0) {
    items.push({
      key: "squad-availability",
      label:
        nextAvailability.awaiting === 1
          ? "1 player has not said whether they can play"
          : `${nextAvailability.awaiting} players have not said whether they can play`,
      detail: next.them ? `v ${[next.them.clubName, next.them.teamName].filter(Boolean).join(" ")}` : null,
      urgent: daysUntil(next.date) <= 3,
      onPress: openFixtures,
    })
  }

  return items
}

function leadingFor(
  entry: ParentAttention,
  projection: React.ComponentProps<typeof ThisWeek>["family"]
): React.ReactNode {
  const member = memberFor(projection, entry.playerId)
  if (!member) return null
  return <ChildMark member={member} size={20} />
}

function daysUntil(iso: string): number {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 99
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return Math.round((date.getTime() - start.getTime()) / 86400000)
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}
