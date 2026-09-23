import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../src/auth/supabase"
import { groupRecipients, loadRecipients, openConversationWith, type Recipient } from "../../../src/messages/recipients"
import { friendly, logDetail } from "../../../src/errors/translate"
import { PersonAvatar } from "../../../src/components/identity"
import { ChevronRight, Users } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * WHO DO YOU WANT TO MESSAGE.
 *
 * NOT AN ADDRESS BOOK. The list is `my_direct_message_candidates()`, a per-caller function that has
 * already applied `internal.may_direct_message` -- so it contains the people this person may actually
 * message, grouped by the relationship that makes it legitimate: their team, their club, a club a
 * recent fixture put them in touch with. The app adds no filter of its own; doing so would be a second
 * opinion about safeguarding held on a phone.
 *
 * AN ABSENCE IS NEVER EXPLAINED. Somebody blocked and somebody who is a minor are both simply not
 * here, because saying which would disclose exactly what the rule protects. That is also why an empty
 * list says "nobody yet" rather than offering a reason.
 *
 * SEARCH IS OVER THE LEGITIMATE SET, never a lookup. Typing a name that is not in the list finds
 * nothing, however real that person is.
 */
export default function NewMessage() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [search, setSearch] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setRecipients(await loadRecipients(supabase))
    } catch (caught) {
      const failure = friendly(caught, "who you can message")
      logDetail("recipients", failure)
      setProblem(failure.message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => groupRecipients(recipients ?? [], search), [recipients, search])

  async function open(recipient: Recipient) {
    if (opening) return
    setOpening(recipient.userId)
    setProblem(null)
    const result = await openConversationWith(supabase, recipient.userId)
    setOpening(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    // `replace`, not `push`: having chosen somebody, going back should return to the inbox rather
    // than to the picker they have finished with.
    router.replace({ pathname: "/messages/[kind]/[id]", params: { kind: "direct", id: result.conversationId } })
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Messages"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          New Message
        </Text>
      </View>

      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <TextInput
          accessibilityLabel="Search the people you can message, by name, team or club"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or club"
          placeholderTextColor={colour.inkSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={colour.pitch600}
          style={[
            type.body,
            {
              minHeight: TOUCH_TARGET,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              backgroundColor: colour.surface,
              color: colour.ink,
            },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} onRetry={load} />}

        {!problem && recipients === null && (
          <>
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </>
        )}

        {recipients?.length === 0 && (
          <EmptyState
            title="Nobody to message yet"
            body="People you can message appear here once you share a club, a team, or a recent fixture with them."
            icon={<Users size={22} color={colour.inkSubtle} />}
          />
        )}

        {recipients !== null && recipients.length > 0 && groups.length === 0 && (
          <EmptyState title="No matches" body={`Nobody you can message matches “${search.trim()}”.`} />
        )}

        {groups.map((group) => (
          <View key={group.label}>
            <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>
              {group.label.toUpperCase()}
            </Text>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {group.people.map((person, index) => (
                <Pressable
                  key={person.userId}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${person.name}${secondLine(person) ? `, ${secondLine(person)}` : ""}`}
                  accessibilityState={{ busy: opening === person.userId }}
                  disabled={Boolean(opening)}
                  onPress={() => void open(person)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET + 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingVertical: space.sm + 2,
                    paddingHorizontal: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
                    opacity: opening && opening !== person.userId ? 0.5 : 1,
                  })}
                >
                  <PersonAvatar name={person.name} url={null} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                      {person.name}
                    </Text>
                    {/* WHO THEY ARE, AND WHOSE. "Under 12 Boys" on its own did
                        not say whose Under 12 Boys -- and a fixture contact is by
                        definition from the other side, so a season against three
                        different Under 12 sides produced three identical rows.
                        Two lines rather than one joined string: the club is the
                        thing being scanned for in a long list, and it deserves
                        to start at the left margin rather than arrive after a
                        separator. */}
                    {!!person.detail && (
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                        {person.detail}
                      </Text>
                    )}
                    {!!person.club && person.club !== person.detail && (
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, marginTop: 1 }]}>
                        {person.club}
                      </Text>
                    )}
                  </View>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

/**
 * The row read as one sentence, for VoiceOver.
 *
 * The club is included and the duplicate is not: a "Your club" row's detail IS
 * the club, and hearing it twice is worse than hearing it once.
 */
function secondLine(person: { detail: string | null; club: string | null }): string {
  return [person.detail, person.club !== person.detail ? person.club : null].filter(Boolean).join(", ")
}
