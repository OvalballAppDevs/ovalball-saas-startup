"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE, type SendSafeguardingContactResult } from "./constants"

/**
 * The real replacement for Side Project 3 Stage 6's demo scenario-switcher
 * (deleted, not adapted, per SP3's own Integration Manifest). This picks
 * among the viewer's OWN real teams -- never a fake scenario -- so a
 * parent/staff member with more than one relevant team can choose which
 * one's Rugby Hub they mean. Validated on read (getRugbyHubTeamOptions
 * only ever offers real, already-authorized team ids), never trusted
 * blindly: an unrecognised or forged cookie value simply fails the
 * server-side authorization check in get_rugby_hub_identity_context, the
 * same house convention every other "viewing as" cookie in this codebase
 * already follows.
 */
export async function setRugbyHubTeam(formData: FormData): Promise<void> {
  const teamId = formData.get("teamId")
  if (typeof teamId === "string" && teamId) {
    const store = await cookies()
    store.set(RUGBY_HUB_TEAM_COOKIE, teamId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 })
  }
  revalidatePath("/rugby-hub", "layout")
}

/** Calls Main's own real start_or_get_safeguarding_officer_conversation -- the real destination SP3's Stage 7 contract asked Main to eventually provide. */
export async function sendSafeguardingOfficerMessage(clubId: string, officerId: string, body: string): Promise<SendSafeguardingContactResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("start_or_get_safeguarding_officer_conversation", { p_club_id: clubId, p_officer_id: officerId, p_first_message: body })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
