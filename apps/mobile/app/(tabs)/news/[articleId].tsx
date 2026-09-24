import { useCallback, useState } from "react"
import { clubLogoUrlFromPath } from "@ovalball/contracts"
import { Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { readPublishedArticle, readPublishedArticleBySlug, type Article } from "@ovalball/contracts/club/content"

import { supabase } from "../../../src/auth/supabase"
import { Button, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { ArticleBody } from "../../../src/content/article-body"
import { HeroImage } from "../../../src/content/cards"
import { longDate } from "../../../src/content/links"
import { ReadingScreen } from "../../../src/content/reading-screen"
import { useAppContexts } from "../../../src/context/contexts"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { colour, space, type } from "../../../src/design/tokens"

/**
 * ONE STORY, natively. Read by id -- or, for a link the website issued, by the club's slug and the
 * article's slug (`/news/slug?clubSlug=…&articleSlug=…`). Either way the read is the shared contract's
 * and the answer is the database's: a draft, an archived story or one this person may not read comes
 * back as nothing and the screen says so. Never a WebView.
 */
export default function ArticleScreen() {
  const router = useRouter()
  const { articleId, clubSlug, articleSlug } = useLocalSearchParams<{ articleId: string; clubSlug?: string; articleSlug?: string }>()
  const { club } = useAppContexts()
  const [article, setArticle] = useState<Article | null | undefined>(undefined)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const clubName = club.name ?? "Club"
      const found =
        articleId === "slug" && clubSlug && articleSlug
          ? await readPublishedArticleBySlug(supabase, clubSlug, articleSlug, clubName)
          : await readPublishedArticle(supabase, articleId, clubName)
      setArticle(found)
    } catch (cause) {
      const translated = friendly(cause, "this story")
      logDetail("news:article", translated)
      setError(translated)
      setArticle(null)
    }
  }, [articleId, clubSlug, articleSlug, club.name])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const updated = article && article.updatedAt && new Date(article.updatedAt).getTime() - new Date(article.publishedAt).getTime() > 60_000

  return (
    <ReadingScreen section="News" clubName={article?.clubName ?? null} clubCrestUrl={clubLogoUrlFromPath(supabase, article?.clubCrestPath ?? null)} contentStyle={{ paddingTop: 0 }}>
      {article === undefined && !error && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>
          <CardSkeleton lines={4} />
        </View>
      )}
      {error && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>
          <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />
        </View>
      )}
      {article === null && !error && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.md }}>
          <EmptyState title="This story is no longer available." body="It may have been taken down, or it is not published to you." />
          <Button label="Back" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/news" as never))} />
        </View>
      )}
      {article && (
        <>
          <HeroImage item={article} radiusTop={false} />
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
              <Text style={[type.overline, { color: colour.forest800 }]}>{article.categoryLabel.toUpperCase()}</Text>
              {article.membersOnly && <StatusPill label="Members only" tone="neutral" />}
            </View>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {article.title}
            </Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              {article.byline} · {longDate(article.publishedAt)} · {article.readingMinutes} min read
            </Text>
            {updated && <Text style={[type.caption, { color: colour.inkSubtle }]}>Updated {longDate(article.updatedAt)}</Text>}
            {!!article.excerpt && !article.body.trim().startsWith(article.excerpt) && (
              <Text style={[type.body, { color: colour.inkMuted, fontFamily: "Inter_500Medium" }]}>{article.excerpt}</Text>
            )}
            <ArticleBody body={article.body} />
          </View>
        </>
      )}
    </ReadingScreen>
  )
}
