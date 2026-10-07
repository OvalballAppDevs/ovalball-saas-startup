"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { reminderOutcomeSentence, sendMembershipReminders } from "@ovalball/contracts/membership/board"
import { previewMembershipReminders, sendRemindersInBatches, type ReminderPreview } from "@ovalball/contracts/membership/operate"

/** The server's own sentences are written for people (a daily limit, a refusal); anything else is not shown raw. */
function readableSentence(cause: unknown, fallback: string): string {
  const message = (cause as { message?: string } | null)?.message
  const readable = message && /^[A-Z][^\n]{8,200}\.$/.test(message) && !/\b(violates|syntax|relation|function|column|constraint|null value|uuid)\b/i.test(message)
  return readable ? message : fallback
}

/**
 * WHAT A TEAM'S REMINDER WOULD SAY, before anything is sent: the server's own words for each situation, with the
 * sending rule (this team's players only) and nothing recorded. The club is the team's own, read on the server.
 */
export async function previewTeamReminders(teamId: string, playerIds: string[]): Promise<{ ok: true; preview: ReminderPreview } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: team } = await supabase.from("teams").select("id, club_id").eq("id", teamId).maybeSingle()
  if (!team) return { ok: false, error: "That team could not be found." }
  try {
    return { ok: true, preview: await previewMembershipReminders(supabase, { clubId: team.club_id, teamId: team.id, playerIds: playerIds.slice(0, 500) }) }
  } catch (cause) {
    return { ok: false, error: readableSentence(cause, "The message couldn't be shown. Try again.") }
  }
}

/**
 * A TEAM'S STAFF REMINDING THEIR OWN PLAYERS' FAMILIES (20270746000000). The club is the team's own, read on
 * the server; the operation then allows only players with a place on this team, asks only the responsible
 * payer or (with nothing set up) the guardians the contact rule allows, and never says who was told. A large
 * squad goes in the server's own batches, one after another; a refusal part-way stops there and is said beside
 * what was already sent, so nobody is asked twice.
 */
export async function remindTeamMembers(teamId: string, playerIds: string[]): Promise<{ tone: "ok" | "error"; text: string; sent?: number }> {
  const supabase = await createClient()
  const { data: team } = await supabase.from("teams").select("id, club_id").eq("id", teamId).maybeSingle()
  if (!team) return { tone: "error", text: "That team could not be found." }
  const { result, error } = await sendRemindersInBatches((ids) => sendMembershipReminders(supabase, { clubId: team.club_id, teamId: team.id, playerIds: ids }), playerIds)
  revalidatePath(`/teams/${team.id}`)
  revalidatePath(`/teams/${team.id}/subscriptions`)
  if (error) {
    const why = readableSentence(error, result.sent > 0 ? "The rest weren't sent. Try again." : "The reminder wasn't sent. Try again.")
    return { tone: "error", text: result.sent > 0 ? `${reminderOutcomeSentence(result)} ${why}` : why, sent: result.sent }
  }
  return { tone: "ok", text: reminderOutcomeSentence(result), sent: result.sent }
}
