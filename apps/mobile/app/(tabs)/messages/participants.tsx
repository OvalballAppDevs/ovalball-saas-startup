import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"


import { supabase } from "../../../src/auth/supabase"
import { useSession } from "../../../src/auth/session"
import { useAppContexts } from "../../../src/context/contexts"
import {
  addParticipant,
  addableMembers,
  blockPerson,
  leaveConversation,
  loadParticipants,
  rejoinConversation,
  removeParticipant,
  setMuted,
  unblockPerson,
  type AddableMember,
  type ConversationKind,
  type ParticipantsView,
} from "../../../src/messages/participants"
import { friendly, logDetail } from "../../../src/errors/translate"
import { PersonAvatar } from "../../../src/components/identity"
import { Bell, Check, ChevronRight, Plus, Users, X } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * WHO IS IN THIS CONVERSATION.
 *
 * A GROUP THREAD WITHOUT A PARTICIPANT LIST is a room with the lights off. A fixture conversation is not
 * "you and the opposition": it is the Club Admins and Fixture Secretaries at both clubs, the coaches and
 * managers on both teams, and anybody deliberately added -- and until you can see that list, you are
 * writing to an audience you are guessing at. In a product where a message might name a child, guessing
 * is the wrong thing to be doing.
 *
 * IT IS A VIEW OF ACCESS, NEVER THE THING THAT GRANTS IT. Everyone here is somebody
 * `internal.can_access_fixture_conversation` already admits. Removing a person removes an explicit
 * grant; it cannot take away a Club Admin's role-derived access, and the RPC says so by refusing.
 *
 * LEAVING IS NOT LOSING ACCESS, and the difference matters enough to show both: a subscription ends, the
 * right to be here does not, so rejoining is a button rather than a request.
 *
 * BLOCKING IS OFFERED HERE because this is the one place a person is genuinely identifiable, and it is a
 * PERSON-level act -- it follows them out of this conversation into every other. Said plainly, because
 * somebody expecting it to mute one thread would be surprised.
 */
export default function Participants() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { sessionContext } = useAppContexts()
  const params = useLocalSearchParams<{ kind?: string; id?: string }>()
  const kind = (["fixture", "request", "club", "direct"].includes(String(params.kind)) ? params.kind : "fixture") as ConversationKind
  const id = String(params.id ?? "")

  const [view, setView] = useState<ParticipantsView | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [candidates, setCandidates] = useState<AddableMember[] | null>(null)
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    if (!session?.user || !sessionContext || !id) return
    setProblem(null)
    try {
      const loaded = await loadParticipants(supabase, sessionContext, kind, id, session.user.id)
      if (!loaded) {
        setMissing(true)
        return
      }
      setView(loaded)
    } catch (caught) {
      const failure = friendly(caught, "who is in this conversation")
      logDetail("participants", failure)
      setProblem(failure.message)
    }
  }, [session, sessionContext, kind, id])

  useEffect(() => {
    void load()
  }, [load])

  async function run(key: string, action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (busy) return
    setBusy(key)
    setProblem(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    await load()
  }

  async function openAdd() {
    // Only reachable where `canAdd` is true, which a direct conversation never is.
    if (kind === "direct") return
    setAdding(true)
    setCandidates(null)
    setCandidates(await addableMembers(supabase, kind, id))
  }

  const matches = (candidates ?? []).filter((c) =>
    search.trim() ? c.name.toLowerCase().includes(search.trim().toLowerCase()) : true
  )

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
          accessibilityLabel="Back to the conversation"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          {adding ? "Add People" : "People"}
        </Text>
        {!adding && view?.canAdd && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add people to this conversation"
            onPress={() => void openAdd()}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Plus size={22} color={colour.forest800} strokeWidth={2.2} />
          </Pressable>
        )}
        {adding && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done adding people"
            onPress={() => setAdding(false)}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <X size={22} color={colour.ink} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      {missing ? (
        <EmptyState
          title="This conversation isn't available"
          body="It may have been removed, or it may not be one you have access to."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {problem && <ErrorState message={problem} onRetry={load} />}
          {!problem && view === null && (
            <>
              <CardSkeleton lines={1} />
              <CardSkeleton lines={1} />
            </>
          )}

          {adding ? (
            <>
              <TextInput
                accessibilityLabel="Search people you can add"
                value={search}
                onChangeText={setSearch}
                placeholder="Search"
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
              {candidates === null && <CardSkeleton lines={1} />}
              {candidates?.length === 0 && (
                <EmptyState
                  title="Nobody to add"
                  body="People at either club who can be added to this conversation appear here. Parents and players are not included."
                  icon={<Users size={22} color={colour.inkSubtle} />}
                />
              )}
              {matches.length > 0 && (
                <Card>
                  {matches.map((person, index) => (
                    <Row key={person.userId} first={index === 0}>
                      <PersonAvatar name={person.name} url={null} size={38} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                          {person.name}
                        </Text>
                        {person.blockedByMe && (
                          <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>You have blocked them</Text>
                        )}
                      </View>
                      <Action
                        label={`Add ${person.name}`}
                        busy={busy === `add:${person.userId}`}
                        onPress={() =>
                          kind !== "direct" &&
                          void run(`add:${person.userId}`, () => addParticipant(supabase, kind, id, person.userId))
                        }
                      >
                        <Plus size={19} color={colour.forest800} strokeWidth={2.2} />
                      </Action>
                    </Row>
                  ))}
                </Card>
              )}
            </>
          ) : (
            view && (
              <>
                <Card>
                  {view.participants.map((person, index) => (
                    <Row key={person.userId} first={index === 0}>
                      <PersonAvatar name={person.name} url={person.avatarUrl} size={38} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                          {person.name}
                          {person.isMe && <Text style={{ color: colour.inkMuted }}> (you)</Text>}
                        </Text>
                        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                          {[person.roleLabel, person.clubName].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      {/* NEVER OFFERED AGAINST YOURSELF. Blocking yourself is not a thing, and a remove
                          control on your own row is what Leave is for. */}
                      {!person.isMe && view.canManage && (
                        <Action
                          label={`Remove ${person.name} from this conversation`}
                          busy={busy === `remove:${person.userId}`}
                          onPress={() =>
                            kind !== "direct" &&
                            void run(`remove:${person.userId}`, () => removeParticipant(supabase, kind, id, person.userId))
                          }
                        >
                          <X size={18} color={colour.inkMuted} strokeWidth={2.2} />
                        </Action>
                      )}
                    </Row>
                  ))}
                </Card>

                {/* A DIRECT CONVERSATION IS TWO PEOPLE AND CANNOT BECOME THREE. Said, rather than left
                    as a missing Add button somebody wonders about -- and it points at the conversations
                    that DO hold a group, which is the useful half of the answer. */}
                {kind === "direct" && (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    A direct message is between the two of you. To include anyone else, use the
                    fixture&apos;s or the team&apos;s conversation instead.
                  </Text>
                )}

                {kind !== "direct" && (
                <View style={{ gap: space.sm }}>
                  <Text style={[type.overline, { color: colour.inkSubtle }]}>THIS CONVERSATION</Text>
                  <Card>
                    <Row first>
                      <Bell size={19} color={colour.forest800} strokeWidth={1.9} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.smallMedium, { color: colour.ink }]}>Notifications</Text>
                        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                          {view.muted ? "Muted — you still receive the messages" : "On"}
                        </Text>
                      </View>
                      <Action
                        label={view.muted ? "Turn notifications on" : "Mute notifications"}
                        busy={busy === "mute"}
                        onPress={() => void run("mute", () => setMuted(supabase, kind, id, !view.muted))}
                      >
                        {view.muted ? <X size={18} color={colour.inkMuted} strokeWidth={2.2} /> : <Check size={18} color={colour.pitch600} strokeWidth={2.4} />}
                      </Action>
                    </Row>
                  </Card>

                  {kind !== "club" && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={view.left ? "Rejoin this conversation" : "Leave this conversation"}
                      accessibilityState={{ busy: busy === "membership" }}
                      disabled={busy !== null}
                      onPress={() =>
                        void run("membership", () =>
                          view.left ? rejoinConversation(supabase, kind, id) : leaveConversation(supabase, kind, id)
                        )
                      }
                      style={({ pressed }) => ({
                        minHeight: TOUCH_TARGET,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: colour.line,
                        backgroundColor: colour.surface,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <Text style={[type.smallMedium, { color: view.left ? colour.forest800 : colour.danger }]}>
                        {view.left ? "Rejoin Conversation" : "Leave Conversation"}
                      </Text>
                    </Pressable>
                  )}
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    Leaving stops the messages reaching you. It does not remove your access, so you can rejoin.
                  </Text>
                </View>
                )}

                {view.participants.some((p) => !p.isMe) && (
                  <View style={{ gap: space.sm }}>
                    <Text style={[type.overline, { color: colour.inkSubtle }]}>BLOCKING</Text>
                    <Card>
                      {view.participants
                        .filter((p) => !p.isMe)
                        .map((person, index) => (
                          <Row key={`block-${person.userId}`} first={index === 0}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                                {person.name}
                              </Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Block ${person.name}`}
                              accessibilityState={{ busy: busy === `block:${person.userId}` }}
                              disabled={busy !== null}
                              onPress={() => void run(`block:${person.userId}`, () => blockPerson(supabase, person.userId))}
                              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: space.sm, opacity: pressed ? 0.7 : 1 })}
                            >
                              <Text style={[type.smallMedium, { color: colour.danger, fontSize: 13 }]}>Block</Text>
                            </Pressable>
                          </Row>
                        ))}
                    </Card>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      Blocking someone stops direct messages between you anywhere in Ovalball, not only here. It does
                      not remove them from this conversation, and they are not told.
                    </Text>
                  </View>
                )}
              </>
            )
          )}
        </ScrollView>
      )}
    </View>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {children}
    </View>
  )
}

function Row({ first, children }: { first?: boolean; children: React.ReactNode }) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
      }}
    >
      {children}
    </View>
  )
}

function Action({
  label,
  busy,
  onPress,
  children,
}: {
  label: string
  busy: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      {busy ? <ActivityIndicator size="small" color={colour.forest800} /> : children}
    </Pressable>
  )
}
