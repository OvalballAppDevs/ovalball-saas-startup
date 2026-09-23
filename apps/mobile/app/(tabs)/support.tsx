import { useCallback, useEffect, useState } from "react"
import { KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { useSession } from "../../src/auth/session"
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABEL,
  loadMySupportTickets,
  raiseSupportTicket,
  type SupportCategory,
  type SupportConversationSummary,
} from "../../src/support/support"
import { ChevronRight, CircleHelp, Plus, X } from "../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../src/components/ui"
import { friendly, logDetail } from "../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * SUPPORT — a real destination, not a button that opens a browser.
 *
 * The owner's rule for P1 is explicit: "Do not create a fake dead button." So
 * this reads and writes the canonical product -- `support_tickets` and their
 * `support_ticket_events` thread, through `getMySupportConversations`,
 * `create_support_ticket` and `add_support_followup`. There is no second support
 * backend and nothing here that the website does not also do.
 *
 * WHAT P1 BUILDS: the list of your own requests, their canonical status, and the
 * form to raise a new one. Reading a full thread and replying to it arrive with
 * the rest of the messaging convergence at P6 -- until then a request that has
 * been answered says so and opens on the web, which is truthful rather than
 * dead.
 *
 * SCOPED TO THE PERSON, NEVER THE CLUB. A support request is between one person
 * and Ovalball; a colleague at the same club must not see it because it was
 * raised from that club's context. That is the canonical reader's own rule and
 * RLS enforces it underneath -- this screen adds no filter of its own.
 */
export default function Support() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const userId = session?.user?.id ?? null

  const [tickets, setTickets] = useState<SupportConversationSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setProblem(null)
    try {
      setTickets(await loadMySupportTickets(supabase, userId))
    } catch (caught) {
      const failure = friendly(caught, "your support requests")
      logDetail("support list", failure)
      setProblem(failure.message)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

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
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Support
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Raise a new support request"
          onPress={() => setComposing(true)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Plus size={22} color={colour.forest800} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
            tintColor={colour.forest800}
          />
        }
      >
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : tickets === null ? (
          <CardSkeleton lines={3} />
        ) : tickets.length === 0 ? (
          <EmptyState
            title="Nothing open"
            body="Ask us anything about Ovalball — a fixture that looks wrong, a person who cannot sign in, or something you cannot find."
            icon={<CircleHelp size={26} color={colour.forest800} strokeWidth={1.8} />}
          />
        ) : (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {tickets.map((ticket, index) => (
              <Pressable
                key={ticket.ticketId}
                accessibilityRole="button"
                accessibilityLabel={`${ticket.subject}. ${SUPPORT_STATUS_LABEL[ticket.status]}. Reference ${ticket.reference}. Opens on the web`}
                /* THE THREAD OPENS ON THE WEB, for now, and that is a truthful
                   handoff rather than a dead row: the ticket, its reference and
                   its status are all here natively, and the conversation itself
                   arrives with the messaging convergence at P6. Opening the
                   canonical page is better than a row that does nothing. */
                onPress={() => void Linking.openURL(`${webUrl}/support/${ticket.ticketId}`)}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colour.line,
                  backgroundColor: pressed ? colour.chalk : colour.surface,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
                    {ticket.subject}
                  </Text>
                  <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>
                    {/* The canonical status word, and the reference somebody
                        quotes back to us. Never a colour alone. */}
                    {[SUPPORT_STATUS_LABEL[ticket.status], ticket.reference].filter(Boolean).join(" · ")}
                  </Text>
                  {!!ticket.latestPreview && (
                    <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, marginTop: 2 }]}>
                      {ticket.latestFrom === "support" ? "Ovalball: " : "You: "}
                      {ticket.latestPreview}
                    </Text>
                  )}
                </View>
                <ChevronRight size={17} color={colour.inkSubtle} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {composing && (
        <NewRequest
          onClose={() => setComposing(false)}
          onRaised={() => {
            setComposing(false)
            void load()
          }}
        />
      )}
    </View>
  )
}

/**
 * Raising a request.
 *
 * ONE CATEGORY, ONE SUBJECT, ONE DESCRIPTION — the canonical RPC's own required
 * shape. The category list is `SUPPORT_CATEGORIES` from the shared vocabulary,
 * not a list retyped for the phone, so a category added to the product appears
 * here without anybody remembering.
 */
function NewRequest({ onClose, onRaised }: { onClose: () => void; onRaised: () => void }) {
  const insets = useSafeAreaInsets()
  const [category, setCategory] = useState<SupportCategory>(SUPPORT_CATEGORIES[0])
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function send() {
    setProblem(null)
    setSending(true)
    const result = await raiseSupportTicket(supabase, { category, subject, description })
    setSending(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onRaised()
  }

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1, paddingLeft: space.xs }]}>
          New Request
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          disabled={sending}
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || sending ? 0.5 : 1,
          })}
        >
          <X size={22} color={colour.inkMuted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
        >
          {problem && (
            <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
              {problem}
            </Text>
          )}

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
              WHAT IS IT ABOUT
            </Text>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {SUPPORT_CATEGORIES.map((key) => {
                const selected = category === key
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={SUPPORT_CATEGORY_LABELS[key]}
                    onPress={() => setCategory(key)}
                    style={({ pressed }) => ({
                      minHeight: TOUCH_TARGET - 8,
                      justifyContent: "center",
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: selected ? colour.forest800 : colour.lineStrong,
                      backgroundColor: selected ? colour.forest800 : colour.surface,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink, fontSize: 13 }]}>
                      {SUPPORT_CATEGORY_LABELS[key]}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <Field label="SUBJECT" value={subject} onChange={setSubject} placeholder="In a few words" editable={!sending} />
          <Field
            label="WHAT IS HAPPENING"
            value={description}
            onChange={setDescription}
            placeholder="What you expected, and what happened instead"
            multiline
            editable={!sending}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send request"
            accessibilityState={{ disabled: sending || subject.trim().length === 0 || description.trim().length === 0 }}
            disabled={sending || subject.trim().length === 0 || description.trim().length === 0}
            onPress={() => void send()}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 4,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              backgroundColor: colour.forest800,
              opacity: sending || subject.trim().length === 0 || description.trim().length === 0 ? 0.5 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.smallMedium, { color: colour.onForest, fontSize: 15 }]}>
              {sending ? "Sending…" : "Send Request"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  editable,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder: string
  multiline?: boolean
  editable: boolean
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        style={[
          type.body,
          {
            minHeight: multiline ? 120 : TOUCH_TARGET,
            color: colour.ink,
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.line,
            backgroundColor: colour.surface,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
    </View>
  )
}
