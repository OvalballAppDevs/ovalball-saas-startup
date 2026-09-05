export interface Capability {
  key: string
  label: string
  description: string | null
  category: string
}

export interface PermissionGroup {
  id: string
  name: string
  description: string | null
  scopeType: "global" | "club" | "team"
  isSystem: boolean
  isActive: boolean
  mapsToRole: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY" | null
  mapsToTeamPermission: "view_only" | "coach" | "manager" | "team_admin" | null
  capabilityKeys: string[]
  assignedCount: number
  createdAt: string
  updatedAt: string
}

export const CATEGORY_LABEL: Record<string, string> = {
  club: "Club",
  people: "People",
  team: "Team",
  fixture: "Fixture",
  calendar: "Calendar",
  messaging: "Messaging",
  permissions: "Permissions",
}
