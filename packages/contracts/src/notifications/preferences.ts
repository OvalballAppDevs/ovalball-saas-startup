import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * NOTIFICATION PREFERENCES -- the website's account section, as a contract (CA-M8).
 *
 * The rows are `notification_topic_settings`: each topic with whether it is mandatory (no switch at
 * all), whether it still carries events that always arrive, and whether an email switch would control
 * anything. The values are the person's own `notification_preferences`, defaulting to on. The write is
 * `set_notification_preference`, which refuses to switch off a mandatory topic in-app -- saying so
 * rather than accepting the write and ignoring it. Push has no switch because push does not exist.
 */
export interface NotificationTopicPreference {
  key: string
  label: string
  description: string
  mandatory: boolean
  hasMandatoryEvents: boolean
  emailControllable: boolean
  inAppEnabled: boolean
  emailEnabled: boolean
}

export async function readNotificationPreferences(supabase: Client, userId: string): Promise<NotificationTopicPreference[]> {
  const [topics, prefs] = await Promise.all([
    supabase.from("notification_topic_settings").select("key, label, description, mandatory, has_mandatory_events, email_controllable").order("sort_order"),
    supabase.from("notification_preferences").select("topic_key, in_app_enabled, email_enabled").eq("user_id", userId),
  ])
  if (topics.error) throw topics.error
  const mine = new Map((prefs.data ?? []).map((p) => [p.topic_key, p]))
  return (topics.data ?? [])
    .filter((t): t is typeof t & { key: string } => typeof t.key === "string")
    .map((t) => ({
      key: t.key,
      label: t.label ?? t.key,
      description: t.description ?? "",
      mandatory: t.mandatory === true,
      hasMandatoryEvents: t.has_mandatory_events === true,
      emailControllable: t.email_controllable === true,
      inAppEnabled: mine.get(t.key)?.in_app_enabled ?? true,
      emailEnabled: mine.get(t.key)?.email_enabled ?? true,
    }))
}

export async function setNotificationPreference(supabase: Client, topicKey: string, channel: "in_app" | "email", enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_notification_preference", {
    p_topic_key: topicKey,
    p_in_app_enabled: channel === "in_app" ? enabled : undefined,
    p_email_enabled: channel === "email" ? enabled : undefined,
  })
  if (error) throw error
}
