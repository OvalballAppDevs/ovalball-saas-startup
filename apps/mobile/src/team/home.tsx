import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import * as Linking from "expo-linking"
import type { AgendaItem } from "@ovalball/contracts"
import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"
import { anyFixtureManagement, anyTeamAdministration } from "@ovalball/contracts/team/authority"
import { sortAttention, teamAttentionItems } from "@ovalball/contracts/attention"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { routeForAgendaItem } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { AVAILABILITY_GROUPS } from "../availability/presentation"
import { NextFixtureCard } from "../components/agenda-row"
import { NeedsAttention, type AttentionItem } from "../components/needs-attention"
import { AnnouncementPreview, NewsRail } from "../components/home/sections"
import { RugbyKit } from "../components/rugby-kit"
import { CalendarDays, ChevronRight, CircleAlert, ClipboardList, Compass, Dumbbell, Megaphone, OvalIcon, Receipt, Settings2, Users } from "../components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { webUrl } from "../config/environment"
import { loadTeamHome, type TeamHomeData } from "./data"
import { routeForAttentionItem } from "../attention/routes"

/**
 * TEAM HOME -- what do I need to deal with today (CA-M7).
 *
 * The workspace of the person standing at the side of a pitch with a phone in one hand. It answers, in
 * the order they ask: what needs me, what is next, who can play, who is in the side, what has the club
 * said, and what am I actually allowed to change. Every fact is the SHARED `loadTeamOverview` -- the
 * website's dashboard panel reads the same function -- laid over the club's own colours.
 *
 * IT IS NOT AN ADMIN DASHBOARD. There is no grid of tiles for every job at the club; the recurring jobs
 * are cards that lead somewhere, and the infrequent configuration is one row at the end. A read-only
 * persona sees the same team -- next up, who has answered, the squad -- and simply gets no control it
 * cannot use: the attention projection is capability-aware and the rows below check the same answer.
 *
 * THE TEAM IS THE IDENTITY. The header above already carries the person and the club crest; this block
 * names the SIDE, in the canonical display name, with the club's kit beside it -- the kit is what the
 * side wears, never who the club is, which is why it is here and not in the header's crest slot.
 */
export function TeamHome() {
  const router = useRouter()
  const { active, sessionContext, club } = useAppContexts()
  const [data, setData] = useState<TeamHomeData | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const today = todayIso()

  const load = useCallback(async () => {
    if (!active || !sessionContext || active.kind !== "team") return
    setProblem(null)
    try {
      setData(await loadTeamHome(supabase, sessionContext, active))
    } catch (caught) {
      const failure = friendly(caught, "your team")
      logDetail("team home", failure)
      setProblem({ message: failure.message, offline: failure.retryable && /connection/i.test(failure.message) })
    }
  }, [active, sessionContext])

  useEffect(() => {
    // Cleared FIRST on a context change: one side's answers must never sit under another side's name.
    setData(null)
    void load()
  }, [load])

  // Answering, deciding or editing elsewhere changes the canonical record, so coming back re-reads it.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  if (!active || active.kind !== "team") return null

  const openEvent = (item: AgendaItem) => {
    const route = routeForAgendaItem(item, active.kind)
    if (route) router.push(route as never)
  }

  if (problem && !data) {
    return (
      <View style={{ paddingHorizontal: space.lg }}>
        <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
      </View>
    )
  }

  if (!data) {
    return (
      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <CardSkeleton lines={2} />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={1} />
      </View>
    )
  }

  const { overview, theme, accents, identity, relationships, notices, news } = data
  const a = overview.authority
  // THE SHARED ATTENTION MODEL (CA-M8): the team rule's rows, in the one shape the Notifications screen
  // and Home read, sorted by the one deterministic order and opened through the one route table.
  const attention: AttentionItem[] = sortAttention(teamAttentionItems(overview, club.clubId)).map((item) => ({
    key: item.id,
    label: item.title,
    detail: item.summary,
    urgent: item.priority === "urgent",
    onPress: () => {
      const route = routeForAttentionItem(item, "team")
      if (route) router.push(route as never)
      else void Linking.openURL(`${webUrl}${item.href}`)
    },
  }))
  const relationship = relationships.map((r) => r.label).filter(Boolean).join(" · ")
  const identityLine = [club.name, identity.rugbyCode === "league" ? "Rugby League" : identity.rugbyCode === "union" ? "Rugby Union" : null].filter(Boolean).join(" · ")
  const nextIsFixture = overview.nextUp?.kind === "fixture"
  const availability = overview.availability

  return (
    <>
      {/* ============================================================ THE SIDE */}
      <View style={{ paddingHorizontal: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.overline, { color: colour.forest800 }]}>{relationship ? relationship.toUpperCase() : "TEAM"}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 34 }]}>
              {active.label}
            </Text>
            {!!identityLine && <Text style={[type.small, { color: colour.inkMuted }]}>{identityLine}</Text>}
            {!identity.active && <Text style={[type.caption, { color: colour.warning, fontFamily: "Inter_600SemiBold" }]}>Folded</Text>}
          </View>
          {/* THE KIT, SMALL AND BESIDE THE NAME. The team wears it; the club is the crest in the header. */}
          {theme.source === "home-kit" && (
            <RugbyKit kit={{ pattern: theme.pattern, primaryColour: theme.kit.primary, secondaryColour: theme.kit.secondary, accentColour: theme.kit.accent }} clubName={club.name ?? undefined} size={52} outline="rgba(16,21,18,0.14)" />
          )}
        </View>
      </View>

      {/* ============================================================ NEEDS ATTENTION */}
      {attention.length > 0 ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <NeedsAttention items={attention} />
        </View>
      ) : (
        <View style={{ paddingHorizontal: space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
            <OvalIcon size={16} color={colour.forest800} />
            <Text style={[type.small, { color: colour.forest800 }]}>Nothing needs your attention right now.</Text>
          </View>
        </View>
      )}

      {/* ============================================================ NEXT UP */}
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <SectionRow title="Next Up" actionLabel="Fixtures" onAction={() => router.push("/fixtures" as never)} />
        {overview.nextUp ? (
          <NextFixtureCard item={overview.nextUp} today={today} theme={theme} onPress={() => openEvent(overview.nextUp!)} />
        ) : (
          <EmptyState
            title="Nothing scheduled yet"
            body={anyFixtureManagement(a) ? "Add a fixture, or ask another club for a match, and it will appear here." : "Fixtures and training appear here as the club arranges them."}
            icon={<CalendarDays size={22} color={colour.inkSubtle} />}
          />
        )}

        {/* WHO HAS ANSWERED, for the fixture above -- the four canonical states, in the register's own
            words and order. Drawn only where the server handed the counts over. */}
        {nextIsFixture && availability && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Availability for the next fixture. ${AVAILABILITY_GROUPS.map((g) => `${countFor(availability, g.key)} ${g.label}`).join(", ")}. Opens the register.`}
            onPress={() => router.push({ pathname: "/team/availability/[kind]/[eventId]", params: { kind: "fixture", eventId: availability.fixtureId } } as never)}
            style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm, opacity: pressed ? 0.94 : 1 })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Who's In</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{availability.squad - availability.awaiting} of {availability.squad} answered</Text>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {AVAILABILITY_GROUPS.map((g) => (
                <View key={g.key} accessible={false} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: g.edge, backgroundColor: g.wash }}>
                  <g.Icon size={13} color={g.text} strokeWidth={2.5} />
                  <Text style={[type.displaySmall, { color: g.text, fontSize: 20, lineHeight: 22 }]}>{countFor(availability, g.key)}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10 }]}>{g.label}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        )}
      </View>

      {/* ============================================================ THE SQUAD */}
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <SectionRow title="The Side" actionLabel="People" onAction={() => router.push("/team/people" as never)} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Stat label="Players" value={overview.people.players} icon={<Users size={16} color={colour.forest800} />} onPress={() => router.push({ pathname: "/team/people", params: { tab: "players" } } as never)} />
          <Stat label="Staff" value={overview.people.staff} icon={<ClipboardList size={16} color={colour.forest800} />} onPress={() => router.push({ pathname: "/team/people", params: { tab: "staff" } } as never)} />
          {overview.people.pendingRequests > 0 && a.rosterManage && (
            <Stat label="Waiting" value={overview.people.pendingRequests} icon={<CircleAlert size={16} color={colour.warning} />} tone="caution" onPress={() => router.push("/team/settings/requests" as never)} />
          )}
        </View>
      </View>

      {/* ============================================================ WHAT THE CLUB HAS SAID */}
      <AnnouncementPreview
        notices={notices}
        accents={accents}
        onOpen={(notice) => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: notice.id } } as never)}
        onViewAll={() => router.push({ pathname: "/news", params: { tab: "announcements" } } as never)}
      />
      <NewsRail
        news={news}
        accents={accents}
        onOpen={(article) => router.push({ pathname: "/news/[articleId]", params: { articleId: article.id } } as never)}
        onViewAll={() => router.push({ pathname: "/news", params: { tab: "news" } } as never)}
      />

      {/* ============================================================ MONEY, where authorised */}
      {overview.subscriptions && (
        <View style={{ paddingHorizontal: space.lg }}>
          <Card onPress={() => router.push("/subscriptions" as never)} accessibilityLabel={subscriptionSentence(overview.subscriptions)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: overview.subscriptions.attentionCount > 0 ? colour.warningSurface : colour.successSurface }}>
                <Receipt size={18} color={overview.subscriptions.attentionCount > 0 ? colour.warning : colour.forest800} strokeWidth={2} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Subscriptions</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{subscriptionSentence(overview.subscriptions)}</Text>
              </View>
              <ChevronRight size={18} color={colour.inkSubtle} />
            </View>
          </Card>
        </View>
      )}

      {/* ============================================================ THE JOBS */}
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <SectionRow title="Run the Side" />
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          <JobRow icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />} label="Availability" caption="Who has answered, who has not" onPress={() => router.push("/team/availability" as never)} first />
          <JobRow icon={<Dumbbell size={19} color={colour.forest800} strokeWidth={1.9} />} label="Calendar" caption="Matches and training, week by week" onPress={() => router.push("/calendar" as never)} />
          {(a.requestRespond || a.requestCreate) && (
            <JobRow icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />} label="Fixture Requests" caption={a.requestRespond ? "Answer other clubs, and see what you have asked" : "What you have asked other clubs"} onPress={() => router.push("/team/requests" as never)} />
          )}
          <JobRow icon={<Compass size={19} color={colour.forest800} strokeWidth={1.9} />} label="Coaching in the Rugby Hub" caption="Sessions, skills and the laws, for this age" onPress={() => router.push("/hub/coaching" as never)} />
          {anyTeamAdministration(a) && (
            <JobRow icon={<Settings2 size={19} color={colour.forest800} strokeWidth={1.9} />} label="Team Settings" caption="Requests, codes, staff and publishing" onPress={() => router.push("/team/settings" as never)} />
          )}
        </View>
        {!anyFixtureManagement(a) && !anyTeamAdministration(a) && (
          <Text style={[type.caption, { color: colour.inkMuted }]}>You can see this team. Changing its fixtures or who is in it is done by the club.</Text>
        )}
      </View>

      <View style={{ paddingHorizontal: space.lg }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Open this team on the Ovalball website" onPress={() => void Linking.openURL(`${webUrl}/teams/${active.id}`)} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>Season handover, folding and club-wide settings stay on the website.</Text>
        </Pressable>
      </View>
    </>
  )
}

function countFor(a: { attending: number; unavailable: number; unsure: number; awaiting: number }, key: string): number {
  return key === "ATTENDING" ? a.attending : key === "UNSURE" ? a.unsure : key === "CANNOT_ATTEND" ? a.unavailable : a.awaiting
}

function subscriptionSentence(s: { attentionCount: number; programmeExists: boolean }): string {
  if (!s.programmeExists) return "The club does not collect subscriptions through Ovalball."
  if (s.attentionCount === 0) return "Everyone in the squad is set up."
  return s.attentionCount === 1 ? "1 player needs following up." : `${s.attentionCount} players need following up.`
}

function SectionRow({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        {title}
      </Text>
      {actionLabel && onAction && (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} hitSlop={8} style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{actionLabel}</Text>
          <ChevronRight size={15} color={colour.forest800} />
        </Pressable>
      )}
    </View>
  )
}

function Stat({ label, value, icon, onPress, tone = "neutral" }: { label: string; value: number; icon: React.ReactNode; onPress: () => void; tone?: "neutral" | "caution" }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET + 20, borderRadius: radius.lg, borderWidth: 1, borderColor: tone === "caution" ? colour.warning : colour.line, backgroundColor: tone === "caution" ? colour.warningSurface : colour.surface, padding: space.md, gap: 4, opacity: pressed ? 0.92 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon}
        <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
      </View>
      <Text style={[type.displaySmall, { color: colour.ink }]}>{value}</Text>
    </Pressable>
  )
}

function JobRow({ icon, label, caption, onPress, first = false }: { icon: React.ReactNode; label: string; caption: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}
