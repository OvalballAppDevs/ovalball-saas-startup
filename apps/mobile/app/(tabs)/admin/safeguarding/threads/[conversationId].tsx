import { useCallback, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { readSafeguardingThread, safeguardingErrorMessage, sendSafeguardingThreadMessage, type SafeguardingThreadDetail } from "@ovalball/contracts/club/safeguarding"

import { AdminScreen } from "../../../../../src/admin/screen"
import { supabase } from "../../../../../src/auth/supabase"
import { useSession } from "../../../../../src/auth/session"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * ONE SAFEGUARDING CONVERSATION (CA-M11.1): the same small, purpose-built reader the website has, over
 * the same data. `fixture_messages` scoped to the conversation, under the same RLS branch; a reply
 * goes through `send_safeguarding_officer_message`, which decides for itself whether THIS person may
 * write into THIS thread. A review by Ovalball is shown where the officer it was recorded for can see
 * it. Bubbles keep the app's ownership colours: blue for mine, mint for received.
 */
export default function SafeguardingThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const id = typeof conversationId === "string" ? conversationId : null
  const { userId } = useSession()
  const [detail, setDetail] = useState<SafeguardingThreadDetail | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      setDetail(await readSafeguardingThread(supabase, id))
    } catch (cause) {
      const translated = friendly(cause, "this conversation")
      logDetail("admin:safeguarding:thread", translated)
      setError(translated)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function send() {
    if (!id || !body.trim()) return
    setSending(true)
    setProblem(null)
    try {
      await sendSafeguardingThreadMessage(supabase, id, body)
      setBody("")
      await load()
    } catch (cause) {
      setProblem(safeguardingErrorMessage(cause, friendly(cause, "your reply").message))
    } finally {
      setSending(false)
    }
  }

  return (
    <AdminScreen section="Safeguarding Conversation" onRefresh={() => void load()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Conversation
        </Text>
      </View>

      {!id && <EmptyState title="No conversation" body="This link does not name a conversation." />}
      {id && detail === null && !error && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {detail && detail.reviews.length > 0 && (
        <View style={{ gap: space.sm }}>
          {detail.reviews.map((r, i) => (
            <View key={`${r.reviewedAt}-${i}`} style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, gap: 2 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Reviewed by Ovalball on {new Date(r.reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{r.reason}</Text>
            </View>
          ))}
        </View>
      )}

      {detail && detail.messages.length === 0 && !error && <EmptyState title="Nothing here yet" body="Messages in this conversation appear here." />}

      {detail && detail.messages.length > 0 && (
        <View style={{ gap: space.sm }}>
          {detail.messages.map((m) => {
            const mine = !!userId && m.senderUserId === userId
            const time = new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            return (
              <View key={m.id} accessible accessibilityLabel={`${mine ? "You" : "Them"} at ${time}. ${m.body}`} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: mine ? colour.messengerBlue : colour.mint100 }}>
                <Text style={[type.body, { color: mine ? colour.onForest : colour.forest950 }]}>{m.body}</Text>
                <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.75)" : colour.inkMuted, fontSize: 10, marginTop: 2, textAlign: "right" }]}>{time}</Text>
              </View>
            )
          })}
        </View>
      )}

      {detail && (
        <View style={{ gap: space.sm }}>
          <TextInput
            accessibilityLabel="Reply"
            value={body}
            onChangeText={setBody}
            editable={!sending}
            multiline
            textAlignVertical="top"
            placeholder="Reply…"
            placeholderTextColor={colour.inkSubtle}
            style={[type.body, { minHeight: TOUCH_TARGET * 2, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
          />
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {problem}
            </Text>
          )}
          <Button label="Send" onPress={() => void send()} busy={sending} disabled={!body.trim()} style={{ alignSelf: "flex-start" }} />
        </View>
      )}
    </AdminScreen>
  )
}
