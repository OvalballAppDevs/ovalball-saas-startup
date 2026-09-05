"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { DIAGNOSTIC_SESSION_COOKIE } from "@/lib/app-context/diagnostic-access"
import { createClient } from "@/lib/supabase/server"

/**
 * Opens a diagnostic club-viewing session (enter_diagnostic_club
 * re-validates the diagnostic_club_access capability and the target
 * club's status server-side -- never trusts that the "View as this club"
 * button was only ever shown when it should have been) and lands on the
 * dashboard, now showing that club's read-only diagnostic view.
 */
export async function enterDiagnosticClub(clubId: string): Promise<{ error: string } | void> {
  const supabase = await createClient()
  const { data: sessionId, error } = await supabase.rpc("enter_diagnostic_club", { p_club_id: clubId })
  if (error || !sessionId) {
    return { error: error?.message ?? "Could not start a diagnostic session for that club." }
  }

  const store = await cookies()
  store.set(DIAGNOSTIC_SESSION_COOKIE, sessionId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 8 })
  // The (app) layout (banner + nav) is shared between /admin/clubs/[id] and
  // /dashboard -- without this, Next's client router cache can serve the
  // already-rendered pre-diagnostic layout instead of re-fetching it, since
  // a plain cookie write isn't something the router's own cache invalidation
  // knows to react to.
  revalidatePath("/", "layout")
  redirect("/dashboard")
}

/** Closes the caller's own open diagnostic session and clears the cookie -- the banner's "Exit" action. */
export async function exitDiagnosticClub(sessionId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc("exit_diagnostic_club", { p_session_id: sessionId })

  const store = await cookies()
  store.delete(DIAGNOSTIC_SESSION_COOKIE)
  revalidatePath("/", "layout")
  redirect("/dashboard")
}
