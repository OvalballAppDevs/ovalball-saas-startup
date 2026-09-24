import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem } from "@ovalball/contracts"
import { anyDeskFixtureTool } from "@ovalball/contracts/club/overview"
import { eventAudienceLabel, type ClubEventItem } from "@ovalball/contracts/agenda/events"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { exactDate, kickoffLabel, relativeDate } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { HomeAttention } from "../attention/home-attention"
import { NextFixtureCard } from "../components/agenda-row"
import { AnnouncementPreview, NewsRail } from "../components/home/sections"
import { ClubCrest } from "../components/identity"
import { CalendarDays, ChevronRight, ClipboardList, ExternalLink, Flag, Landmark, MapPin, Megaphone, OvalIcon, Users } from "../components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { loadClubHome, type ClubHomeData } from "./data"
import { clubAccentsOnDark, resolveClubTheme } from "@ovalball/contracts"

/**
 * CLUB HOME -- what does the club need from me today (CA-M10).
 *
 * Not the desktop Admin Centre on a phone. The person standing at the clubhouse door asks, in order:
 * what needs me; what is on today and next; how do the fixtures stand; which sides need something; what
 * has the club said; and what may I do from here. Every fact is the shared `loadClubOverview` -- one
 * authority probe at club scope, then only the reads it allows -- so a Club Admin, a Fixture Secretary
 * and a read-only member all see this page with only the authorised parts drawn.
 *
 * THE CREST IS THE CLUB. The header names the person; this names the club, with its own crest, never
 * a kit and never a person's picture.
 */
export function ClubHome() {
  const router = useRouter()
  const { active, sessionContext, club } = useAppContexts()
  const [data, setData] = useState<ClubHomeData | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!active || !sessionContext) return
    setProblem(null)
    try {
      setData(await loadClubHome(supabase, sessionContext, active))
    } catch (caught) {
      const failure = friendly(caught, "the club")
      logDetail("club home", failure)
      setData(null)
      setProblem({ message: failure.message, offline: failure.retryable && /connection/i.test(failure.message) })
    }
  }, [active, sessionContext])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const today = todayIso()
  const open = (item: AgendaItem) => {
    if (!active) return
    const route = routeForAgendaItem(item, active.kind)
    if (route) router.push(route as never)
  }
  const accents = clubAccentsOnDark(resolveClubTheme(null), "#071c14")

  return (
    <>
      {/* ============================================================ THE CLUB */}
      <View style={{ paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest clubName={club.name} url={club.crestUrl} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.overline, { color: colour.forest800 }]}>{(active?.roleLabel ?? "CLUB").toUpperCase()}</Text>
          <Text accessibilityRole="header" numberOfLines={2} style={[type.title, { color: colour.ink }]}>
            {club.name ?? active?.label ?? "Your club"}
          </Text>
          {data && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {`${data.overview.teams.length} ${data.overview.teams.length === 1 ? "side" : "sides"} · ${data.overview.snapshot.upcoming} ${data.overview.snapshot.upcoming === 1 ? "fixture" : "fixtures"} in the next fortnight`}
            </Text>
          )}
        </View>
      </View>

      {/* ============================================================ WHAT NEEDS ME */}
      <HomeAttention />

      {problem && (
        <View style={{ paddingHorizontal: space.lg }}>
          <ErrorState message={problem.message} offline={problem.offline} onRetry={() => void load()} />
        </View>
      )}
      {!problem && data === null && (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}

      {data && (
        <>
          {/* ============================================================ TODAY / NEXT UP */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <SectionRow title={data.overview.today.length > 0 || data.overview.eventsToday.length > 0 ? "Today" : "Next Up"} actionLabel="Calendar" onAction={() => router.push("/calendar" as never)} />
            {data.overview.eventsToday.map((event) => (
              <EventRow key={event.key} event={event} onPress={() => router.push({ pathname: "/calendar/event/[eventId]", params: { eventId: event.eventId } } as never)} />
            ))}
            {data.overview.today.map((item) => (
              <TodayRow key={item.key} item={item} onPress={() => open(item)} />
            ))}
            {data.overview.today.length === 0 && data.overview.eventsToday.length === 0 && (
              data.overview.next ? (
                <NextFixtureCard item={data.overview.next} today={today} onPress={() => open(data.overview.next!)} />
              ) : (
                <EmptyState title="Nothing coming up" body="When a side schedules a match or a session, it appears here." icon={<OvalIcon size={22} color={colour.inkSubtle} />} />
              )
            )}
            {(data.overview.today.length > 0 || data.overview.eventsToday.length > 0) && data.overview.next && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Next after today: ${data.overview.next.kind === "training" ? "training" : `v ${data.overview.next.them?.clubName ?? "TBC"}`}, ${exactDate(data.overview.next.date)}`} onPress={() => open(data.overview.next!)} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.6 : 1 })}>
                <Text style={[type.caption, { color: colour.inkMuted, flex: 1 }]}>{`Then ${relativeDate(data.overview.next.date, today).toLowerCase()}: ${data.overview.next.kind === "training" ? "training" : `${data.overview.next.us.teamName ?? "a side"} v ${data.overview.next.them?.clubName ?? "TBC"}`}`}</Text>
                <ChevronRight size={16} color={colour.inkSubtle} />
              </Pressable>
            )}
          </View>

          {/* ============================================================ FIXTURE SNAPSHOT */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <SectionRow title="Fixtures" actionLabel="All Fixtures" onAction={() => router.push("/fixtures" as never)} />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Stat label="Today" value={data.overview.snapshot.today} icon={<CalendarDays size={16} color={colour.forest800} />} onPress={() => router.push("/fixtures" as never)} />
              <Stat label="Next 14 days" value={data.overview.snapshot.upcoming} icon={<OvalIcon size={16} color={colour.forest800} />} onPress={() => router.push("/fixtures" as never)} />
              {(data.overview.authority.fixtureEdit || data.overview.authority.resultRecord) && (
                <Stat label="Need action" value={data.overview.snapshot.incomplete + data.overview.snapshot.awaitingUs} icon={<Flag size={16} color={colour.warning} />} tone={data.overview.snapshot.incomplete + data.overview.snapshot.awaitingUs > 0 ? "caution" : undefined} onPress={() => router.push("/notifications" as never)} />
              )}
              {data.overview.authority.requestRespond && (
                <Stat label="Requests" value={data.overview.snapshot.requestsIncoming} icon={<Megaphone size={16} color={colour.forest800} />} tone={data.overview.snapshot.requestsIncoming > 0 ? "caution" : undefined} onPress={() => router.push("/club/requests" as never)} />
              )}
            </View>
          </View>

          {/* ============================================================ THE SIDES */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <SectionRow title="Teams" actionLabel="All Teams" onAction={() => router.push("/club/teams" as never)} />
            {data.overview.teams.length === 0 ? (
              <Text style={[type.small, { color: colour.inkMuted }]}>No sides yet.</Text>
            ) : (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {data.overview.teams.slice(0, 5).map((row, index) => (
                  <Pressable
                    key={row.team.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.team.displayName}. ${row.players} players, ${row.staff} staff. ${row.nextFixture ? `Next: ${relativeDate(row.nextFixture.date, today)} v ${row.nextFixture.them?.clubName ?? "TBC"}` : "No fixture scheduled"}`}
                    onPress={() => router.push({ pathname: "/club/teams/[teamId]", params: { teamId: row.team.id } } as never)}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : "transparent" })}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{row.team.displayName}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{row.nextFixture ? `${relativeDate(row.nextFixture.date, today)} · v ${row.nextFixture.them?.clubName ?? "TBC"}` : "No fixture scheduled"}</Text>
                    </View>
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>{`${row.players} · ${row.staff}`}</Text>
                    <ChevronRight size={16} color={colour.inkSubtle} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* ============================================================ THE CLUB'S VOICE */}
          <AnnouncementPreview
            notices={data.notices}
            accents={accents}
            onOpen={(notice) => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: notice.id } } as never)}
            onViewAll={() => router.push({ pathname: "/news", params: { tab: "announcements" } } as never)}
          />
          <NewsRail news={data.news} accents={accents} onOpen={(article) => router.push({ pathname: "/news/[articleId]", params: { articleId: article.id } } as never)} onViewAll={() => router.push({ pathname: "/news", params: { tab: "news" } } as never)} />

          {/* ============================================================ WHAT I MAY DO FROM HERE */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <SectionRow title="From Here" />
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {data.overview.authority.peopleView && <JobRow first icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />} label="People" caption="Members, staff, and who is waiting to join" onPress={() => router.push("/admin/people" as never)} />}
              {data.overview.authority.requestRespond && <JobRow icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />} label="Fixture Requests" caption="What other clubs have asked, and what we have asked" onPress={() => router.push("/club/requests" as never)} />}
              {data.overview.authority.venueView && <JobRow icon={<MapPin size={19} color={colour.forest800} strokeWidth={1.9} />} label="Grounds & Pitches" caption="Where the club plays" onPress={() => router.push("/admin/venues" as never)} />}
              {data.overview.authority.newsManage && <JobRow icon={<ClipboardList size={19} color={colour.forest800} strokeWidth={1.9} />} label="Publish" caption="News and announcements" onPress={() => router.push("/admin/news" as never)} />}
              {anyDeskFixtureTool(data.overview.authority) && (
                <JobRow icon={<Landmark size={19} color={colour.forest800} strokeWidth={1.9} />} label="Fixture Control Centre" caption="Season planning, imports and bulk changes are desk work — on the website" external onPress={() => void Linking.openURL(`${webUrl}/fixtures/management`)} />
              )}
            </View>
          </View>
        </>
      )}
    </>
  )
}

function SectionRow({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{title}</Text>
      {!!actionLabel && !!onAction && (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

function Stat({ label, value, icon, tone, onPress }: { label: string; value: number; icon: React.ReactNode; tone?: "caution"; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET + 20, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: tone === "caution" ? "rgba(138,90,0,0.35)" : colour.line, backgroundColor: pressed ? colour.chalk : tone === "caution" ? colour.warningSurface : colour.surface, gap: 4 })}>
      {icon}
      <Text style={[type.title, { color: tone === "caution" ? colour.warning : colour.ink, fontSize: 22 }]}>{value}</Text>
      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </Pressable>
  )
}

function TodayRow({ item, onPress }: { item: AgendaItem; onPress: () => void }) {
  const training = item.kind === "training"
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${training ? "Training" : `${item.us.teamName ?? "A side"} v ${item.them?.clubName ?? "TBC"}`}${item.time ? `, ${kickoffLabel(item.time)}` : ""}${item.venue ? `, ${item.venue}` : ""}`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
      <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: training ? colour.messengerBlue : colour.pitch600 }} />
      <View style={{ width: 56 }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{kickoffLabel(item.time) ?? "TBC"}</Text>
        {!!item.meetTime && <Text style={[type.caption, { color: colour.inkMuted, fontSize: 10 }]}>{`meet ${item.meetTime}`}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{training ? `${item.us.teamName ?? "Training"} training` : `${item.us.teamName ?? "A side"} v ${item.them?.clubName ?? "TBC"}`}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{[item.homeAway === "Home" || item.homeAway === "Away" ? item.homeAway : null, item.venue, item.pitch].filter(Boolean).join(" · ") || "Venue TBC"}</Text>
      </View>
      <ChevronRight size={16} color={colour.inkSubtle} />
    </Pressable>
  )
}

function EventRow({ event, onPress }: { event: ClubEventItem; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Club event: ${event.name}, ${eventAudienceLabel(event)}${event.startTime ? `, ${event.startTime}` : ""}${event.where ? `, ${event.where}` : ""}`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}>
      <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: colour.warning }} />
      <View style={{ width: 56 }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{event.startTime ?? "All day"}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{event.name}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{[eventAudienceLabel(event), event.where].filter(Boolean).join(" · ")}</Text>
      </View>
      <ChevronRight size={16} color={colour.inkSubtle} />
    </Pressable>
  )
}

function JobRow({ icon, label, caption, onPress, first = false, external = false }: { icon: React.ReactNode; label: string; caption: string; onPress: () => void; first?: boolean; external?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={external ? `${label}. ${caption}. Opens the Ovalball website` : `${label}. ${caption}`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      {external ? <ExternalLink size={15} color={colour.inkSubtle} /> : <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}
