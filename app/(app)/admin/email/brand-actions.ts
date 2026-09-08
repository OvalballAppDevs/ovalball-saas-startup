"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { EMAIL_BRAND_BUCKET, listBrandImages } from "@/lib/email/brand"
import { createClient } from "@/lib/supabase/server"

export type BrandActionResult = { ok: true } | { ok: false; error: string }

/**
 * THE IMAGE LIBRARY FOR EMAIL.
 *
 * An administrator uploads a file and then CHOOSES one of the uploaded files.
 * At no point is there a field in which to type an address, which is the
 * whole design: the logo sits at the top of a correctly branded, correctly
 * authenticated email arriving from a domain the recipient already trusts, and
 * a free-text URL there would let whoever controls it point every one of those
 * emails at a host they own.
 *
 * What is stored is a PATH inside one known bucket. What recipients receive is
 * a URL on Ovalball's own origin that never names a file.
 */
async function authorise() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const active = await requireActiveSiteAdmin(supabase, user)
  if (!active.ok) {
    return { ok: false as const, error: "Site Admin access is required, in an active Site Admin context." }
  }
  if (active.ctx.siteAdminRole !== "full") {
    return { ok: false as const, error: "Only a Full Site Admin may change Ovalball's email branding." }
  }
  return { ok: true as const, supabase }
}

/**
 * What an email client will actually render.
 *
 * PNG, JPEG and WebP only. SVG is excluded on purpose: it is a script-bearing
 * document, no mail client renders it dependably, and accepting one would add
 * a stored-cross-site-scripting surface to buy a format that cannot be used.
 * The bucket enforces the same list, so this is the courteous error rather
 * than the control.
 */
const ACCEPTED = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
])

/** 1.5 MiB, matching the bucket's own limit -- see the email-brand bucket. */
const MAX_BYTES = 1_572_864

export async function uploadBrandImage(form: FormData): Promise<BrandActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." }
  }

  const extension = ACCEPTED.get(file.type)
  if (!extension) {
    return { ok: false, error: "Email supports PNG, JPEG and WebP images. Other formats do not render reliably in email." }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That image is larger than 1.5 MB. A large logo is slow to load in an inbox and often gets stripped." }
  }

  // The stored name is generated, never taken from the upload. A filename is
  // attacker-controlled text, and it would otherwise end up in a storage path
  // that policies are keyed on.
  const name = `logos/${crypto.randomUUID()}.${extension}`

  const { error } = await auth.supabase.storage
    .from(EMAIL_BRAND_BUCKET)
    .upload(name, file, { contentType: file.type, upsert: false })

  if (error) {
    console.error(`[email-brand] upload failed: ${error.message}`)
    return { ok: false, error: "That image could not be uploaded. Please try again." }
  }

  revalidatePath("/admin/email")
  return { ok: true }
}

/** Points every transactional email at one of the uploaded images. */
export async function selectBrandImage(path: string, expectedLock: number): Promise<BrandActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("set_email_brand_logo", {
    p_path: path,
    p_expected_lock: expectedLock,
  })
  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath("/admin/email")
  return { ok: true }
}

/** Goes back to the logo that ships with Ovalball. Uploads are kept. */
export async function restoreBundledLogo(expectedLock: number): Promise<BrandActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("clear_email_brand_logo", {
    p_expected_lock: expectedLock,
  })
  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath("/admin/email")
  return { ok: true }
}

/**
 * Removes an uploaded image from the library.
 *
 * Refuses to delete the one currently in use. Deleting it would not break the
 * emails already sent -- the route falls back to the bundled logo -- but it
 * would silently change the branding on everything sent afterwards, which is
 * not what "tidy up the library" should mean.
 */
export async function deleteBrandImage(path: string): Promise<BrandActionResult> {
  const auth = await authorise()
  if (!auth.ok) return auth

  const { data: settings } = await auth.supabase
    .from("email_brand_settings")
    .select("active_logo_path")
    .eq("id", "brand")
    .maybeSingle()

  if (settings?.active_logo_path === path) {
    return {
      ok: false,
      error: "This image is the one currently on every Ovalball email. Choose another, or restore Ovalball's own logo, before deleting it.",
    }
  }

  const { error } = await auth.supabase.storage.from(EMAIL_BRAND_BUCKET).remove([path])
  if (error) {
    console.error(`[email-brand] delete failed: ${error.message}`)
    return { ok: false, error: "That image could not be removed. Please try again." }
  }

  revalidatePath("/admin/email")
  return { ok: true }
}

/** The library, for the picker. */
export async function readBrandLibrary() {
  const auth = await authorise()
  if (!auth.ok) return []
  return listBrandImages(auth.supabase)
}

const REGISTRY_REFUSALS = [
  "The email logo has been changed by someone else since you opened this page. Reload to see the current version.",
  "That image is no longer in Ovalball's email library.",
  "Choose an image, or restore Ovalball's own logo.",
  "Only a Full Site Admin may change Ovalball's email configuration.",
]

function toPublicError(message: string): string {
  const refusal = REGISTRY_REFUSALS.find((known) => message.includes(known))
  if (refusal) return refusal
  console.error(`[email-brand] ${message}`)
  return "That change could not be saved. Please try again."
}
