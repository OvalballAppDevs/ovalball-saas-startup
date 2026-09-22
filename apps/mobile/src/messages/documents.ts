import type { SupabaseClient } from "@supabase/supabase-js"
import { DIRECT_SHAREABLE_DOCUMENT_CATEGORIES, type Database } from "@ovalball/contracts"

import { messageTarget, type AttachableKind } from "./attachments"

/**
 * OVALBALL'S OWN DOCUMENTS, SEARCHED WHERE THEY LIVE.
 *
 * NOT THE FILES APP. A coach arranging an away fixture wants the club's Visitor Guide, which is
 * already in Ovalball; making them find a copy on their phone would be a different and worse product.
 *
 * THE SERVER SCOPES THIS, NOT THE QUERY. `club_documents` carries RLS -- `club_documents_select_owner`
 * resolves through `internal.can_view_document_library`, which is site-capability or
 * `club.documents.view` at that club -- so this reads the table plainly and gets back exactly the
 * documents this identity may see. There is no club id filter here on purpose: adding one would look
 * like the authority and would be a second, weaker opinion beside the real one.
 *
 * ARCHIVED DOCUMENTS ARE EXCLUDED because `share_message_document` refuses them; offering one would
 * be offering something that cannot be sent. So are documents whose category makes them unshareable
 * into a DIRECT conversation -- `other` is the catch-all where an uncategorised committee paper sits.
 *
 * AND SHAREABILITY IS STILL THE SERVER'S. Being able to SEE a document is not being able to share it:
 * the share RPC additionally checks the club's `allow_document_library_sharing` policy. That refusal
 * is shown in the club's own words rather than pre-empted here, because this app does not hold a copy
 * of the policy.
 */

export interface ClubDocument {
  id: string
  title: string
  category: string | null
  filename: string | null
  mimeType: string | null
  sizeBytes: number | null
}

const PAGE = 25

export async function searchClubDocuments(
  supabase: SupabaseClient<Database>,
  search: string,
  /** The conversation these documents are being offered FOR, which narrows what may be offered. */
  kind: AttachableKind
): Promise<ClubDocument[]> {
  let query = supabase
    .from("club_documents")
    .select("id, title, category, original_filename, mime_type, size_bytes")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(PAGE)

  // NOT OFFERED IS BETTER THAN OFFERED AND REFUSED. A direct conversation is a different audience from
  // a fixture negotiation, so the server will refuse a document nobody categorised; filtering here in
  // the SAME LIST the server uses means the picker never invites somebody to try.
  if (messageTarget(kind) === "direct") {
    query = query.in("category", [...DIRECT_SHAREABLE_DOCUMENT_CATEGORIES])
  }

  const needle = search.trim()
  if (needle) {
    // Searched on the SERVER rather than by pulling a club's library onto the phone and filtering it.
    // Title and filename, because people remember a document by either.
    query = query.or(`title.ilike.%${needle}%,original_filename.ilike.%${needle}%`)
  }

  const { data } = await query
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  }))
}

/** "1.8 MB" — enough to tell two documents apart without turning the row into a file manager. */
export function readableSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
