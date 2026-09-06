"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type FixtureLifecycleResult = { ok: true } | { ok: false; error: string }

const SAFE_FIXTURE_LIFECYCLE_ERROR_PREFIXES = [
  "A reason is required",
  "You are not authorized",
  "Only this fixture's own Club Admin or Fixtures Secretary",
  "Fixture not found",
  "This fixture is already cancelled",
  "This fixture has been archived",
  "This fixture has already been deleted",
  "This fixture is not deleted",
]

function toPublicFixtureLifecycleError(message: string): string {
  if (SAFE_FIXTURE_LIFECYCLE_ERROR_PREFIXES.some((p) => message.startsWith(p))) return message
  console.error("Fixture lifecycle RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong. Please try again."
}

/** Section E: the safe, guided path to cancel a fixture -- same authority as every other fixture mutation, required reason, mirror-synced server-side. */
export async function cancelFixtureWithReason(fixtureId: string, reason: string): Promise<FixtureLifecycleResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_fixture", { p_fixture_id: fixtureId, p_reason: reason })
  if (error) return { ok: false, error: toPublicFixtureLifecycleError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

/** Section G: "Delete Fixture" -- archive/soft-delete, never a physical row delete. Narrower authority than cancel (owning club's own Club Admin/Fixtures Secretary only). */
export async function deleteFixtureWithReason(fixtureId: string, reason: string): Promise<FixtureLifecycleResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("archive_fixture", { p_fixture_id: fixtureId, p_reason: reason })
  if (error) return { ok: false, error: toPublicFixtureLifecycleError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  revalidatePath("/calendar/deleted-events")
  return { ok: true }
}

/** Section J: the minimal safe restore -- reverses archive_fixture() only, same authority boundary. Used from the Deleted Calendar Events archive. */
export async function restoreFixture(fixtureId: string): Promise<FixtureLifecycleResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_fixture", { p_fixture_id: fixtureId })
  if (error) return { ok: false, error: toPublicFixtureLifecycleError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  revalidatePath("/calendar/deleted-events")
  return { ok: true }
}
