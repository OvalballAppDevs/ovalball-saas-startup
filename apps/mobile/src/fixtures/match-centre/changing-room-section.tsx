import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"

import {
  ANNOUNCEMENT_AUDIENCES,
  audienceCount,
  sendFixtureCommunication,
  sendOutcomeLine,
  type AnnouncementAudience,
  type CommunicationCounts,
  type FixtureAnnouncement,
} from "@ovalball/contracts/match-centre/communications"

import { supabase } from "../../auth/supabase"
import { PersonAvatar } from "../../components/identity"
import { Button } from "../../components/ui"
import { ChevronRight, Megaphone, MessageSquare, Send } from "../../components/icons"
import { friendly } from "../../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import type { OppositionContact } from "../../agenda/fixture-detail"

/**
 * THE CHANGING ROOM -- this match's conversation and its announcements, in one place.
 *
 * The conversation is the EXISTING fixture conversation (`fixture_messages`, shared by both clubs'
 * staff); nothing here makes a second thread. An announcement is a NOTIFICATION to the families it is
 * for -- All, Attending, Can't Attend or Unsure -- recorded with who it reached, so each family sees the
 * announcements sent to them and the sending side's staff see everything they sent. The other club's
 * announcements are never shown.
 */
export function ChangingRoomSection({
  fixtureId,
  canMessage,
  canAnnounce,
  canReachSomebody,
  counts,
  contacts,
  announcements,
  opening,
  onOpenConversation,
  onMessageOpposition,
  onMessageStaff,
  onSent,
}: {
  fixtureId: string
  canMessage: boolean
  canAnnounce: boolean
  canReachSomebody: boolean
  counts: CommunicationCounts | null
  contacts: OppositionContact[]
  announcements: FixtureAnnouncement[]
  opening: boolean
  onOpenConversation: () => void
  onMessageOpposition: (c: OppositionContact) => void
  onMessageStaff: () => void
  onSent: () => void
}) {
  return (
    <View style={{ gap: space.lg }}>
      {canMessage && (
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
          <ActionRow
            icon={<MessageSquare size={20} color={colour.forest800} />}
            title="Open Conversation"
            body="The conversation for this match, between both clubs' staff."
            onPress={onOpenConversation}
          />
          {contacts.map((contact) => (
            <ActionRow
              key={contact.userId}
              icon={<MessageSquare size={20} color={colour.forest800} />}
              title={contacts.length === 1 ? "Message Opposition" : `Message ${contact.displayName}`}
              body={[contact.displayName, contact.clubLabel].filter(Boolean).join(" · ")}
              busy={opening}
              onPress={() => onMessageOpposition(contact)}
              divider
            />
          ))}
        </View>
      )}

      {!canMessage && canReachSomebody && (
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
          <ActionRow
            icon={<MessageSquare size={20} color={colour.forest800} />}
            title="Message Team Staff"
            body="Ask a question about this match. Who you can reach is set by your club."
            onPress={onMessageStaff}
          />
        </View>
      )}

      {canAnnounce && counts && counts.team !== null && <Composer fixtureId={fixtureId} counts={counts} onSent={onSent} />}

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          {canAnnounce ? "Recent Announcements" : "Announcements"}
        </Text>
        {announcements.length === 0 ? (
          <Text style={[type.small, { color: colour.inkMuted }]}>
            {canAnnounce ? "Nothing sent for this match yet." : "Nothing has been announced to you for this match yet."}
          </Text>
        ) : (
          announcements.map((a) => (
            <View key={a.id} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <PersonAvatar name={a.sentByName} url={null} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]}>{a.sentByName ?? "Team staff"}</Text>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colour.infoSurface }}>
                      <Text style={[type.caption, { color: colour.info, fontSize: 11 }]}>Staff</Text>
                    </View>
                  </View>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>{when(a.sentAt)}</Text>
                </View>
              </View>
              <Text style={[type.small, { color: colour.ink }]}>{a.body ?? (a.kind === "REMINDER" ? "Please let the team know if your player can make it." : "")}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {a.kind === "REMINDER" ? "Reminder" : "Announcement"} · Sent to {a.audience}
                {a.fromMySide && a.recipientCount !== null ? ` · ${a.recipientCount} ${a.recipientCount === 1 ? "family" : "families"}` : ""}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  )
}

/** Send an Announcement: the message, who it goes to, and how many families that is -- before sending. */
function Composer({ fixtureId, counts, onSent }: { fixtureId: string; counts: CommunicationCounts; onSent: () => void }) {
  const [body, setBody] = useState("")
  const [audience, setAudience] = useState<AnnouncementAudience>("MESSAGE_TEAM")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const reach = audienceCount(counts, audience)

  async function send() {
    if (!body.trim()) {
      setProblem("Write a message before sending.")
      return
    }
    setBusy(true)
    setProblem(null)
    setOutcome(null)
    try {
      const result = await sendFixtureCommunication(supabase, fixtureId, audience, body.trim())
      setOutcome(sendOutcomeLine(result))
      if (result.outcome === "SENT" || result.outcome === "PARTIALLY_DELIVERED") setBody("")
      onSent()
    } catch (caught) {
      setProblem(friendly(caught, "this announcement").message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Megaphone size={18} color={colour.forest800} />
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Send an Announcement</Text>
      </View>
      <Text style={[type.caption, { color: colour.inkMuted }]}>Families are notified, and it appears in this match's Changing Room.</Text>
      <TextInput
        accessibilityLabel="Message"
        placeholder="Don't forget boots, a water bottle and a warm jacket."
        placeholderTextColor={colour.inkSubtle}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        style={[type.body, { minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, textAlignVertical: "top" }]}
      />
      <Text style={[type.smallMedium, { color: colour.ink }]}>Send To</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {ANNOUNCEMENT_AUDIENCES.map((a) => {
          const chosen = audience === a.key
          return (
            <Pressable
              key={a.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={`${a.label}${audienceCount(counts, a.key) !== null ? `, ${audienceCount(counts, a.key)}` : ""}`}
              onPress={() => setAudience(a.key)}
              style={{
                minHeight: TOUCH_TARGET - 4,
                paddingHorizontal: space.md,
                justifyContent: "center",
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: chosen ? colour.forest800 : colour.line,
                backgroundColor: chosen ? colour.forest800 : colour.surface,
              }}
            >
              <Text style={[type.smallMedium, { color: chosen ? colour.onForest : colour.ink }]}>{a.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {reach !== null && (
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          {reach === 0 ? "Nobody is in this group yet." : `This reaches the families of ${reach} ${reach === 1 ? "player" : "players"}.`}
        </Text>
      )}
      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
      {!!outcome && (
        <Text accessibilityLiveRegion="polite" style={[type.smallMedium, { color: colour.forest800 }]}>
          {outcome}
        </Text>
      )}
      <Button label="Send Announcement" busy={busy} disabled={!body.trim()} onPress={() => void send()} icon={<Send size={16} color={colour.onForest} />} />
    </View>
  )
}

function ActionRow({ icon, title, body, onPress, busy, divider }: { icon: React.ReactNode; title: string; body: string; onPress: () => void; busy?: boolean; divider?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.lg,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: colour.line,
        backgroundColor: pressed ? colour.chalk : colour.surface,
        opacity: busy ? 0.6 : 1,
      })}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{body}</Text>
      </View>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}
