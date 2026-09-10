import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * The same as app/email-assets/club-crest/[clubId], for an OPPONENT that has
 * never claimed an Ovalball account -- see lib/email/club-crest.ts for why
 * this is a separate function/route rather than a second parameter on the
 * claimed-club one. RLS scopes this to an active, public Club Directory
 * entry (club_directory_select), the same boundary the public directory
 * pages already use.
 */

const SAFE_EMAIL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

export async function GET(_request: Request, { params }: { params: Promise<{ directoryId: string }> }) {
  const { directoryId } = await params
  const supabase = await createClient()

  const { data: directory } = await supabase
    .from("club_directory")
    .select("logo_storage_path")
    .eq("id", directoryId)
    .maybeSingle()

  const path = directory?.logo_storage_path ?? null
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data, error } = await supabase.storage.from("club-logos").download(path)
  if (error || !data) return new NextResponse("Not found", { status: 404 })

  if (!SAFE_EMAIL_IMAGE_TYPES.has(data.type)) {
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
