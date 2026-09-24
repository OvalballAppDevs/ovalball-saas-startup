import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem } from "@ovalball/contracts"
import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"
import { newsCardFromArticle, noticeFromAnnouncement, type ClubNewsCard, type ClubNotice } from "@ovalball/contracts"
import { readFeed, readingScopeFor } from "@ovalball/contracts/club/content"
import { projectPlayerHome, type PlayerHome as PlayerHomeModel } from "@ovalball/contracts/player"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { readAgenda, todayIso } from "../agenda/load"
import { exactDate, kickoffLabel, relativeDate } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { HomeAttention } from "../attention/home-attention"
import { NextFixtureCard } from "../components/agenda-row"
import { AnnouncementPreview, NewsRail } from "../components/home/sections"
import { PersonAvatar } from "../components/identity"
import { BookOpen, ChevronRight, CircleCheck, CircleDashed, CircleX, HelpCircle, OvalIcon } from "../components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { clubAccentsOnDark, loadClubKitTheme, resolveClubTheme } from "@ovalball/contracts"

/**
 * PLAYER HOME -- a player's own rugby workspace (CA-M9).
 *
 * Not a stripped parent screen. A player asks, in order: what have I got next and where do I need to
 * be; what am I still to answer; what does my team need from me; what happened last time; and what can
 * I learn. Every fact is the same agenda the Calendar reads, narrowed by the server to the player's
 * own sides; every answer is the Match Centre's, which asks the server whether THIS player may answer
 * for themselves (an adult may; a sixteen-year-old with recorded consent may; nobody else does).
 * Nothing here is a staff control: membership of a side is never authority over it.
 */
export function PlayerHome() {
  const router = useRouter()
  const { active, sessionContext, person, club } = useAppContexts()
  const [model, setModel] = useState<PlayerHomeModel | null>(null)
  const [notices, setNotices] = useState<ClubNotice[]>([])
  const [news, setNews] = useState<ClubNewsCard[]>([])
  const [accents, setAccents] = useState(clubAccentsOnDark(resolveClubTheme(null), "#071c14"))
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!active || !sessionContext) return
    setProblem(null)
    try {
      const today = todayIso()
      const [agenda, feed, kit] = await Promise.all([
        readAgenda(supabase, sessionContext, active, { mode: "upcoming", includeTraining: true, today }),
        readFeed(supabase, readingScopeFor(active, sessionContext), { announcements: 3, news: 3 }).catch(() => ({ announcements: [], news: [], moreAnnouncements: false, moreNews: false })),
        active.clubId ? loadClubKitTheme(supabase, active.clubId).catch(() => null) : Promise.resolve(null),
      ])
      setModel(projectPlayerHome(agenda.items, today))
      setNotices(feed.announcements.map(noticeFromAnnouncement))
      setNews(feed.news.map(newsCardFromArticle))
      setAccents(clubAccentsOnDark(resolveClubTheme(kit), "#071c14"))
    } catch (caught) {
      const failure = friendly(caught, "your rugby")
      logDetail("player home", failure)
      setModel(null)
      setProblem({ message: failure.message, offline: failure.retryable && /connection/i.test(failure.message) })
    }
  }, [active, sessionContext])

  useEffect(() => {
    setModel(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const open = (item: AgendaItem) => {
    if (!active) return
    const route = routeForAgendaItem(item, active.kind)
    if (route) router.push(route as never)
  }
  const today = todayIso()
  const teamLine = [active?.label, club.name].filter(Boolean).join(" · ")

  return (
    <>
      {/* ============================================================ THE PLAYER */}
      <View style={{ paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }}>
        <PersonAvatar name={person.firstName} url={person.avatarUrl} size={52} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.overline, { color: colour.forest800 }]}>PLAYER</Text>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.title, { color: colour.ink }]}>
            {person.firstName ? `${person.firstName}'s rugby` : "Your rugby"}
          </Text>
          {!!teamLine && <Text numberOfLines={1} style={[type.small, { color: colour.inkMuted }]}>{teamLine}</Text>}
        </View>
      </View>

      {/* ============================================================ WHAT NEEDS ME */}
      <HomeAttention />

      {problem && (
        <View style={{ paddingHorizontal: space.lg }}>
          <ErrorState message={problem.message} offline={problem.offline} onRetry={() => void load()} />
        </View>
      )}
      {!problem && model === null && (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}

      {model && (
        <>
          {/* ============================================================ NEXT UP */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Next Up
            </Text>
            {model.next ? (
              <NextFixtureCard item={model.next} today={today} onPress={() => open(model.next!)} />
            ) : (
              <EmptyState title="Nothing coming up" body="When your team schedules a match or a session, it appears here." icon={<OvalIcon size={22} color={colour.inkSubtle} />} />
            )}
            {model.upcoming.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${item.kind === "training" ? "Training" : `v ${item.them?.clubName ?? "TBC"}`}, ${exactDate(item.date)}${item.time ? `, ${kickoffLabel(item.time)}` : ""}`}
                onPress={() => open(item)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? colour.chalk : colour.surface, borderWidth: 1, borderColor: colour.line })}
              >
                <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: item.kind === "training" ? colour.messengerBlue : colour.pitch600 }} />
                <View style={{ width: 64 }}>
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>{relativeDate(item.date, today)}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{kickoffLabel(item.time) ?? "TBC"}</Text>
                </View>
                <Text numberOfLines={1} style={[type.small, { color: colour.ink, flex: 1 }]}>{item.kind === "training" ? "Training" : `v ${[item.them?.clubName, item.them?.teamName].filter(Boolean).join(" ")}`}</Text>
                <ChevronRight size={16} color={colour.inkSubtle} />
              </Pressable>
            ))}
          </View>

          {/* ============================================================ MY AVAILABILITY */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                My Availability
              </Text>
              <Text style={[type.caption, { color: model.outstandingCount > 0 ? colour.warning : colour.inkMuted }]}>
                {model.outstandingCount > 0 ? `${model.outstandingCount} to answer` : "Up to date"}
              </Text>
            </View>
            {model.availability.length === 0 ? (
              <Text style={[type.small, { color: colour.inkMuted }]}>Nothing to answer in the next fortnight.</Text>
            ) : (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {model.availability.map((row, index) => {
                  const Icon = row.attendance === "ATTENDING" ? CircleCheck : row.attendance === "CANNOT_ATTEND" ? CircleX : row.attendance === "UNSURE" ? HelpCircle : CircleDashed
                  const tint = row.attendance === "ATTENDING" ? colour.forest800 : row.attendance === "CANNOT_ATTEND" ? colour.danger : row.attendance === "UNSURE" ? colour.warning : row.outstanding ? colour.warning : colour.inkSubtle
                  const word = row.attendance ? ATTENDANCE_STATE_WORDS[row.attendance] : row.outstanding ? "Still to answer" : "No answer needed yet"
                  return (
                    <Pressable
                      key={row.item.key}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.item.kind === "training" ? "Training" : `Match v ${row.item.them?.clubName ?? "TBC"}`} ${relativeDate(row.item.date, today)}. ${word}. Opens to answer`}
                      onPress={() => open(row.item)}
                      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : "transparent" })}
                    >
                      <Icon size={20} color={tint} strokeWidth={2} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>{row.item.kind === "training" ? "Training" : `v ${[row.item.them?.clubName, row.item.them?.teamName].filter(Boolean).join(" ")}`}</Text>
                        <Text style={[type.caption, { color: colour.inkMuted }]}>{`${relativeDate(row.item.date, today)}${row.item.time ? ` · ${kickoffLabel(row.item.time)}` : ""}`}</Text>
                      </View>
                      <Text style={[type.caption, { color: tint, fontFamily: "Inter_500Medium" }]}>{word}</Text>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </View>

          {/* ============================================================ LAST TIME OUT */}
          {model.lastResult && model.lastResult.result && (
            <View style={{ paddingHorizontal: space.lg }}>
              <Card onPress={() => open(model.lastResult!)} accessibilityLabel={`Last result: ${model.lastResult.result.ourScore} ${model.lastResult.result.theirScore} v ${model.lastResult.them?.clubName ?? "TBC"}. Opens the match`}>
                <Text style={[type.overline, { color: colour.forest800 }]}>LAST TIME OUT</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.xs }}>
                  <Text style={[type.display, { color: colour.ink, fontSize: 30, lineHeight: 34 }]}>{`${model.lastResult.result.ourScore}–${model.lastResult.result.theirScore}`}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>{`v ${[model.lastResult.them?.clubName, model.lastResult.them?.teamName].filter(Boolean).join(" ")}`}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{exactDate(model.lastResult.date)}</Text>
                  </View>
                  <ChevronRight size={16} color={colour.inkSubtle} />
                </View>
              </Card>
            </View>
          )}

          {/* ============================================================ THE CLUB'S VOICE */}
          <AnnouncementPreview
            notices={notices}
            accents={accents}
            onOpen={(notice) => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: notice.id } } as never)}
            onViewAll={() => router.push({ pathname: "/news", params: { tab: "announcements" } } as never)}
          />
          <NewsRail news={news} accents={accents} onOpen={(article) => router.push({ pathname: "/news/[articleId]", params: { articleId: article.id } } as never)} onViewAll={() => router.push({ pathname: "/news", params: { tab: "news" } } as never)} />

          {/* ============================================================ GET BETTER */}
          <View style={{ paddingHorizontal: space.lg }}>
            <Card onPress={() => router.push("/hub" as never)} accessibilityLabel="Rugby Hub. Skills, positions and the laws of the game">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                  <BookOpen size={20} color={colour.forest800} strokeWidth={1.9} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Rugby Hub</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Skills, positions, the laws and your development</Text>
                </View>
                <ChevronRight size={16} color={colour.inkSubtle} />
              </View>
            </Card>
          </View>
        </>
      )}
    </>
  )
}
