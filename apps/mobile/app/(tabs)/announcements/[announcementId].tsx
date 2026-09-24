import { useCallback, useState } from "react"
import { clubLogoUrlFromPath } from "@ovalball/contracts"
import { Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { readLiveAnnouncement, type AnnouncementCard } from "@ovalball/contracts/club/content"

import { supabase } from "../../../src/auth/supabase"
import { Megaphone } from "../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../src/components/ui"
import { dateTime, openContentLink } from "../../../src/content/links"
import { ReadingScreen } from "../../../src/content/reading-screen"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { colour, space, type } from "../../../src/design/tokens"

/**
 * ONE ANNOUNCEMENT, natively. A notice is short, dated and operational: the priority in words, who it
 * is for, the text with its line breaks kept, the window it is live for, and its one optional link --
 * opened deliberately, in Ovalball where the app has the screen and in the browser otherwise. A notice
 * that has expired, been archived or is not this person's to read comes back as nothing.
 */
export default function AnnouncementScreen() {
  const router = useRouter()
  const { announcementId } = useLocalSearchParams<{ announcementId: string }>()
  const [item, setItem] = useState<AnnouncementCard | null | undefined>(undefined)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItem(await readLiveAnnouncement(supabase, announcementId))
    } catch (cause) {
      const translated = friendly(cause, "this announcement")
      logDetail("news:announcement", translated)
      setError(translated)
      setItem(null)
    }
  }, [announcementId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const rule = item?.priority === "URGENT" ? colour.danger : colour.forest800

  return (
    <ReadingScreen section="Announcement" clubName={item?.clubName ?? null} clubCrestUrl={clubLogoUrlFromPath(supabase, item?.clubCrestPath ?? null)} contentStyle={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>
      {item === undefined && !error && <CardSkeleton lines={4} />}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {item === null && !error && (
        <View style={{ gap: space.md }}>
          <EmptyState title="This announcement is no longer available." body="It may have ended, or it is not published to you." />
          <Button label="Back" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/news" as never))} />
        </View>
      )}
      {item && (
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
              <Megaphone size={15} color={rule} strokeWidth={2} />
              <Text style={[type.overline, { color: rule }]}>
                {item.priorityLabel.toUpperCase()} · {(item.teamName ?? "Whole club").toUpperCase()}
              </Text>
              {item.membersOnly && <StatusPill label="Members only" tone="neutral" />}
            </View>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {item.title}
            </Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>
              Posted {dateTime(item.startsAt)}
              {item.expiresAt ? ` · until ${dateTime(item.expiresAt)}` : ""}
            </Text>
          </View>
          {!!item.body && (
            <Card>
              <Text style={[type.body, { color: colour.ink, fontSize: 17, lineHeight: 27 }]}>{item.body}</Text>
            </Card>
          )}
          {item.link && (
            <Button
              label={item.link.label}
              variant="secondary"
              accessibilityHint={item.link.external ? "Opens in your browser" : "Opens in Ovalball"}
              onPress={() => openContentLink(router, item.link!.href, item.link!.external)}
            />
          )}
        </View>
      )}
    </ReadingScreen>
  )
}
