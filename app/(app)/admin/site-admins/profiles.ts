/**
 * The six fixed Site Admin profiles from the brief -- deliberately not a
 * database-configurable list (unlike permission_groups' club/team-scope
 * capability groups). Kept in one place so the invite form, the role-change
 * control, and the list page's labels never drift from each other.
 */
export const ADMIN_PROFILES = [
  {
    value: "full",
    label: "Full Site Admin",
    description: "Unrestricted global access: everything below, plus managing other Site Admins.",
  },
  {
    value: "fixture_ops",
    label: "Fixture Operations Admin",
    description: "Fixture Management, CSV imports, conflict review, fixture messages, exports. Cannot manage user permissions or club identity.",
  },
  {
    value: "club_data",
    label: "Club Data Admin",
    description: "Club Management, directory, logos, profiles, data quality, CSV. Cannot grant permissions or manage Site Admins.",
  },
  {
    value: "user_access",
    label: "User & Access Admin",
    description: "User Management, Permission Management, club access changes, suspend/reactivate. Cannot manage Site Admins.",
  },
  {
    value: "message_moderator",
    label: "Message Moderator",
    description: "Message Management: reported threads, moderation actions. Cannot manage users, clubs, or fixtures.",
  },
  {
    value: "read_only",
    label: "Read-Only Site Admin",
    description: "Can view operational admin data across every section, but cannot make any changes.",
  },
] as const

export type AdminProfileValue = (typeof ADMIN_PROFILES)[number]["value"]

export function profileLabel(value: string): string {
  return ADMIN_PROFILES.find((p) => p.value === value)?.label ?? value
}
