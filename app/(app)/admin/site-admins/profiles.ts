/**
 * SLICE 7c: each profile now carries its canonical `profileKey` as well as
 * the legacy `value`. The legacy value is site_admins.admin_role -- the
 * PRESENTATION role, the word this screen displays. Slice 7 established that
 * it is not authority: capabilities hang off profile_key, and admin_role is
 * kept in step with it by a trigger purely so existing screens keep reading.
 * Anything sent to the database as authority must be the profileKey.
 *
 * The six fixed Site Admin profiles from the brief -- deliberately not a
 * database-configurable list (unlike permission_groups' club/team-scope
 * capability groups). Kept in one place so the invite form, the role-change
 * control, and the list page's labels never drift from each other.
 */
export const ADMIN_PROFILES = [
  {
    value: "full",
    profileKey: "SITE_FULL",
    label: "Full Site Admin",
    description: "Unrestricted global access: everything below, plus managing other Site Admins.",
  },
  {
    value: "fixture_ops",
    profileKey: "SITE_OPS",
    label: "Fixture Operations Admin",
    description: "Fixture Control Centre, CSV imports, conflict review, fixture messages, exports. Cannot manage user permissions or club identity.",
  },
  {
    value: "club_data",
    profileKey: "SITE_DATA",
    label: "Club Data Admin",
    description: "Club Management, directory, logos, profiles, data quality, CSV. Cannot grant permissions or manage Site Admins.",
  },
  {
    value: "user_access",
    profileKey: "SITE_SUPPORT",
    label: "User & Access Admin",
    description: "User Management, Permission Management, club access changes, suspend/reactivate. Cannot manage Site Admins.",
  },
  {
    value: "message_moderator",
    profileKey: "SITE_MOD",
    label: "Message Moderator",
    description: "Message Management: reported threads, moderation actions. Cannot manage users, clubs, or fixtures.",
  },
  {
    value: "read_only",
    profileKey: "SITE_RO",
    label: "Read-Only Site Admin",
    description: "Can view operational admin data across every section, but cannot make any changes.",
  },
] as const

export type AdminProfileValue = (typeof ADMIN_PROFILES)[number]["value"]

export function profileLabel(value: string): string {
  return ADMIN_PROFILES.find((p) => p.value === value)?.label ?? value
}

/** The canonical bundle key for a legacy admin_role value. */
export function profileKeyFor(value: string): string | null {
  return ADMIN_PROFILES.find((p) => p.value === value)?.profileKey ?? null
}
