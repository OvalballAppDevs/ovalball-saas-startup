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
 * rather than accepting the write and ignoring it. Push has its own switch the same way: a device
 * being registered is delivery, not authorization, so push_ready reflects only whether the topic
 * has a preference to control, never whether any particular person has a live device token.
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
  pushEnabled: boolean
}

export async function readNotificationPreferences(supabase: Client, userId: string): Promise<NotificationTopicPreference[]> {
  const [topics, prefs] = await Promise.all([
    supabase.from("notification_topic_settings").select("key, label, description, mandatory, has_mandatory_events, email_controllable").order("sort_order"),
    supabase.from("notification_preferences").select("topic_key, in_app_enabled, email_enabled, push_enabled").eq("user_id", userId),
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
      pushEnabled: mine.get(t.key)?.push_enabled ?? true,
    }))
}

export async function setNotificationPreference(
  supabase: Client,
  topicKey: string,
  channel: "in_app" | "email" | "push",
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_notification_preference", {
    p_topic_key: topicKey,
    p_in_app_enabled: channel === "in_app" ? enabled : undefined,
    p_email_enabled: channel === "email" ? enabled : undefined,
    p_push_enabled: channel === "push" ? enabled : undefined,
  })
  if (error) throw error
}

/**
 * ONE TOPIC'S OWN EVENT FAMILIES -- the "Notify me about" granularity inside a category (notifications
 * platform programme Phase D). Most topics have none yet: `hasType` is false for an event seeded ahead
 * of its producer (notifications platform programme Phase G and later), and the caller shows nothing
 * for it rather than a switch that would control nothing real. Falling back to `true` when no row
 * exists mirrors the topic-level reader exactly -- an event nobody has touched inherits "on".
 */
export interface NotificationEventPreference {
  key: string
  label: string
  description: string
  hasType: boolean
  inAppEnabled: boolean
  emailEnabled: boolean
  pushEnabled: boolean
}

export async function readNotificationEventPreferences(
  supabase: Client,
  userId: string,
  topicKey: string,
): Promise<NotificationEventPreference[]> {
  const [events, prefs] = await Promise.all([
    supabase.from("notification_event_settings").select("key, label, description, sort_order, has_type").eq("topic_key", topicKey).order("sort_order"),
    supabase.from("notification_event_preferences").select("event_key, in_app_enabled, email_enabled, push_enabled").eq("user_id", userId),
  ])
  if (events.error) throw events.error
  const mine = new Map((prefs.data ?? []).map((p) => [p.event_key, p]))
  return (events.data ?? [])
    .filter((e): e is typeof e & { key: string } => typeof e.key === "string")
    .map((e) => ({
      key: e.key,
      label: e.label ?? e.key,
      description: e.description ?? "",
      hasType: e.has_type === true,
      inAppEnabled: mine.get(e.key)?.in_app_enabled ?? true,
      emailEnabled: mine.get(e.key)?.email_enabled ?? true,
      pushEnabled: mine.get(e.key)?.push_enabled ?? true,
    }))
}

export async function setNotificationEventPreference(
  supabase: Client,
  eventKey: string,
  channel: "in_app" | "email" | "push",
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_notification_event_preference", {
    p_event_key: eventKey,
    p_in_app_enabled: channel === "in_app" ? enabled : undefined,
    p_email_enabled: channel === "email" ? enabled : undefined,
    p_push_enabled: channel === "push" ? enabled : undefined,
  })
  if (error) throw error
}
