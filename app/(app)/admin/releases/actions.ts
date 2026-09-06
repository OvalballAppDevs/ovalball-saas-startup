"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export type PlatformActionResult = { ok: true } | { ok: false; error: string }

/**
 * Both writes on this page are gated by `site.system.*`. A Full Site Admin
 * holds them; a narrow Site Admin needs the explicit grant from Site Admin
 * Management. Checked here for a readable error, and again by the RPC
 * itself, which is the real boundary.
 */
async function requireSystemCapability(
  supabase: Awaited<ReturnType<typeof createClient>>,
  capability: "site.system.beta.manage" | "site.system.release.manage"
): Promise<PlatformActionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) {
    return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }
  }

  if (!(await hasCapability(supabase, capability, "site"))) {
    return {
      ok: false,
      error:
        "You do not have platform system access. Ask a Full Site Admin to grant it from Site Admin Management.",
    }
  }
  return { ok: true }
}

/**
 * Switching between Beta and Live. The reason is required, not optional:
 * the mode history is append-only and the reason is the only thing in it
 * that will explain the decision to whoever reads it in a year.
 */
export async function setPlatformMode(input: {
  mode: "beta" | "live"
  reason: string
  releaseId?: string | null
}): Promise<PlatformActionResult> {
  const supabase = await createClient()

  const allowed = await requireSystemCapability(supabase, "site.system.beta.manage")
  if (!allowed.ok) return allowed

  const reason = input.reason.trim()
  if (reason.length < 10) {
    return { ok: false, error: "Give a reason of at least ten characters. It is the record of why this happened." }
  }

  const { error } = await supabase.rpc("set_platform_mode", {
    p_mode: input.mode,
    p_reason: reason,
    p_release_id: input.releaseId ?? undefined,
  })

  if (error) {
    console.error("set_platform_mode failed:", error)
    return { ok: false, error: "The platform mode could not be changed. Nothing was recorded." }
  }

  revalidatePath("/admin/releases")
  revalidatePath("/admin/commercial")
  return { ok: true }
}

export async function recordRelease(input: {
  version: string
  buildSha: string
  title: string
  notes: string
  publish: boolean
}): Promise<PlatformActionResult> {
  const supabase = await createClient()

  const allowed = await requireSystemCapability(supabase, "site.system.release.manage")
  if (!allowed.ok) return allowed

  const version = input.version.trim()
  if (!version) return { ok: false, error: "A release needs a version." }

  const { error } = await supabase.rpc("record_platform_release", {
    p_version: version,
    p_build_sha: input.buildSha.trim() || undefined,
    p_title: input.title.trim() || undefined,
    p_notes: input.notes.trim() || undefined,
    p_channel: "production",
    p_publish: input.publish,
  })

  if (error) {
    console.error("record_platform_release failed:", error)
    // The one failure worth naming precisely, because the fix is obvious.
    if (error.code === "23505") {
      return { ok: false, error: `Version ${version} has already been recorded.` }
    }
    return { ok: false, error: "The release could not be recorded." }
  }

  revalidatePath("/admin/releases")
  return { ok: true }
}

/**
 * Publishing makes the release notes readable by everyone, including
 * signed-out visitors. Unpublishing takes them back to draft; it never
 * deletes the release, because release history is not tidied away.
 */
export async function setReleasePublished(input: {
  releaseId: string
  published: boolean
}): Promise<PlatformActionResult> {
  const supabase = await createClient()

  const allowed = await requireSystemCapability(supabase, "site.system.release.manage")
  if (!allowed.ok) return allowed

  const { error } = await supabase
    .from("platform_releases")
    .update({ status: input.published ? "published" : "draft" })
    .eq("id", input.releaseId)

  if (error) {
    console.error("release publish toggle failed:", error)
    return { ok: false, error: "The release could not be updated." }
  }

  revalidatePath("/admin/releases")
  return { ok: true }
}
