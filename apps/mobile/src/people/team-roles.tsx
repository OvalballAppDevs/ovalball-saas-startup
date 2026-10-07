import { useRef } from "react"
import { Text, TextInput, View } from "react-native"

import { COMMON_TEAM_ROLES, CUSTOM_ROLE_BASE, ROLE_CATALOGUE, TEAM_ROLE_OPTIONS, catalogueRole, teamTitleLabel } from "@ovalball/contracts/role-labels"

import { ChoiceRow } from "./ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE ONE TEAM ROLE SELECTOR -- what somebody does for a team, chosen the same way everywhere: adding an
 * existing person to a team's staff, inviting somebody new for a team, and managing a person's roles on
 * the Staff tab (People & Invitations; it replaces the Staff tab's own list and the invitation sheet's).
 *
 * A PICK IS A ROLE AND, OPTIONALLY, ITS TITLE: `Map<roleKey, title | null>`. One assignment per role per
 * team is the server's rule, so the shape enforces it: Coach nests its own titles (Coach, Head Coach,
 * Assistant Coach) and Volunteer nests its own (Volunteer, Physio, Kit Manager, a custom role), each as a
 * single choice underneath -- never two Coach roles, never "Physio and Kit Manager" as two Volunteers.
 *
 * WHICH ROLES ARE OFFERED is the server's answer for this caller at this team (`assignable`): a Team Admin
 * is offered what they may give there and nothing else. A custom role is a Volunteer with the club's own
 * words -- what a Volunteer may see is all it may see. Team Admin is not offered here: it is access added
 * on top of a Coach or Team Manager role, from the person's own record.
 */
export type TeamRolePicks = Map<string, string | null>

// The one team-role order (role-labels), without Team Admin: that is access added from the person's record.
const ORDER: string[] = TEAM_ROLE_OPTIONS.map((o) => o.value).filter((k) => k !== "TEAM_ADMINISTRATION")

/** The titles a role offers as single choices beneath it, in order; `null` is the role's plain name. */
const nestedFor = (roleKey: string) =>
  COMMON_TEAM_ROLES.filter((r) => r.roleKey === roleKey)
    .map((r) => ({ title: r.title, label: r.label, description: r.description }))
    // The role's plain name first, then its titles in the catalogue's order.
    .sort((a, b) => Number(a.title !== null) - Number(b.title !== null))
const NESTED: Record<string, { title: string | null; label: string; description: string }[]> = {
  COACH: nestedFor("COACH"),
  VOLUNTEER: nestedFor("VOLUNTEER"),
}

const CUSTOM = "__custom__"

/**
 * A CUSTOM ROLE THAT IS ALREADY A ROLE, caught while it is typed rather than at the last step. Derived from
 * the one catalogue -- every governed role's name, and the Coach role's own titles -- never a second list.
 * The server remains the authority and refuses more than this (administration and safeguarding words too);
 * this only answers the common case where it is said, beside the field.
 */
const ROLE_NAMES = new Map<string, string>([
  ...ROLE_CATALOGUE.map((r) => [r.label.toLowerCase(), r.label] as [string, string]),
  ...COMMON_TEAM_ROLES.filter((r) => r.roleKey === "COACH" && r.title !== null).map((r) => [r.label.toLowerCase(), r.label] as [string, string]),
])

export function reservedRoleName(title: string | null | undefined): string | null {
  if (!title) return null
  return ROLE_NAMES.get(title.trim().replace(/\s+/g, " ").toLowerCase()) ?? null
}

export function TeamRoleSelector({
  assignable,
  value,
  onChange,
  held,
  disabled = false,
}: {
  /** Role keys this caller may give at this team -- the server's answer. */
  assignable: readonly string[]
  value: TeamRolePicks
  onChange: (next: TeamRolePicks) => void
  /** Roles already held here: shown, not offered again. */
  held?: ReadonlySet<string>
  disabled?: boolean
}) {
  const customRef = useRef<TextInput>(null)
  const offered = ORDER.filter((k) => assignable.includes(k))

  function set(roleKey: string, title: string | null | undefined) {
    const next = new Map(value)
    if (title === undefined) next.delete(roleKey)
    else next.set(roleKey, title)
    onChange(next)
  }

  const volunteerTitle = value.get(CUSTOM_ROLE_BASE) ?? null
  const customOn = value.has(CUSTOM_ROLE_BASE) && volunteerTitle !== null && !NESTED.VOLUNTEER.some((n) => n.title === volunteerTitle)

  return (
    <View style={{ gap: space.sm }}>
      {offered.map((key) => {
        const role = catalogueRole(key)
        const already = held?.has(key) ?? false
        const on = value.has(key)
        const nested = NESTED[key]
        return (
          <ChoiceRow
            key={key}
            kind="checkbox"
            checked={on || already}
            label={role?.label ?? key}
            description={role?.description}
            suffix={already ? "Already held" : undefined}
            disabled={disabled || already}
            onPress={() => set(key, on ? undefined : null)}
          >
            {on && nested && (
              <View style={{ marginLeft: space.xl, marginTop: space.sm, gap: space.xs }}>
                {nested.map((n) => (
                  <ChoiceRow
                    key={n.label}
                    kind="radio"
                    checked={key === CUSTOM_ROLE_BASE ? !customOn && value.get(key) === n.title : value.get(key) === n.title}
                    label={n.label}
                    description={n.description}
                    disabled={disabled}
                    onPress={() => set(key, n.title)}
                  />
                ))}
                {key === CUSTOM_ROLE_BASE && (
                  <View style={{ gap: space.xs }}>
                    <ChoiceRow
                      kind="radio"
                      checked={customOn}
                      label="A Custom Role"
                      description="Your own name for what they do. It gives the same access as Volunteer."
                      disabled={disabled}
                      onPress={() => {
                        set(key, volunteerTitle && customOn ? volunteerTitle : "")
                        setTimeout(() => customRef.current?.focus(), 50)
                      }}
                    />
                    {(customOn || volunteerTitle === "") && (
                      <TextInput
                        ref={customRef}
                        accessibilityLabel="Custom role name"
                        value={volunteerTitle ?? ""}
                        onChangeText={(t) => set(key, t)}
                        placeholder="e.g. Strength & Conditioning Coach"
                        placeholderTextColor={colour.inkSubtle}
                        maxLength={60}
                        autoCapitalize="words"
                        autoCorrect={false}
                        editable={!disabled}
                        style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: reservedRoleName(volunteerTitle) ? colour.danger : colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
                      />
                    )}
                    {customOn && reservedRoleName(volunteerTitle) && (
                      <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.danger }]}>{`${reservedRoleName(volunteerTitle)} is already a role. Choose it from the list instead.`}</Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </ChoiceRow>
        )
      })}
      {assignable.includes(CUSTOM_ROLE_BASE) && !value.has(CUSTOM_ROLE_BASE) && !(held?.has(CUSTOM_ROLE_BASE) ?? false) && (
        <ChoiceRow
          kind="checkbox"
          checked={false}
          label="Create a Custom Role"
          description="Name what they do, such as Strength & Conditioning Coach or Analyst. It gives the same access as Volunteer."
          disabled={disabled}
          onPress={() => {
            set(CUSTOM_ROLE_BASE, "")
            setTimeout(() => customRef.current?.focus(), 80)
          }}
        />
      )}
      {offered.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>There are no team roles you can give here.</Text>}
    </View>
  )
}

/** Why these picks cannot be confirmed yet, in a sentence; null when they can. */
export function picksProblem(picks: TeamRolePicks): string | null {
  if (picks.size === 0) return "Choose at least one role for them."
  for (const [, title] of picks) {
    if (title !== null && title.trim() === "") return "Name the custom role, or choose another."
    const reserved = reservedRoleName(title)
    if (reserved && !COMMON_TEAM_ROLES.some((r) => r.title === title)) return `${reserved} is already a role. Choose it from the list instead.`
  }
  return null
}

/** The picks a person can confirm: every role, with a custom title that has words in it and is not a role's name. */
export function picksReady(picks: TeamRolePicks): boolean {
  return picksProblem(picks) === null
}

/** "Assistant Coach", "Physio", "Team Manager" -- one line per pick. */
export function pickLabels(picks: TeamRolePicks): string[] {
  return [...picks].map(([roleKey, title]) => teamTitleLabel(title) ?? catalogueRole(roleKey)?.label ?? roleKey)
}

/**
 * The same, where what a pick GIVES must be plain -- a review or a confirmation: a Volunteer described in the
 * club's own words says so ("Physio (Volunteer)"), because the words describe and the Volunteer role is what
 * grants. Coach's own titles need no note: they are a Coach.
 */
export function pickLabelsWithAccess(picks: TeamRolePicks): string[] {
  return [...picks].map(([roleKey, title]) => {
    const label = teamTitleLabel(title) ?? catalogueRole(roleKey)?.label ?? roleKey
    return roleKey === CUSTOM_ROLE_BASE && title ? `${label} (${catalogueRole(CUSTOM_ROLE_BASE)?.label ?? "Volunteer"})` : label
  })
}

/** The invitation's per-team shape: roles, and the titles that are not the role's plain name. */
export function picksToInvitation(teamId: string, picks: TeamRolePicks): { id: string; roles: string[]; titles: Record<string, string> } {
  const titles: Record<string, string> = {}
  for (const [roleKey, title] of picks) if (title && title.trim()) titles[roleKey] = title.trim()
  return { id: teamId, roles: [...picks.keys()], titles }
}
