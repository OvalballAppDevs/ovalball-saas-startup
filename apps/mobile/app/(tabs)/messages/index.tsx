import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { listTime, unreadLabel, type MessengerRow } from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { loadInbox, routeForRow } from "../../../src/messages/inbox"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { ClubCrest } from "../../../src/components/identity"
import { ChevronRight, MessageSquare, Plus } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * THE INBOX.
 *
 * EVERY ROW CAME FROM THE SERVER'S OWN ANSWER. `loadInbox` runs the website's `getMessengerRows`,
 * which reads each kind through an RPC or an RLS-protected query already scoped to the caller. This
 * screen renders what it is given; it holds no membership rule, and could not surface a conversation
 * the viewer is not in even if it had the id.
 *
 * ONE PRODUCT RULE TRAVELS WITH IT: a parent or player context does not see club-to-club fixture
 * negotiation, which is the web's decision, applied by the web's own predicate.
 *
 * ROWS THIS BUILD CANNOT OPEN ARE STILL SHOWN. Support threads and announcements are real
 * conversations with real unread state; hiding them would make the badge disagree with the list and
 * would tell somebody they have nothing waiting when they do. They are listed, marked, and not
 * tappable -- honest about both halves.
 */
export default function Inbox() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { sessionContext, active, refreshUnread } = useAppContexts()
  const [rows, setRows] = useState<MessengerRow[] | null>(null)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    if (!sessionContext || !session?.user) return
    setProblem(null)
    try {
      setRows(await loadInbox(supabase, sessionContext, session.user.id, active))
    } catch (caught) {
      const failure = friendly(caught, "your messages")
      logDetail("inbox", failure)
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [sessionContext, session, active])

  useEffect(() => {
    // Cleared first: the previous context's inbox must not sit on screen under the new context.
    setRows(null)
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    await refreshUnread()
    setRefreshing(false)
  }, [load, refreshUnread])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      {/* NEW MESSAGE IS A DESTINATION, not a floating button over the list: a FAB on a conversation
          list covers the newest row, which is the one people came for. */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          accessibilityHint="Choose somebody you can message"
          onPress={() => router.push("/messages/new")}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: colour.lineStrong,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Plus size={17} color={colour.forest800} />
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>New Message</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />}

        {!problem && rows === null && (
          <>
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </>
        )}

        {!problem && rows?.length === 0 && (
          <EmptyState
            title="No conversations yet"
            body="Messages from your club, your team and other clubs arrive here."
            icon={<MessageSquare size={22} color={colour.inkSubtle} />}
          />
        )}

        {rows?.map((row) => {
          const route = routeForRow(row)
          return (
            <ConversationRow
              key={row.key}
              row={row}
              onPress={
                route
                  ? () => router.push({ pathname: route.pathname as never, params: route.params as never })
                  : undefined
              }
            />
          )
        })}
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

function ConversationRow({ row, onPress }: { row: MessengerRow; onPress?: () => void }) {
  const unread = row.unreadCount > 0
  const spoken = [
    row.title,
    row.context,
    row.preview,
    unread ? unreadLabel(row.unreadCount) : null,
    onPress ? null : "not available in the app yet",
  ]
    .filter(Boolean)
    .join(". ")

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={spoken}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 26,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: colour.surface,
        borderWidth: 1,
        borderColor: unread ? colour.pitch600 : colour.line,
        opacity: pressed ? 0.9 : onPress ? 1 : 0.72,
      })}
    >
      <ClubCrest clubName={row.title} url={row.logoUrl} size={42} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text
            numberOfLines={1}
            style={[unread ? type.bodyMedium : type.body, { color: colour.ink, flex: 1, fontSize: 15 }]}
          >
            {row.title}
          </Text>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>{listTime(row.activityAt)}</Text>
        </View>

        {!!row.context && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {row.context}
          </Text>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 3 }}>
          <Text numberOfLines={1} style={[type.caption, { color: unread ? colour.ink : colour.inkMuted, flex: 1 }]}>
            {row.preview ?? "No messages yet"}
          </Text>
          {/* A count, not a dot: "3" is a different decision from "1", and the spoken label says so too. */}
          {unread && (
            <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colour.pitch600, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colour.onForest, fontSize: 10, lineHeight: 12, fontFamily: type.smallMedium.fontFamily }}>
                {row.unreadCount > 9 ? "9+" : row.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>

      {onPress ? (
        <ChevronRight size={17} color={colour.inkSubtle} />
      ) : (
        <Text style={[type.caption, { color: colour.inkSubtle, maxWidth: 58, textAlign: "right" }]}>On the web</Text>
      )}
    </Pressable>
  )
}
