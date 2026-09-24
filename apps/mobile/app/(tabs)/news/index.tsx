import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { clubAccentsOnDark, loadClubKitTheme, resolveClubTheme } from "@ovalball/contracts"
import { listLiveAnnouncements, listPublishedArticles, readFeed, readingScopeFor, readPublishingScopes, type AnnouncementCard, type ArticleCard } from "@ovalball/contracts/club/content"

import { supabase } from "../../../src/auth/supabase"
import { Card, CardSkeleton, EmptyState, ErrorState, Button } from "../../../src/components/ui"
import { AnnouncementRow, NewsCard } from "../../../src/content/cards"
import { ReadingScreen } from "../../../src/content/reading-screen"
import { useAppContexts } from "../../../src/context/contexts"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { colour, radius, space, type } from "../../../src/design/tokens"

/**
 * NEWS & ANNOUNCEMENTS -- everything the club has published, natively (CA-M5).
 *
 * ONE DOMAIN, READ THROUGH THE SHARED CONTRACT. Announcements are the club's live notices (published,
 * started, not yet expired); news is its published stories. Both are the same rows the website reads,
 * and WHO may read a row is the database's decision alone: a members-only notice reaches a member
 * because row-level security says so, and nothing here could widen that. Drafts never appear here.
 *
 * THE SCOPE IS THE CONTEXT'S CLUB. In a team context the list is that team's own items plus the
 * club-wide ones -- presentation, never authority: the rows were already this person's to read.
 * Paged on the server, twenty at a time; pull-to-refresh keeps what is loaded on screen.
 */
type Tab = "all" | "announcements" | "news"
const PAGE = 20
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "announcements", label: "Announcements" },
  { key: "news", label: "News" },
]
const FOREST_GROUND = "#071c14"

export default function NewsIndex() {
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { active, club, sessionContext, loading: contextsLoading } = useAppContexts()
  // WHERE TO ASK is the context's rule; WHAT MAY BE SEEN is the server's, row by row.
  const scope = useMemo(() => readingScopeFor(active, sessionContext), [active, sessionContext])
  const clubs = scope.clubs
  const clubsKey = clubs.map((c) => c.id).join(",")
  const teamId = scope.teamId
  const hasClubs = clubs.length > 0
  const [tab, setTab] = useState<Tab>(params.tab === "announcements" || params.tab === "news" ? params.tab : "all")
  const [announcements, setAnnouncements] = useState<AnnouncementCard[] | null>(null)
  const [moreAnnouncements, setMoreAnnouncements] = useState(false)
  const [news, setNews] = useState<ArticleCard[] | null>(null)
  const [moreNews, setMoreNews] = useState(false)
  const [accent, setAccent] = useState<string>(colour.rugby700)
  const [mayWrite, setMayWrite] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState<Tab | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (params.tab === "announcements" || params.tab === "news") setTab(params.tab)
  }, [params.tab])

  const load = useCallback(async () => {
    if (clubs.length === 0) return
    const gen = ++generation.current
    setError(null)
    try {
      const single = clubs.length === 1 ? clubs[0] : null
      const [feed, scopes, kit] = await Promise.all([
        readFeed(supabase, scope, { announcements: PAGE, news: PAGE }),
        single ? readPublishingScopes(supabase, single.id).catch(() => []) : Promise.resolve([]),
        single ? loadClubKitTheme(supabase, single.id).catch(() => null) : Promise.resolve(null),
      ])
      if (gen !== generation.current) return
      setAnnouncements(feed.announcements)
      setMoreAnnouncements(feed.moreAnnouncements)
      setNews(feed.news)
      setMoreNews(feed.moreNews)
      // READ AUTHORITY IS NOT PUBLISH AUTHORITY: Write appears only where the server names a publishing scope.
      setMayWrite(scopes.length > 0)
      setAccent(clubAccentsOnDark(resolveClubTheme(kit), FOREST_GROUND).highlightOnLight)
    } catch (cause) {
      const translated = friendly(cause, "the club's news")
      logDetail("news:index", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setRefreshing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubsKey, scope.teamId])

  useEffect(() => {
    // Cleared FIRST: the previous context's club must never show under this one.
    setAnnouncements(null)
    setNews(null)
    setMayWrite(false)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function showMore(which: "announcements" | "news") {
    if (clubs.length !== 1) return
    const clubId = clubs[0].id
    const teamId = scope.teamId
    setLoadingMore(which)
    try {
      if (which === "announcements") {
        const page = await listLiveAnnouncements(supabase, clubId, { teamId, limit: PAGE, offset: announcements?.length ?? 0 })
        setAnnouncements([...(announcements ?? []), ...page.items])
        setMoreAnnouncements(page.more)
      } else {
        const page = await listPublishedArticles(supabase, clubId, clubs[0].name, { teamId, limit: PAGE, offset: news?.length ?? 0 })
        setNews([...(news ?? []), ...page.items])
        setMoreNews(page.more)
      }
    } catch (cause) {
      setError(friendly(cause, "more of the club's news"))
    } finally {
      setLoadingMore(null)
    }
  }

  // Contexts resolve asynchronously; until they have, the screen waits rather than telling a parent to choose a club.
  const loading = contextsLoading || (clubs.length > 0 && announcements === null && news === null && !error)
  const showAnnouncements = tab !== "news"
  const showNews = tab !== "announcements"

  return (
    <ReadingScreen section="News & Announcements" clubName={clubs.length === 1 ? clubs[0].name : clubs.length > 1 ? "Family" : null} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load() }} contentStyle={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.md }}>
          <Text accessibilityRole="header" style={[type.display, { color: colour.ink, flex: 1 }]}>
            News & Announcements
          </Text>
          {mayWrite && <Button label="Write" variant="secondary" onPress={() => router.push("/admin/news" as never)} />}
        </View>
        <Text style={[type.body, { color: colour.inkMuted }]}>
          {teamId ? `${active?.label ?? "This team"}'s own notices and stories, and the club's.` : "What the club has published, for its members and the community."}
        </Text>
      </View>

      {!contextsLoading && clubs.length === 0 && <EmptyState title="Choose a club context" body="News and announcements belong to a club. Switch to a club or team context from the header to read them." />}

      {hasClubs && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Show" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {TABS.map((t) => {
            const on = tab === t.key
            return (
              <Pressable key={t.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t.label} onPress={() => setTab(t.key)} style={{ minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}>
                <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
      )}

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {hasClubs && showAnnouncements && announcements && (
        <View style={{ gap: space.sm }}>
          {tab === "all" && (
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              Announcements
            </Text>
          )}
          {announcements.length === 0 ? (
            <EmptyState title="No announcements right now." body="When the club posts a notice, it appears here." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {announcements.map((a, i) => (
                <AnnouncementRow showClub={clubs.length > 1} key={a.id} item={a} accent={accent} first={i === 0} onPress={() => router.push({ pathname: "/announcements/[announcementId]", params: { announcementId: a.id } } as never)} />
              ))}
            </Card>
          )}
          {moreAnnouncements && <Button label={loadingMore === "announcements" ? "Loading…" : "Show More"} variant="secondary" busy={loadingMore === "announcements"} onPress={() => void showMore("announcements")} />}
        </View>
      )}

      {hasClubs && showNews && news && (
        <View style={{ gap: space.md }}>
          {tab === "all" && (
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
              News
            </Text>
          )}
          {news.length === 0 ? (
            <EmptyState title="No news yet." body="Stories the club publishes appear here." />
          ) : (
            news.map((n) => <NewsCard key={n.id} item={n} accent={accent} onPress={() => router.push({ pathname: "/news/[articleId]", params: { articleId: n.id } } as never)} />)
          )}
          {moreNews && <Button label={loadingMore === "news" ? "Loading…" : "Show More"} variant="secondary" busy={loadingMore === "news"} onPress={() => void showMore("news")} />}
        </View>
      )}
    </ReadingScreen>
  )
}
