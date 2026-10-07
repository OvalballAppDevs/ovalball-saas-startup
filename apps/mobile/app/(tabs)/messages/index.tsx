import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { type MessengerRow } from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import { loadInbox, loadMutedKeys, routeForRow, unreadTotal } from "../../../src/messages/inbox"
import { useDirectPresence } from "../../../src/messages/presence"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { ConversationRow, matchesFilter, matchesSearch, type InboxFilter } from "../../../src/components/messenger/conversation-row"
import { MessageSquare, Search, SquarePen, X } from "../../../src/components/icons"
import { Skeleton } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, messenger, onForest, radius, space, surface, type } from "../../../src/design/tokens"

/**
 * MESSAGES HOME.
 *
 * A DELIBERATE FOREST BODY. The owner-approved messaging mock-up puts the whole of Messages Home on the
 * deep forest ground, the way a messenger owns its screen: the list is the feature, as the Calendar's
 * feature area is. CLAUDE.md allows a screen with a genuine reason to vary its body; the chrome rules
 * still hold (forest header and bottom bar, light status bar, bright green only for the primary action
 * and the unread accents), and the conversation itself opens onto chalk. Club Documents is not here: it is
 * a Club Admin tool, reached from the Admin Console, and a source to attach from inside a conversation.
 *
 * EVERY ROW CAME FROM THE SERVER'S OWN ANSWER. `loadInbox` runs the website's `getMessengerRows`; this
 * screen holds no membership rule and could not surface a conversation the viewer is not in.
 *
 * SEARCH IS OVER WHAT IS ALREADY HERE. It filters the person's own conversations by name and words; it
 * is never a directory of people. Starting a new conversation goes through New Message, whose list is
 * the server's `my_direct_message_candidates` -- the canonical recipient authority.
 *
 * FILTERS ARE OFFERED ONLY WHERE THERE IS SOMETHING TO FILTER. "Direct", "Groups" and "Announcements"
 * appear when this person has at least one of that kind; there is no Teams chip because team
 * conversations are not part of the inbox the platform returns.
 */
export default function MessagesHome() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { sessionContext, active, refreshUnread, unread: counts } = useAppContexts()
  const [rows, setRows] = useState<MessengerRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<InboxFilter>("all")
  const presence = useDirectPresence()
  const [mutedKeys, setMutedKeys] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!sessionContext || !session?.user) return
    setProblem(null)
    try {
      const [inbox, muted] = await Promise.all([loadInbox(supabase, sessionContext, session.user.id, active), loadMutedKeys(supabase, session.user.id)])
      setRows(inbox)
      setMutedKeys(muted)
    } catch (caught) {
      const failure = friendly(caught, "your messages")
      logDetail("inbox", failure)
      setProblem(failure.message)
    }
  }, [sessionContext, session, active])

  useEffect(() => {
    // Cleared first: the previous context's inbox must not sit on screen under the new context.
    setRows(null)
    void load()
  }, [load])

  // RE-READ ON EVERY RETURN, silently, so the row and the badge answer one question with one answer.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await load()
        await refreshUnread()
        await presence.refresh()
      })()
      // `presence.refresh` is stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, refreshUnread])
  )

  // THE BADGE AND THE LIST ANSWER ONE QUESTION: when the shared messages count moves (a foreground push, the app
  // coming back, a conversation read elsewhere), the list re-reads too rather than waiting to be refocused.
  const messagesCount = counts.messages
  const seenCount = useRef(messagesCount)
  useEffect(() => {
    if (seenCount.current === messagesCount) return
    seenCount.current = messagesCount
    void load()
  }, [messagesCount, load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([load(), refreshUnread(), presence.refresh()])
    setRefreshing(false)
  }, [load, refreshUnread, presence])

  const unread = rows ? unreadTotal(rows) : 0
  const chips = useMemo(() => {
    const has = (f: InboxFilter) => (rows ?? []).some((r) => matchesFilter(r, f))
    const list: { key: InboxFilter; label: string }[] = [{ key: "all", label: "All" }]
    list.push({ key: "unread", label: unread > 0 ? `Unread ${unread > 99 ? "99+" : unread}` : "Unread" })
    if (has("direct")) list.push({ key: "direct", label: "Direct" })
    if (has("groups")) list.push({ key: "groups", label: "Groups" })
    if (has("announcements")) list.push({ key: "announcements", label: "Announcements" })
    return list
  }, [rows, unread])

  const shown = useMemo(() => (rows ?? []).filter((r) => matchesFilter(r, filter) && matchesSearch(r, search)), [rows, filter, search])

  function open(row: MessengerRow) {
    const route = routeForRow(row)
    if (!route) return
    router.push({ pathname: route.pathname as never, params: { ...route.params, unread: String(row.unreadCount) } as never })
  }

  return (
    <View style={{ flex: 1, backgroundColor: surface.forest }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} bottomRule={false} />

      <FlatList
        data={problem || rows === null ? [] : shown}
        keyExtractor={(row) => row.key}
        // THE TITLE, SEARCH AND FILTERS SCROLL WITH THE LIST. Pinned, they took the whole screen at the
        // largest text sizes and left no conversation reachable.
        ListHeaderComponent={
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} style={[type.display, { color: onForest.primary, flex: 1 }]}>
                Messages
              </Text>
              {/* NEW MESSAGE, the one primary action here, where the thumb and the eye both expect it. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New Message"
                accessibilityHint="Choose somebody you can message"
                onPress={() => router.push("/messages/new")}
                style={({ pressed }) => ({
                  width: TOUCH_TARGET,
                  height: TOUCH_TARGET,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? colour.pitch600 : colour.pitch400,
                })}
              >
                <SquarePen size={21} color={colour.forest950} strokeWidth={2.1} />
              </Pressable>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                minHeight: TOUCH_TARGET,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: surface.forestRaised,
                borderWidth: 1,
                borderColor: onForest.line,
              }}
            >
              <Search size={18} color={onForest.secondary} strokeWidth={2} />
              <TextInput
                accessibilityLabel="Search your conversations"
                value={search}
                onChangeText={setSearch}
                placeholder="Search conversations"
                placeholderTextColor={onForest.secondary}
                autoCorrect={false}
                selectionColor={colour.pitch400}
                returnKeyType="search"
                maxFontSizeMultiplier={1.6}
                style={[type.body, { flex: 1, color: onForest.primary, paddingVertical: 10 }]}
              />
              {!!search && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} hitSlop={10}>
                  <X size={17} color={onForest.secondary} strokeWidth={2.2} />
                </Pressable>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
              {chips.map((chip) => {
                const selected = filter === chip.key
                return (
                  <Pressable
                    key={chip.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={chip.key === "unread" && unread > 0 ? `Unread, ${unread}` : chip.label}
                    onPress={() => setFilter(chip.key)}
                    style={({ pressed }) => ({
                      minHeight: 36,
                      justifyContent: "center",
                      paddingHorizontal: 14,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? colour.pitch400 : pressed ? messenger.wellOnForest : surface.forestRaised,
                    })}
                  >
                    <Text maxFontSizeMultiplier={1.5} style={[type.smallMedium, { color: selected ? colour.forest950 : onForest.primary }]}>{chip.label}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (
          <ConversationRow
            row={item}
            tone="forest"
            presence={item.kind === "direct" ? presence.presenceFor(item.key.slice(item.key.indexOf(":") + 1)) : null}
            muted={mutedKeys.has(item.key)}
            onPress={routeForRow(item) ? () => open(item) : undefined}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, marginLeft: space.lg + 48 + space.md, backgroundColor: onForest.line }} />}
        ListEmptyComponent={
          problem ? (
            <ForestNote title="Messages didn't load" body={problem} action={{ label: "Try Again", onPress: () => void load() }} />
          ) : rows === null ? (
            <View style={{ paddingHorizontal: space.lg, gap: space.lg, paddingTop: space.md }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ flexDirection: "row", gap: space.md, alignItems: "center", opacity: 0.18 }}>
                  <Skeleton height={48} width={48} style={{ borderRadius: 24 }} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Skeleton height={14} width="55%" />
                    <Skeleton height={12} width="85%" />
                  </View>
                </View>
              ))}
            </View>
          ) : search.trim() ? (
            <ForestNote title="No matches" body={`None of your conversations mention “${search.trim()}”.`} />
          ) : filter === "unread" ? (
            <ForestNote title="You're all caught up" body="Nothing unread. New messages appear here first." />
          ) : (
            <ForestNote
              title="No conversations yet"
              body="Messages from your club, your team and other clubs arrive here. Start one with the people you can message."
              action={{ label: "New Message", onPress: () => router.push("/messages/new") }}
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={onForest.primary} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

function ForestNote({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.sm }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: surface.forestRaised }}>
        <MessageSquare size={24} color={colour.mint300} strokeWidth={1.8} />
      </View>
      <Text style={[type.heading, { color: onForest.primary, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.small, { color: onForest.secondary, textAlign: "center", maxWidth: 300 }]}>{body}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => ({ marginTop: space.sm, minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: pressed ? colour.pitch600 : colour.pitch400 })}
        >
          <Text style={[type.smallMedium, { color: colour.forest950 }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  )
}
