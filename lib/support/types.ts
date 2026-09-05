export const SUPPORT_CATEGORIES = [
  "account_login",
  "club_management",
  "teams",
  "fixtures",
  "results",
  "messages",
  "partner_clubs",
  "calendar",
  "documents",
  "permissions_users",
  "bug",
  "feature_question",
  "data_club_information",
  "privacy_account_data",
  "other",
] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account_login: "Account & Login",
  club_management: "Club Management",
  teams: "Teams",
  fixtures: "Fixtures",
  results: "Results",
  messages: "Messages",
  partner_clubs: "Partner Clubs",
  calendar: "Calendar",
  documents: "Documents",
  permissions_users: "Permissions & Users",
  bug: "Bug / Something isn't working",
  feature_question: "Feature Question",
  data_club_information: "Data / Club Information",
  privacy_account_data: "Privacy / Account Data",
  other: "Other",
}

export type SupportStatus = "new" | "in_progress" | "closed"

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  closed: "Closed",
}

export type SupportEventType = "created" | "status_changed" | "requester_message" | "support_reply" | "internal_note"
export type SupportEventVisibility = "requester" | "internal"

export interface SupportTicketSummary {
  id: string
  reference: string
  category: SupportCategory
  subject: string
  status: SupportStatus
  createdAt: string
  updatedAt: string
}

export interface SupportTicketEvent {
  id: string
  eventType: SupportEventType
  visibility: SupportEventVisibility
  /** Null for a public-origin ticket's own 'created' event -- there is no signed-in actor to attribute it to. */
  actorUserId: string | null
  actorName: string
  body: string | null
  metadata: Record<string, unknown>
  createdAt: string
}
