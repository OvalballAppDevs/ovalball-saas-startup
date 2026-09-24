import { useCallback, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { readSafeguardingThreads, type SafeguardingThread } from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../../src/admin/screen"
import { supabase } from "../../../../../src/auth/supabase"
import { useSession } from "../../../../../src/auth/session"
import { ChevronRight, MessageSquare } from "../../../../../src/components/icons"
import { Card, CardSkeleton, EmptyState, ErrorState } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { useSafeguardingOfficerAccess } from "../../../../../src/safeguarding/access"
import { TOUCH_TARGET, colour, space, type } from "../../../../../src/design/tokens"

/**
 * SAFEGUARDING CONVERSATIONS (CA-M11.1): the threads this person may see -- their own as the person
 * who opened them, or the club's as a confirmed officer. RLS on the conversation table is the boundary;
 * this list shows who opened each one and when it was last active, and never a line of its content.
 */
export default function SafeguardingThreadsScreen() {
  const router = useRouter()
  const { userId } = useSession()
  const { clubId } = useSafeguardingOfficerAccess()
  const [threads, setThreads] = useState<SafeguardingThread[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setError(null)
    try {
      setThreads(await readSafeguardingThreads(supabase, clubId))
    } catch (cause) {
      const translated = friendly(cause, "safeguarding conversations")
      logDetail("admin:safeguarding:threads", translated)
      setError(translated)
      setThreads([])
    }
  }, [clubId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  return (
    <AdminScreen section="Safeguarding Conversations" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Conversations
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Safeguarding conversations are between the person who raised them and the club's confirmed Safeguarding Officers. Nobody else reads them.</Text>
      </View>

      {threads === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {threads && threads.length === 0 && !error && <EmptyState title="No conversations" body="A conversation appears here when somebody messages the Safeguarding Officer." icon={<MessageSquare size={22} color={colour.inkSubtle} />} />}

      {threads && threads.length > 0 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {threads.map((t, i) => {
            const mine = !!userId && t.requesterUserId === userId
            const who = mine ? "Opened by you" : t.requesterName ? `Opened by ${t.requesterName}` : "Opened by a club member"
            const when = new Date(t.lastMessageAt ?? t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            return (
              <Pressable
                key={t.conversationId}
                accessibilityRole="button"
                accessibilityLabel={`${who}, last active ${when}${t.reviewedAt ? ", reviewed by Ovalball" : ""}`}
                onPress={() => router.push(`/admin/safeguarding/threads/${t.conversationId}` as never)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{who}</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                    Last active {when}
                    {t.reviewedAt ? " · Reviewed by Ovalball" : ""}
                  </Text>
                </View>
                <ChevronRight size={17} color={colour.inkSubtle} />
              </Pressable>
            )
          })}
        </Card>
      )}
    </AdminScreen>
  )
}
