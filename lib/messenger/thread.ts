import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveParticipantIdentities } from "@/lib/app-context/resolve-identities"
import type { ThreadMessage } from "@/lib/messenger/thread-types"
import type { Database } from "@/types/database.types"

/**
 * THE ONE READER FOR A CONVERSATION'S MESSAGES.
 *
 * Ovalball now opens a conversation in two places -- the compact Messenger
 * panel anchored to the global Messages control, and the /messages workspace
 * -- and they are two windows onto one conversation, not two conversations.
 * So there is one query, one privacy rule, one tombstone rule, one identity
 * resolution, and one shape.
 *
 * The alternative was letting the panel fetch its own messages, and that is
 * precisely how a second Messenger architecture starts: two queries drift,
 * and the one nobody is looking at is the one that forgets to hide a deleted
 * message or leaks a name.
 *
 * AUTHORISATION IS NOT DONE HERE, deliberately. Every read below goes through
 * the caller's own Supabase client under RLS -- can_access_fixture_conversation
 * and its siblings decide what comes back. This function shapes rows it was
 * allowed to see; it never widens them.
 */

// One literal string, deliberately not concatenated: the generated Supabase
// types are inferred from the select text itself, and a joined expression
// infers as `unknown` -- which silently removes every type guarantee this
// module is supposed to give its two callers.
const MESSAGE_SELECT =
  "id, body, sender_user_id, created_at, kind, deleted_at, deleted_by_role, fixture_message_attachments(id, storage_path, original_filename, mime_type, size_bytes), fixture_message_document_refs(document_id, club_documents(id, title, category, mime_type, size_bytes, original_filename, storage_path)), fixture_message_contact_cards(display_name_snapshot, role_snapshot, club_name_snapshot, team_name_snapshot, telephone_snapshot)"

export interface ThreadScope {
  /**
   * For a fixture or club thread this is the SHARED conversation_id -- both
   * mirror rows of one real fixture resolve to it. For a request thread there
   * is no mirror, so the request's own id is the key.
   */
  key: { column: "conversation_id" | "fixture_request_id"; value: string }
  /** The clubs party to this conversation, for scoping role labels. */
  clubIds: string[]
  teams: { id: string; displayName: string; clubName: string; clubId?: string }[]
}

export async function loadThreadMessages(
  supabase: SupabaseClient<Database>,
  userId: string,
  scope: ThreadScope
): Promise<ThreadMessage[]> {
  const { data: rows } = await supabase
    .from("fixture_messages")
    .select(MESSAGE_SELECT)
    .eq(scope.key.column, scope.key.value)
    .order("created_at", { ascending: true })

  const messages = rows ?? []
  const identities = await resolveParticipantIdentities(
    supabase,
    messages.map((m) => m.sender_user_id),
    scope.clubIds,
    scope.teams
  )

  return Promise.all(
    messages.map(async (m) => {
      const identity = identities.get(m.sender_user_id)
      const isOwn = m.sender_user_id === userId
      const isDeleted = Boolean(m.deleted_at)

      // THE TOMBSTONE REPLACES THE BODY HERE, once, for every surface. A
      // deleted message's original text is never handed to a renderer again;
      // it survives only in the raw row, for an authorised moderator querying
      // directly.
      // An image with no caption now legitimately has no body. Normalised to
      // an empty string once, here, so no renderer has to decide what null
      // means -- and an image bubble simply shows the picture.
      const body = isDeleted
        ? m.deleted_by_role === "moderator"
          ? "Message has been deleted by admin."
          : "Message has been deleted by user."
        : (m.body ?? "")

      const attachmentRow = m.fixture_message_attachments ?? null
      const attachment =
        attachmentRow && !isDeleted
          ? {
              id: attachmentRow.id,
              filename: attachmentRow.original_filename,
              mimeType: attachmentRow.mime_type,
              sizeBytes: attachmentRow.size_bytes,
              signedUrl:
                (await supabase.storage.from("fixture-attachments").createSignedUrl(attachmentRow.storage_path, 3600)).data
                  ?.signedUrl ?? null,
            }
          : null

      const doc = m.fixture_message_document_refs?.club_documents ?? null
      const documentShare =
        doc && !isDeleted
          ? {
              id: doc.id,
              title: doc.title,
              category: doc.category,
              filename: doc.original_filename,
              mimeType: doc.mime_type,
              sizeBytes: doc.size_bytes,
              signedUrl:
                (await supabase.storage.from("club-documents").createSignedUrl(doc.storage_path, 3600)).data?.signedUrl ?? null,
            }
          : null

      const cardRow = m.fixture_message_contact_cards ?? null
      const contactCard =
        cardRow && !isDeleted
          ? {
              displayName: cardRow.display_name_snapshot,
              roleLabel: cardRow.role_snapshot,
              clubName: cardRow.club_name_snapshot,
              teamName: cardRow.team_name_snapshot,
              telephone: cardRow.telephone_snapshot,
            }
          : null

      return {
        id: m.id,
        body,
        createdAt: m.created_at,
        isOwn,
        isSystemEvent: m.kind === "system_event",
        isDeleted,
        canDelete: isOwn && !isDeleted,
        canReport: !isOwn && !isDeleted && m.kind !== "system_event",
        senderName: identity?.name ?? "Ovalball user",
        senderRoleLabel: identity?.roleLabel ?? "Member",
        senderClubName: identity?.clubName ?? "Ovalball",
        senderAvatarUrl: identity?.avatarUrl ?? null,
        attachment,
        documentShare,
        contactCard,
      }
    })
  )
}
