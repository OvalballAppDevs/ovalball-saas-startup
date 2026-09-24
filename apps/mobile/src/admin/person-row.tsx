import { Pressable, Text, View } from "react-native"
import { clubRoleLabel, MEMBERSHIP_STATE_LABEL, personName, teamPermissionLabel, type ClubPerson } from "@ovalball/contracts/club/people"

import { ChevronRight } from "../components/icons"
import { PersonAvatar } from "../components/identity"
import { StatusPill } from "../components/ui"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"

/**
 * ONE PERSON IN A LIST -- the same row wherever the Admin Centre lists the club's people (People,
 * Roles & Permissions), so a person looks the same whichever job brought the reader here.
 *
 * The avatar is the PERSON's (`resolvePersonalAvatarUrls`), never a crest and never a kit.
 */
export function PersonRow({ person, avatarUrl, first, onPress }: { person: ClubPerson; avatarUrl: string | null; first: boolean; onPress?: () => void }) {
  const name = personName(person)
  const roleLine = person.kind === "invited" ? `Invited${person.invitationRole ? ` as ${person.invitationRole}` : ""}` : clubRoleLabel(person.role)
  const teams = person.teamRoles.map((t) => `${teamPermissionLabel(t.permission)} · ${t.teamDisplayName}`)
  const extras = person.additionalRoles.map((a) => (a.confirmationState === "PENDING_CONFIRMATION" ? `${a.label} (awaiting confirmation)` : a.label))
  const stateTone = person.state === "ACTIVE" ? "positive" : person.state === "SUSPENDED" ? "caution" : "neutral"
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${name}${person.isSelf ? " (you)" : ""}. ${roleLine}. ${MEMBERSHIP_STATE_LABEL[person.state]}${teams.length ? `. ${teams.join(", ")}` : ""}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 16, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed && onPress ? "rgba(16,21,18,0.03)" : "transparent", opacity: person.state === "SUSPENDED" ? 0.75 : 1 })}
    >
      <PersonAvatar name={person.kind === "invited" ? null : name} url={avatarUrl} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]} numberOfLines={1}>
            {name}
            {person.isSelf ? <Text style={{ color: colour.inkMuted }}> (you)</Text> : null}
          </Text>
          {person.state !== "ACTIVE" && <StatusPill label={MEMBERSHIP_STATE_LABEL[person.state]} tone={stateTone} />}
        </View>
        <Text style={[type.caption, { color: colour.forest800 }]}>{[roleLine, ...extras].join(" · ")}</Text>
        {teams.length > 0 && (
          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
            {teams.join(" · ")}
          </Text>
        )}
        {person.email && <Text style={[type.caption, { color: colour.inkSubtle }]}>{person.email}</Text>}
      </View>
      {onPress && <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}

/** The role line for one person, in the words the rest of the product uses: "Coach · Under 12 Boys", "Member". */
export function personRoleLine(person: ClubPerson): string {
  const parts = [clubRoleLabel(person.role), ...person.teamRoles.map((t) => `${teamPermissionLabel(t.permission)} · ${t.teamDisplayName}`), ...person.additionalRoles.filter((a) => a.confirmationState !== "PENDING_CONFIRMATION").map((a) => a.label)]
  return parts.filter(Boolean).join(" · ")
}
