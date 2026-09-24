import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { listManagedContent, readPublishingScopes, type ManagedAnnouncementRow, type ManagedArticleRow, type PublishingScope } from "@ovalball/contracts/club/content"
import { CONTENT_STATUS_LABEL, priorityLabel } from "@ovalball/contracts/club/vocabulary"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAppContexts } from "../../../../src/context/contexts"
import { announcementWindowLabel, Chip, statusTone } from "../../../../src/admin/content/pieces"
import { supabase } from "../../../../src/auth/supabase"
import { ChevronRight, FileText, Megaphone } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { formatDate } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, space, type } from "../../../../src/design/tokens"

/**
 * NEWS & ANNOUNCEMENTS -- what the club has written, in every state, for the people who may write it
 * (CA-M5).
 *
 * WHO MAY WRITE is the server's answer: `club_publishing_scopes` returns the club and each team this
 * person may publish to, decided by the same rule the writes apply. Somebody with no scope sees a calm
 * closed door, not a broken list. WHAT THEY SEE is row-level security's: drafts and archive are only
 * returned to an editor of that scope. The filter over status is presentation over rows already theirs.
 *
 * Nothing here publishes; each row opens its editor, where every change is explicit and re-authorised.
 */
type Filter = "ALL" | "DRAFT" | "PUBLISHED" | "ARCHIVED"
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Drafts" },
  { key: "PUBLISHED", label: "Published" },
  { key: "ARCHIVED", label: "Archived" },
]

export default function ManagedNewsScreen() {
  const router = useRouter()
  // The club of whichever context the person stands in -- a Coach publishes from their team context. The
  // scopes read (the server) decides what they may publish; the context only says which club to ask about.
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? null
  const [scopes, setScopes] = useState<PublishingScope[] | null>(null)
  const [articles, setArticles] = useState<ManagedArticleRow[]>([])
  const [announcements, setAnnouncements] = useState<ManagedAnnouncementRow[]>([])
  const [filter, setFilter] = useState<Filter>("ALL")
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!clubId) {
      setScopes([])
      return
    }
    setError(null)
    try {
      const mine = await readPublishingScopes(supabase, clubId)
      setScopes(mine)
      if (mine.length === 0) {
        setArticles([])
        setAnnouncements([])
        return
      }
      const clubWide = mine.some((s) => s.kind === "club")
      if (clubWide) {
        const all = await listManagedContent(supabase, { clubId, teamId: null })
        setArticles(all.articles)
        setAnnouncements(all.announcements)
      } else {
        // Team scopes only: each team's own items. RLS already bounds the rows; this just asks per scope.
        const pages = await Promise.all(mine.filter((s) => s.kind === "team" && s.teamId).map((s) => listManagedContent(supabase, { clubId, teamId: s.teamId })))
        setArticles(pages.flatMap((p) => p.articles).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        setAnnouncements(pages.flatMap((p) => p.announcements).sort((a, b) => b.startsAt.localeCompare(a.startsAt)))
      }
    } catch (cause) {
      const translated = friendly(cause, "the club's news")
      logDetail("admin:news", translated)
      setError(translated)
      setScopes((s) => s ?? [])
    }
  }, [clubId])

  useEffect(() => {
    // Cleared FIRST: the previous club's rows must never decide this club's screen.
    setScopes(null)
    setArticles([])
    setAnnouncements([])
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const loading = scopes === null
  const mayWrite = (scopes?.length ?? 0) > 0
  const shownArticles = articles.filter((a) => filter === "ALL" || a.status === filter)
  const shownAnnouncements = announcements.filter((a) => filter === "ALL" || a.status === filter)

  return (
    <AdminScreen
      section="News & Announcements"
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true)
        void load().finally(() => setRefreshing(false))
      }}
    >
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          News & Announcements
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>What the club publishes. An announcement is a short, dated notice; news is a story on the club's page.</Text>
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {!loading && !error && !clubId && <EmptyState title="Choose a club context" body="News is written for the club you are viewing. Switch to a club context from the header." />}
      {!loading && !error && clubId && !mayWrite && <EmptyState title="You cannot publish here" body="Writing news and announcements needs the club's or a team's publishing permission. Ask a Club Admin if you should have it." />}

      {!loading && mayWrite && (
        <>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="New Announcement" onPress={() => router.push("/admin/news/announcement/new" as never)} style={{ flex: 1 }} />
            <Button label="New Article" variant="secondary" onPress={() => router.push("/admin/news/article/new" as never)} style={{ flex: 1 }} />
          </View>

          <View accessibilityRole="radiogroup" accessibilityLabel="Filter by status" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>

          <Section title="Announcements" icon={<Megaphone size={16} color={colour.forest800} strokeWidth={2} />} empty={filter === "ALL" ? "No announcements yet." : "Nothing here with that status."}>
            {shownAnnouncements.map((a, i) => {
              const window = announcementWindowLabel(a.status, a.startsAt, a.expiresAt)
              return (
                <Row
                  key={a.id}
                  first={i === 0}
                  title={a.title}
                  meta={`${a.teamName ?? "Whole Club"} · ${priorityLabel(a.priority)} · from ${formatDate(a.startsAt)}${a.expiresAt ? ` to ${formatDate(a.expiresAt)}` : ""}`}
                  pills={[{ label: CONTENT_STATUS_LABEL[a.status], tone: statusTone(a.status) }, ...(window && window !== "Live" ? [{ label: window, tone: "neutral" as const }] : window ? [{ label: "Live", tone: "positive" as const }] : [])]}
                  onPress={() => router.push(`/admin/news/announcement/${a.id}` as never)}
                />
              )
            })}
          </Section>

          <Section title="News" icon={<FileText size={16} color={colour.forest800} strokeWidth={2} />} empty={filter === "ALL" ? "No news yet." : "Nothing here with that status."}>
            {shownArticles.map((a, i) => (
              <Row
                key={a.id}
                first={i === 0}
                title={a.title}
                meta={`${a.isSystem ? "Ovalball" : (a.teamName ?? "Whole Club")}${a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ` · edited ${formatDate(a.updatedAt)}`}${a.visibility === "MEMBERS" ? " · Members" : ""}`}
                pills={[{ label: CONTENT_STATUS_LABEL[a.status], tone: statusTone(a.status) }, ...(a.featured ? [{ label: "Lead Story", tone: "positive" as const }] : [])]}
                onPress={() => router.push(`/admin/news/article/${a.id}` as never)}
              />
            ))}
          </Section>
        </>
      )}
    </AdminScreen>
  )
}

function Section({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode[] }) {
  const rows = children.filter(Boolean)
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {icon}
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          {title}
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>{empty}</Text>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>{rows}</Card>
      )}
    </View>
  )
}

function Row({ title, meta, pills, first, onPress }: { title: string; meta: string; pills: { label: string; tone: "positive" | "caution" | "neutral" }[]; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${pills.map((p) => p.label).join(", ")}. ${meta}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
          {meta}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {pills.map((p) => (
            <StatusPill key={p.label} label={p.label} tone={p.tone} />
          ))}
        </View>
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

