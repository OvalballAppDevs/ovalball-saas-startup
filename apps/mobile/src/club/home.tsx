import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import type { AgendaItem, ClubNewsCard, ClubNotice } from "@ovalball/contracts"
import type { ClubTeamSummary } from "@ovalball/contracts/club/overview"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { todayIso } from "../agenda/load"
import { relativeDate } from "../agenda/presentation"
import { routeForAgendaItem } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { HomeAttention } from "../attention/home-attention"
import { NextFixtureCard } from "../components/agenda-row"
import { fallbackFor } from "../components/home/sections"
import { ClubCrest } from "../components/identity"
import { PhotoBottomShade } from "../components/photo-gradient"
import { demoTeamCoverAsset } from "../team/team-cover-demo"
import { BookOpen, ChevronRight, House, MapPin, Megaphone, OvalIcon, SlidersHorizontal } from "../components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"
import { loadClubHome, type ClubHomeData } from "./data"

const heroPhoto = require("../../assets/club-home/hero-club.jpg")
const tileClubhouse = require("../../assets/editorial/rugby-community.jpg")
const tilePitchAllocation = require("../../assets/hub/scene-pitch.jpg")
const tileRugbyHub = require("../../assets/club-home/tile-rugby-hub.jpg")
const tileAdminConsole = require("../../assets/hub/hero-coach.jpg")

/**
 * CLUB HOME -- the living front door of the club, not a dashboard (CA-M10, Visual Correction Pass).
 *
 * Every fact still comes from the shared `loadClubOverview` -- one authority probe at club scope, then
 * only the reads it allows -- so a Club Admin, a Fixture Secretary and a read-only member all see this
 * page with only the authorised parts drawn. This pass changes how it LOOKS, not what it knows: a
 * photographic hero, one Next Match card, a photographic action grid, a photographic Your Teams rail
 * and one merged News & Announcements rail, matching the approved mockup's geometry. The previous
 * "Today" fixture list and the four-stat KPI row are retired -- not silently: their only load-bearing
 * fact beyond what remains reachable was a fixture happening TODAY, which the Next Match slot below now
 * shows in preference to the next fixture after today, and "needs action"/incoming requests are already
 * surfaced by `HomeAttention` (the same shared projection Notifications reads), so nothing on it was
 * only ever visible as a Home stat tile.
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
  // A MATCH TODAY BEATS THE NEXT ONE AFTER TODAY. `overview.next` deliberately excludes today (it is
  // "what's after today"), which is right for a Fixture Snapshot but would hide a fixture kicking off
  // in an hour from a single Next Match slot -- so this prefers today's own fixture/training first.
  const nextMatchItem = data?.overview.today[0] ?? data?.overview.next ?? null

  return (
    <>
      <ClubHomeHero clubName={club.name ?? active?.label ?? "Your club"} crestUrl={club.crestUrl} teams={data?.overview.teams.length ?? null} upcoming={data?.overview.snapshot.upcoming ?? null} />

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
          {/* ============================================================ NEXT MATCH */}
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <SectionRow title="Next Match" actionLabel="Calendar" onAction={() => router.push("/calendar" as never)} />
            {nextMatchItem ? (
              <NextFixtureCard item={nextMatchItem} today={today} onPress={() => open(nextMatchItem)} />
            ) : (
              <EmptyState title="Nothing coming up" body="When a side schedules a match or a session, it appears here." icon={<OvalIcon size={22} color={colour.inkSubtle} />} />
            )}
          </View>

          {/* ============================================================ THE FOUR TILES */}
          <View style={{ paddingHorizontal: space.lg }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <PhotoTile label="Clubhouse" caption="People, teams and club info" icon={<House size={18} color="#fff" />} image={tileClubhouse} onPress={() => router.push("/clubhouse" as never)} />
              <PhotoTile label="Pitch Allocation" caption="Assign fixtures to pitches" icon={<MapPin size={18} color="#fff" />} image={tilePitchAllocation} onPress={() => router.push("/admin/pitch-allocation" as never)} />
              <PhotoTile label="Rugby Hub" caption="Resources, guidance and more" icon={<BookOpen size={18} color="#fff" />} image={tileRugbyHub} onPress={() => router.push("/hub" as never)} />
              <PhotoTile label="Admin Console" caption="Manage your club" icon={<SlidersHorizontal size={18} color="#fff" />} image={tileAdminConsole} onPress={() => router.push("/admin" as never)} />
            </View>
          </View>

          {/* ============================================================ YOUR TEAMS */}
          <View style={{ gap: space.sm }}>
            <View style={{ paddingHorizontal: space.lg }}>
              <SectionRow title="Your Teams" actionLabel="All Teams" onAction={() => router.push("/club/teams" as never)} />
            </View>
            {data.overview.teams.length === 0 ? (
              <View style={{ paddingHorizontal: space.lg }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>No sides yet.</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
                {data.overview.teams.map((row) => (
                  <TeamPhotoCard key={row.team.id} row={row} today={today} onPress={() => router.push({ pathname: "/teams/[teamId]", params: { teamId: row.team.id } } as never)} />
                ))}
              </ScrollView>
            )}
          </View>

          {/* ============================================================ LATEST NEWS & ANNOUNCEMENTS */}
          <LatestNewsAndAnnouncements
            notices={data.notices}
            news={data.news}
            onOpenNotice={(notice) => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: notice.id } } as never)}
            onOpenArticle={(article) => router.push({ pathname: "/news/[articleId]", params: { articleId: article.id } } as never)}
            onViewAll={() => router.push("/news" as never)}
          />
        </>
      )}
    </>
  )
}

/** "Good Morning" / "Good Afternoon" / "Good Evening" -- read once per render from the device clock. */
function timeOfDayGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good Morning"
  if (hour < 18) return "Good Afternoon"
  return "Good Evening"
}

const HERO_HEIGHT = 300

/**
 * THE FULL-BLEED PHOTOGRAPHIC HERO (owner's Visual Correction Pass). One Higgsfield community-pitch
 * photograph, reviewed by eye before import (no crest, no brand, no legible text, no face to camera),
 * with the same bottom-dark gradient every photographic surface in the app now shares
 * (`PhotoBottomShade`). The greeting is real -- the device's own clock -- never a static "Good Morning"
 * shown at 9pm. The crest and context switcher stay in the forest app header above; this hero carries
 * no identity chrome of its own, only the club's name and what the page is for.
 */
function ClubHomeHero({ clubName, crestUrl, teams, upcoming }: { clubName: string; crestUrl: string | null; teams: number | null; upcoming: number | null }) {
  return (
    <View style={{ height: HERO_HEIGHT, backgroundColor: surface.forest, overflow: "hidden" }}>
      <Image source={heroPhoto} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade />
      {/* IDENTITY, NOT THE PICTURE (Section 4: "the crest can appear, but photography must dominate").
          One small badge, corner-placed -- the same club-is-the-crest rule Club Home has always kept,
          never a second copy of the header's own switcher content. */}
      <View style={{ position: "absolute", top: space.lg, left: space.lg }}>
        <ClubCrest clubName={clubName} url={crestUrl} size={40} />
      </View>
      <View style={{ flex: 1, padding: space.lg, justifyContent: "flex-end", gap: 6 }}>
        <Text style={[type.overline, { color: "rgba(255,255,255,0.82)" }]}>{timeOfDayGreeting().toUpperCase()}</Text>
        <Text accessibilityRole="header" numberOfLines={2} style={{ fontFamily: type.title.fontFamily, fontSize: 28, lineHeight: 32, color: "#fff" }}>
          {clubName}
        </Text>
        <Text style={[type.small, { color: "rgba(255,255,255,0.82)" }]}>
          Manage your club, teams, fixtures and community all in one place.
        </Text>
        {teams !== null && (
          <Text style={[type.caption, { color: "rgba(255,255,255,0.68)", marginTop: 2 }]}>
            {`${teams} ${teams === 1 ? "side" : "sides"}${upcoming !== null ? ` · ${upcoming} ${upcoming === 1 ? "fixture" : "fixtures"} in the next fortnight` : ""}`}
          </Text>
        )}
      </View>
    </View>
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

/**
 * THE FOUR TILES, NOW PHOTOGRAPHS (owner correction: "basically dark-green utility boxes" was the
 * named defect). Fixed set, fixed order, fixed destinations, unchanged from the prior pass -- never a
 * fifth tile and never Fixture Control Centre here, which stays desk work reached from the Admin
 * Console. Each image is a reviewed, bundled photograph (no crest, no brand, no legible text, no face
 * to camera): three already existed in the app's own editorial/hub library, one is newly sourced from
 * the same Higgsfield batch that library came from.
 */
function PhotoTile({ label, caption, icon, image, onPress }: { label: string; caption: string; icon: React.ReactNode; image: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: "48%", minHeight: 132, borderRadius: radius.lg, overflow: "hidden", backgroundColor: surface.forest, opacity: pressed ? 0.9 : 1 })}
    >
      <Image source={image} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <PhotoBottomShade strength={0.78} />
      <View style={{ flex: 1, padding: space.md, justifyContent: "space-between" }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,28,20,0.45)" }}>{icon}</View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.xs }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[type.smallMedium, { color: "#fff" }]}>{label}</Text>
            <Text numberOfLines={1} style={[type.caption, { color: "rgba(255,255,255,0.8)" }]}>{caption}</Text>
          </View>
          <ChevronRight size={15} color="rgba(255,255,255,0.85)" />
        </View>
      </View>
    </Pressable>
  )
}

/**
 * A TEAM'S CARD, NOW A PHOTOGRAPH (owner correction: "repeated club crests on dark-green blocks" was
 * the named defect). The crest is gone from this card entirely -- it was never the team's own identity,
 * only the club's, repeated once per team regardless of which side it was. The photograph is the
 * team's own real cover where the club has set one (`resolveTeamCover`, unchanged), or the deterministic
 * category-appropriate stand-in (`demoTeamCoverAsset`) -- never invented, never a second data source.
 * Counts are real and authorised, exactly as before; only the tile's picture has changed.
 */
function TeamPhotoCard({ row, today, onPress }: { row: ClubTeamSummary; today: string; onPress: () => void }) {
  const image = demoTeamCoverAsset(row.team)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.team.displayName}. ${row.players} players, ${row.staff} staff. ${row.nextFixture ? `Next: ${relativeDate(row.nextFixture.date, today)} v ${row.nextFixture.them?.clubName ?? "TBC"}` : "No fixture scheduled"}`}
      onPress={onPress}
      style={({ pressed }) => ({ width: 168, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden", opacity: pressed ? 0.85 : 1 })}
    >
      <Image source={image} accessible={false} contentFit="cover" style={{ width: "100%", height: 104 }} />
      <View style={{ padding: space.sm, gap: 2 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{row.team.displayName}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{`${row.players} players · ${row.staff} staff`}</Text>
      </View>
    </Pressable>
  )
}

type FeedCard = { kind: "notice"; notice: ClubNotice } | { kind: "article"; article: ClubNewsCard }

/**
 * ONE MERGED RAIL (owner correction: two stacked sections -- a single Announcement card, then a News
 * rail -- read as leftover admin furniture). `ClubNotice` carries no publish timestamp in this
 * projection (only `expiresAt`) and no picture of its own at all, so a true chronological interleave
 * isn't a fact this read model can answer without inventing one; announcements lead the rail instead,
 * since a notice is by construction the more time-sensitive of the two, followed by news in the
 * server's own order. Every card is the same photographic shape: a notice always carries the app's own
 * community photograph (it has no `heroUrl`/category to match against), and an article uses its own
 * hero image where it has one, else the SAME category-matched editorial fallback `NewsCard` already
 * uses elsewhere -- not a new fallback invented for this rail.
 */
function LatestNewsAndAnnouncements({
  notices,
  news,
  onOpenNotice,
  onOpenArticle,
  onViewAll,
}: {
  notices: ClubNotice[]
  news: ClubNewsCard[]
  onOpenNotice: (notice: ClubNotice) => void
  onOpenArticle: (article: ClubNewsCard) => void
  onViewAll: () => void
}) {
  const cards: FeedCard[] = [...notices.map((notice): FeedCard => ({ kind: "notice", notice })), ...news.map((article): FeedCard => ({ kind: "article", article }))]
  if (cards.length === 0) return null

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <SectionRow title="Latest News & Announcements" actionLabel="View all" onAction={onViewAll} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}>
        {cards.map((card) =>
          card.kind === "notice" ? (
            <FeedNoticeCard key={`notice-${card.notice.id}`} notice={card.notice} onPress={() => onOpenNotice(card.notice)} />
          ) : (
            <FeedArticleCard key={`article-${card.article.id}`} article={card.article} onPress={() => onOpenArticle(card.article)} />
          )
        )}
      </ScrollView>
    </View>
  )
}

const feedCard = {
  width: 200,
  borderRadius: radius.lg,
  backgroundColor: colour.surface,
  borderWidth: 1,
  borderColor: colour.line,
  overflow: "hidden",
} as const

function FeedNoticeCard({ notice, onPress }: { notice: ClubNotice; onPress: () => void }) {
  const fallback = require("../../assets/editorial/rugby-community.jpg")
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${notice.priorityLabel} announcement. ${notice.title}`} onPress={onPress} style={({ pressed }) => [feedCard, { opacity: pressed ? 0.94 : 1 }]}>
      <View style={{ height: 100, backgroundColor: colour.forest900 }}>
        <Image source={fallback} accessible={false} contentFit="cover" style={{ width: "100%", height: 100 }} />
      </View>
      <View style={{ padding: space.md, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Megaphone size={12} color={notice.priority === "URGENT" ? colour.danger : colour.forest800} strokeWidth={2} />
          <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.5 }]} numberOfLines={1}>
            {`ANNOUNCEMENT${notice.teamName ? ` · ${notice.teamName.toUpperCase()}` : ""}`}
          </Text>
        </View>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>
          {notice.title}
        </Text>
      </View>
    </Pressable>
  )
}

function FeedArticleCard({ article, onPress }: { article: ClubNewsCard; onPress: () => void }) {
  const fallback = fallbackFor(article.categoryLabel)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${article.categoryLabel}. ${article.title}`} onPress={onPress} style={({ pressed }) => [feedCard, { opacity: pressed ? 0.94 : 1 }]}>
      <View style={{ height: 100, backgroundColor: colour.forest900 }}>
        <Image source={article.heroUrl ? { uri: article.heroUrl } : fallback} accessible={false} contentFit="cover" style={{ width: "100%", height: 100 }} transition={140} />
      </View>
      <View style={{ padding: space.md, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.forest800 }} />
          <Text style={[type.caption, { color: colour.inkMuted, letterSpacing: 0.5 }]} numberOfLines={1}>
            {article.categoryLabel.toUpperCase()}
          </Text>
        </View>
        <Text style={[type.smallMedium, { color: colour.ink, fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>
          {article.title}
        </Text>
      </View>
    </Pressable>
  )
}
