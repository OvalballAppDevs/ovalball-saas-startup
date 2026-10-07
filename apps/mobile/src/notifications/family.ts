import type { ComponentType } from "react"
import type { ImageSourcePropType } from "react-native"

import { Bell, CalendarDays, CreditCard, Landmark, LifeBuoy, ListChecks, MessageSquare, Receipt, Shield, TriangleAlert, Trophy, UserPlus, Users } from "../components/icons"
import { colour, familyOnForest } from "../design/tokens"

/**
 * WHAT KIND OF NOTIFICATION THIS IS, AS THE EYE SEES IT -- one vocabulary for the bell's quick view,
 * the Notifications Centre and the foreground banner, so a tournament looks like a tournament
 * wherever it appears rather than each surface choosing its own icon.
 *
 * DERIVED FROM THE TYPE (and, for an announcement, who sent it), never from the words. Presentation
 * only: nothing here decides delivery, priority, action state or destination -- those stay with the
 * server and `notificationHref`.
 *
 * THE OVALBALL MARK IS A FAMILY OF ITS OWN. Results, and anything without a more specific family,
 * carry the real master app icon (`assets/icons/ovalball-icon.png`, the same file the production
 * build ships as its icon) -- never a redrawn ring, a letter or a generic bell.
 */
export type NotificationFamilyKey =
  | "important"
  | "results"
  | "tournaments"
  | "messages"
  | "availability"
  | "fixtures"
  | "team"
  | "club"
  | "payments"
  | "general"

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

export interface NotificationFamily {
  key: NotificationFamilyKey
  /** A lucide glyph, or null where the family is drawn with the real Ovalball master icon. */
  Icon: IconType | null
  /** The glyph's colour on a light surface. */
  accent: string
  /** The tile behind the glyph on a light surface. */
  tint: string
  /** The family's line on the forest ground (the foreground banner's progress line). */
  onForest: string
}

export const OVALBALL_MASTER_ICON: ImageSourcePropType = require("../../assets/icons/ovalball-icon.png")

const FAMILY: Record<NotificationFamilyKey, Omit<NotificationFamily, "key">> = {
  important: { Icon: TriangleAlert, accent: colour.danger, tint: colour.dangerSurface, onForest: familyOnForest.red },
  results: { Icon: null, accent: colour.forest800, tint: colour.mint100, onForest: familyOnForest.green },
  tournaments: { Icon: Trophy, accent: colour.warning, tint: colour.warningSurface, onForest: familyOnForest.amber },
  messages: { Icon: MessageSquare, accent: colour.messengerBlue, tint: colour.infoSurface, onForest: familyOnForest.blue },
  availability: { Icon: ListChecks, accent: colour.rugby700, tint: colour.mint100, onForest: familyOnForest.green },
  fixtures: { Icon: CalendarDays, accent: colour.forest800, tint: colour.mint100, onForest: familyOnForest.green },
  team: { Icon: Users, accent: colour.rugby700, tint: colour.successSurface, onForest: familyOnForest.green },
  club: { Icon: Landmark, accent: colour.forest800, tint: colour.successSurface, onForest: familyOnForest.green },
  payments: { Icon: CreditCard, accent: colour.warning, tint: colour.warningSurface, onForest: familyOnForest.amber },
  general: { Icon: null, accent: colour.forest800, tint: colour.mint100, onForest: familyOnForest.green },
}

const IMPORTANT = new Set([
  "fixture_cancelled",
  "fixture_cancelled_team_folded",
  "training_session_cancelled",
  "training_plan_cancelled",
  "tournament_cancelled",
  "competition_match_cancelled",
  "account_recovery_requested",
  "account_recovery_completed",
])

const AVAILABILITY = new Set([
  "fixture_attendance_invitation",
  "fixture_attendance_reminder",
  "fixture_availability_responded",
  "training_attendance_reminder",
  "training_availability_responded",
])

function keyFor(type: string, data: Record<string, unknown>): NotificationFamilyKey {
  if (IMPORTANT.has(type) || type.startsWith("safeguarding_")) return "important"
  if (type.includes("_result_")) return "results"
  if (type.startsWith("tournament_") || type === "team_created_from_tournament_invitation") return "tournaments"
  if (type === "announcement_received") {
    const sender = String(data.sender_identity_type ?? "").toLowerCase()
    if (sender.includes("team")) return "team"
    if (sender.includes("club")) return "club"
    return "messages"
  }
  if (type.includes("message")) return "messages"
  if (AVAILABILITY.has(type)) return "availability"
  if (type.startsWith("fixture_") || type.startsWith("competition_match_") || type === "historical_fixtures_linked") return "fixtures"
  if (type.startsWith("training_") || type.startsWith("season_transition_") || type.startsWith("team_place_") || type === "team_created_from_fixture_request") return "team"
  if (
    type.startsWith("club_") ||
    type.startsWith("partner_") ||
    type.startsWith("calendar_share_") ||
    type.startsWith("add_child_") ||
    type.endsWith("_invitation_accepted") ||
    type === "directory_request_submitted" ||
    type === "player_information_requested"
  ) {
    return "club"
  }
  if (type.startsWith("gocardless_") || type.startsWith("platform_")) return "payments"
  return "general"
}

export function notificationFamily(type: string, data: Record<string, unknown> = {}): NotificationFamily {
  const key = keyFor(type, data)
  return { key, ...FAMILY[key] }
}

/** The same families for an attention job, so an open job and the notification about it look alike. */
const ATTENTION_FAMILY: Record<string, NotificationFamilyKey> = {
  fixture_availability: "availability",
  training_availability: "availability",
  tournament_availability: "availability",
  fixture_incomplete: "fixtures",
  kickoff_proposal: "fixtures",
  fixture_request: "fixtures",
  result_confirmation: "results",
  team_place_request: "team",
  team_place_confirmation: "team",
  player_join_request: "team",
  call_up: "team",
  age_grade: "team",
  club_join_request: "club",
  partner_request: "club",
  team_subscription: "payments",
  family_subscription: "payments",
  tournament_result: "tournaments",
  dispensation: "team",
}

export function attentionFamily(sourceType: string): NotificationFamily {
  const key = ATTENTION_FAMILY[sourceType] ?? "general"
  return { key, ...FAMILY[key] }
}

/** One icon per preference category, shared by the Preferences overview and each category's own screen. */
const TOPIC_ICON: Record<string, IconType> = {
  messages: MessageSquare,
  fixture_requests: CalendarDays,
  fixture_updates: CalendarDays,
  tournaments: Trophy,
  calendar_training_updates: CalendarDays,
  access_invitations: UserPlus,
  support_moderation: LifeBuoy,
  account_security: Shield,
  membership_payments: CreditCard,
  platform_billing: Receipt,
}
export function topicIcon(topicKey: string): IconType {
  return TOPIC_ICON[topicKey] ?? Bell
}
