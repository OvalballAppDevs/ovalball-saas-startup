import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveParticipantIdentities } from "./resolve-identities"
import type { ThreadMessage } from "./messenger-thread-types"
import type { Database } from "./database"

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

/**
 * How many messages a caller asking for "a page" gets.
 *
 * A phone must not pull a season of a club's conversation onto the device to show the last six
 * messages, and the web has never needed to say so because a browser reads a whole thread once. The
 * number lives here so both clients page the same way when they page at all.
 */
export const THREAD_PAGE_SIZE = 40

/**
 * A row as `MESSAGE_SELECT` returns it, inferred from a query built exactly as the readers build
 * theirs -- so a change to the select is a compile error here rather than a shape that quietly
 * disagrees. Never executed; only its type is used.
 */
function messagesQuery(supabase: SupabaseClient<Database>) {
  return supabase.from("fixture_messages").select(MESSAGE_SELECT)
}
type MessageRow = NonNullable<Awaited<ReturnType<ReturnType<typeof messagesQuery>["eq"]>>["data"]>[number]

export interface ThreadPageOptions {
  /** Newest `limit` messages. Omitted entirely, the whole thread is read -- the web's behaviour, unchanged. */
  limit?: number
  /** Read messages strictly OLDER than this ISO timestamp. The cursor is a time, not an offset. */
  before?: string | null
}

export async function loadThreadMessages(
  supabase: SupabaseClient<Database>,
  userId: string,
  scope: ThreadScope,
  page?: ThreadPageOptions
): Promise<ThreadMessage[]> {
  // A TIME CURSOR, NOT AN OFFSET. An offset shifts under you the moment somebody sends a message
  // while you are reading history, and the shift is silent: a message is skipped or repeated. Paging
  // from a timestamp is stable whatever arrives.
  //
  // Paged reads come back NEWEST-FIRST because that is the page you want -- the most recent forty --
  // and are then returned in the reader's usual ascending order, so no caller has to know which way
  // the query ran.
  if (page?.limit) {
    let query = messagesQuery(supabase)
      .eq(scope.key.column, scope.key.value)
      .order("created_at", { ascending: false })
      .limit(page.limit)
    if (page.before) query = query.lt("created_at", page.before)
    const { data: pageRows } = await query
    return buildMessages(supabase, userId, scope, [...(pageRows ?? [])].reverse())
  }

  const { data: rows } = await messagesQuery(supabase)
    .eq(scope.key.column, scope.key.value)
    .order("created_at", { ascending: true })

  return buildMessages(supabase, userId, scope, rows ?? [])
}

/**
 * ONE SHAPING STEP FOR BOTH READS.
 *
 * The whole-thread read and the paged read differ only in which rows they fetch; everything after
 * that -- resolving identities, applying the tombstone, normalising an image's missing body -- has to
 * be identical, or a paged message would render differently from the same message read unpaged.
 */
async function buildMessages(
  supabase: SupabaseClient<Database>,
  userId: string,
  scope: ThreadScope,
  rows: MessageRow[]
): Promise<ThreadMessage[]> {
  const messages = rows
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
