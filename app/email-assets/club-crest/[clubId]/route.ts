import { NextResponse } from "next/server"

import { resolveClubLogoPath } from "@/lib/app-context/club-logo"
import { createClient } from "@/lib/supabase/server"

/**
 * Serves ONE club's crest into Ovalball emails -- see lib/email/club-crest.ts
 * for why this exists separately from the in-app logo URL, and see
 * app/email-assets/[asset]/route.ts (the brand logo) for the sibling this
 * mirrors: public by design, permanent by path, proxied so every email image
 * still resolves to Ovalball's own origin.
 *
 * THE CONTENT-TYPE GATE IS THE WHOLE POINT OF THIS BEING A ROUTE
 *
 * The club-logos bucket allows SVG, correctly, for the in-app Club Settings
 * page a browser renders as HTML. An email is not that context: SVG is a
 * script-bearing document no mail client should be asked to parse, so this
 * route is the seam that refuses to forward one into a message, regardless
 * of what a club has legitimately uploaded for its own website use.
 *
 * A club with no logo, or whose logo fails this gate, gets a 404 -- not a
 * bundled fallback image the way the Ovalball brand mark has one. There is
 * no correct placeholder for a specific club's crest, so the caller is
 * expected to have already checked (resolveClubCrestEmailUrl) before ever
 * emitting this URL into a template; clubIdentity() only renders an <img> at
 * all when it was given a real one.
 */

const SAFE_EMAIL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

export async function GET(_request: Request, { params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params
  const supabase = await createClient()

  // RLS already scopes this to an ACTIVE club (clubs_select), the same
  // public-directory boundary /club/[slug] uses -- no new authorization
  // logic, and a suspended/inactive club's crest is not served.
  const { data: club } = await supabase
    .from("clubs")
    .select("logo_storage_path, club_directory(logo_storage_path)")
    .eq("id", clubId)
    .maybeSingle()

  const path = club ? resolveClubLogoPath(club) : null
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data, error } = await supabase.storage.from("club-logos").download(path)
  if (error || !data) return new NextResponse("Not found", { status: 404 })

  if (!SAFE_EMAIL_IMAGE_TYPES.has(data.type)) {
    // A club's own crest is legitimately an SVG uploaded for the website.
    // Refusing to forward it here is the trust boundary, not a bug to work
    // around -- there is no email-safe way to serve this file.
    return new NextResponse("Not found", { status: 404 })
  }

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": data.type,
      "Cache-Control": CACHE_CONTROL,
      ETag: `W/"${path}"`,
    },
  })
}
