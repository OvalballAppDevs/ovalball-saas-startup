import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"

import { EMAIL_BRAND_BUCKET, readActiveLogoPath } from "@/lib/email/brand"
import { createClient } from "@/lib/supabase/server"

/**
 * Serves the brand images that appear inside Ovalball emails.
 *
 * WHY AN EMAIL IMAGE IS PROXIED RATHER THAN LINKED
 *
 * Every href and img src in an Ovalball email resolves to Ovalball's own
 * origin. That is not decoration: it is what stops a trusted, correctly
 * authenticated email from ever pointing somewhere Ovalball does not control.
 * Linking storage directly would put the object store's domain into the mail
 * and quietly end that guarantee.
 *
 * It also makes the URL permanent. An email references /email-assets/logo.png
 * and nothing else, so changing the logo changes what this route serves rather
 * than invalidating every message already sitting in somebody's inbox.
 *
 * PUBLIC BY DESIGN. Recipients are not signed in, and a mail client fetches
 * images with no session at all -- so this must answer an anonymous request.
 * There is nothing here to protect: it returns a logo. What is protected is
 * WHICH logo, and that is decided by an authority-checked function elsewhere.
 */

/** Only these names resolve. An open proxy over a bucket is a file server. */
const ASSETS: Record<string, { kind: "logo" }> = {
  "logo.png": { kind: "logo" },
}

/**
 * An hour, then revalidate.
 *
 * This was a week, which was wrong in a way that only showed up once the logo
 * actually changed: the new image was served correctly and nothing that had
 * already fetched the old one asked again, so a change reached nobody for
 * seven days. A logo is a few hundred kilobytes fetched rarely -- there is
 * almost nothing to win by caching it hard, and a brand change that does not
 * appear is a real cost.
 *
 * The ETag is what makes the shorter window cheap: a revalidation that has not
 * changed costs a 304 and no bytes. Query-string busting is deliberately not
 * used, because the URL's permanence is what keeps already-sent email working.
 */
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

/** Changes when, and only when, the chosen image does. */
function etagFor(activePath: string | null): string {
  return `W/"${activePath ?? "bundled"}"`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> }
) {
  const { asset } = await params
  if (!ASSETS[asset]) {
    return new NextResponse("Not found", { status: 404 })
  }

  const supabase = await createClient()

  // A failure here must never mean "no logo". Every branch below falls back to
  // the file committed in the repository, because an email that renders with
  // Ovalball's own logo is a correct email, and one with a broken image icon
  // reads as a broken product.
  try {
    const activePath = await readActiveLogoPath(supabase)

    if (activePath) {
      const etag = etagFor(activePath)
      if (request.headers.get("if-none-match") === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE_CONTROL } })
      }

      const { data, error } = await supabase.storage.from(EMAIL_BRAND_BUCKET).download(activePath)
      if (!error && data) {
        return new NextResponse(await data.arrayBuffer(), {
          status: 200,
          headers: {
            "Content-Type": data.type || "image/png",
            "Cache-Control": CACHE_CONTROL,
            ETag: etag,
          },
        })
      }
      console.error(`[email-assets] chosen brand image "${activePath}" could not be read; serving the bundled logo instead.`)
    }
  } catch (error) {
    console.error(`[email-assets] brand lookup failed; serving the bundled logo instead:`, error)
  }

  // The path segments are literals rather than the BUNDLED_LOGO_FILE constant
  // on purpose: an imported value here makes the bundler trace the entire
  // project looking for what the path might resolve to. A test asserts this
  // stays equal to the constant, so the two cannot drift apart quietly.
  const bundled = await readFile(join(process.cwd(), "public", "email", "ovalball-logo.png"))
  return new NextResponse(new Uint8Array(bundled), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL, ETag: etagFor(null) },
  })
}
