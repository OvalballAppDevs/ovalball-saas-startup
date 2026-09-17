"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * Sign out from the suspended landing.
 *
 * Deliberately its own action rather than the one in `app/(app)/account/actions.ts`: that module
 * lives inside the authenticated application group, which is exactly the part of the product a
 * suspended person is being kept out of. Depending on it would mean the way out of the trap ran
 * through the trap.
 */
export async function signOutFromSuspended() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
