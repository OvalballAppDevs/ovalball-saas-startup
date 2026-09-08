import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/** The bucket holding images a Site Admin has uploaded for use in email. */
export const EMAIL_BRAND_BUCKET = "email-brand"

/**
 * The logo shipped with the application.
 *
 * Served whenever no upload has been chosen, and the thing "Restore
 * Ovalball's logo" restores. Keeping a real file in the repository means the
 * email system has a correct logo on a brand-new database, in a test, and in
 * local development, without anybody having configured anything.
 */
export const BUNDLED_LOGO_FILE = "public/email/ovalball-logo.png"

export interface BrandLogoState {
  /** Storage path of the chosen upload, or null when the bundled logo is in use. */
  activePath: string | null
  lockVersion: number
}

/**
 * Reads which image is currently the logo.
 *
 * Deliberately NOT called by the renderer. The email shell references one
 * fixed Ovalball URL and never learns which file is behind it -- that is what
 * lets renderEmail stay synchronous, keeps every URL in an Ovalball email
 * pointing at Ovalball, and stops an email sent last year from breaking when
 * somebody changes the logo today.
 */
export async function readBrandLogoState(
  supabase: SupabaseClient<Database>
): Promise<BrandLogoState> {
  const { data } = await supabase
    .from("email_brand_settings")
    .select("active_logo_path, lock_version")
    .eq("id", "brand")
    .maybeSingle()

  return {
    activePath: data?.active_logo_path ?? null,
    lockVersion: data?.lock_version ?? 0,
  }
}

/**
 * The images available to choose from.
 *
 * Listed from the bucket rather than from a table: the bucket is the truth
 * about what exists, and a second list would eventually disagree with it --
 * showing an administrator an image that has been deleted, or hiding one that
 * has not.
 */
export async function listBrandImages(
  supabase: SupabaseClient<Database>
): Promise<Array<{ path: string; name: string; updatedAt: string | null; bytes: number | null; previewUrl: string }>> {
  const { data, error } = await supabase.storage.from(EMAIL_BRAND_BUCKET).list("logos", {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  })
  if (error || !data) return []

  return data
    // Supabase returns a placeholder row for an empty folder; it has no id.
    .filter((f) => f.id !== null)
    .map((f) => {
      const path = `logos/${f.name}`
      return {
        path,
        name: f.name,
        updatedAt: f.updated_at ?? null,
        bytes: (f.metadata as { size?: number } | null)?.size ?? null,
        // For the admin screen only. The origin rule this system enforces is
        // about what goes INTO an email; a thumbnail on a signed-in Site Admin
        // page is an ordinary web image and needs no proxy.
        previewUrl: supabase.storage.from(EMAIL_BRAND_BUCKET).getPublicUrl(path).data.publicUrl,
      }
    })
}
