import { Pressable, Text, View } from "react-native"
import { MEMBERSHIP_STATE_LABEL, invitationSummary, personName, personSummary, type ClubPerson } from "@ovalball/contracts/club/people"

import { ChevronRight } from "../components/icons"
import { PersonAvatar } from "../components/identity"
import { StatusPill } from "../components/ui"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * ONE PERSON IN A LIST -- the same row wherever the club's people are listed (People, Roles & Access,
 * Roles & Permissions), so a person looks the same whichever job brought the reader here.
 *
 * WHAT THEY DO comes first ("Assistant Coach · Women's 1st Team"), their club access when that is all
 * there is, and a state pill ONLY when the state is not plain Active -- Waiting for Approval, Invited,
 * Deactivated -- always in words, never colour alone. The avatar is the PERSON's
 * (`resolvePersonalAvatarUrls`), never a crest and never a kit; a player's row keeps the initials
 * fallback, because no whole-register player picture source is authorised.
 */
export function PersonRow({ person, avatarUrl, first, onPress }: { person: ClubPerson; avatarUrl: string | null; first: boolean; onPress?: () => void }) {
  const name = personName(person)
  const summary = person.kind === "invited" ? invitationSummary(person) : personSummary(person)
  const sent = person.kind === "invited" && person.invitationSentAt ? sentAgo(person.invitationSentAt) : null
  const stateTone = person.state === "SUSPENDED" ? "caution" : "neutral"
  const label = person.kind === "invited" ? "Pending" : MEMBERSHIP_STATE_LABEL[person.state]
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${name}${person.isSelf ? " (you)" : ""}. ${summary}${person.state !== "ACTIVE" ? `. ${label}` : ""}${sent ? `. ${sent}` : ""}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 20, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed && onPress ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      <PersonAvatar name={person.kind === "invited" && !person.invitationName ? null : name} url={avatarUrl} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.bodyMedium, { color: person.state === "SUSPENDED" ? colour.inkMuted : colour.ink }]}>
          {name}
          {person.isSelf ? <Text style={{ color: colour.inkMuted }}> (you)</Text> : null}
        </Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{summary}</Text>
        {!!sent && <Text style={[type.caption, { color: colour.inkSubtle }]}>{sent}</Text>}
      </View>
      {person.state !== "ACTIVE" && <StatusPill label={label} tone={stateTone} />}
      {onPress && <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}

/** "Sent today", "Sent 2 days ago" -- when an invitation went out, in a club's words. */
export function sentAgo(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "Sent today"
  if (days === 1) return "Sent yesterday"
  return `Sent ${days} days ago`
}

/** One person's line in words -- what they do, else their access -- for a screen that names them once. */
export function personRoleLine(person: ClubPerson): string {
  return person.kind === "invited" ? invitationSummary(person) : personSummary(person)
}
