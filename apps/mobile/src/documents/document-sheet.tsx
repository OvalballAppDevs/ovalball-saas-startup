import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import {
  deleteClubDocument,
  folderPaths,
  moveClubDocument,
  setDocumentArchived,
  shareCountLabel,
  type LibraryDocument,
  type LibraryFolder,
} from "@ovalball/contracts/documents/library"

import { supabase } from "../auth/supabase"
import { BottomSheet } from "../components/bottom-sheet"
import { Button } from "../components/ui"
import { Archive, ArchiveRestore, CircleX, Eye, Folder } from "../components/icons"
import { Notice } from "../admin/chips"
import { TOUCH_TARGET, colour, space, type } from "../design/tokens"
import { RadioList, documentMetaLine } from "./shared"

/**
 * WHAT CAN BE DONE WITH ONE DOCUMENT.
 *
 * Everybody who can see it can open it -- which, through the system's own document sheet, is also how it
 * is shared or saved to Files. The rest is offered only where `club.documents.manage` says so, and every
 * one of those writes is judged again by the server.
 *
 * DELETE IS PERMANENT AND SAYS SO. `delete_club_document` refuses a document that has been shared into a
 * conversation -- the person who received it still needs to open it -- so the sheet explains that before
 * anybody tries, and offers Archive instead.
 */
type Step = "actions" | "move" | "delete"

export function DocumentSheet({
  doc,
  clubId,
  canManage,
  folders,
  opening,
  onOpen,
  onClose,
  onChanged,
}: {
  doc: LibraryDocument
  clubId: string
  canManage: boolean
  folders: LibraryFolder[]
  opening: boolean
  onOpen: () => void
  onClose: () => void
  /** After a change has been made: the message to show and whether the library must re-read. */
  onChanged: (message: string) => void
}) {
  const [step, setStep] = useState<Step>("actions")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [destination, setDestination] = useState<string>(doc.folderId ?? "")
  const shared = shareCountLabel(doc.shareCount)
  const archived = !!doc.archivedAt
  // A team's document lives under its team, never also in a general folder (`club_documents_team_xor_folder`).
  const movable = !archived && !doc.teamId

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    setBusy(true)
    setProblem(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onChanged(done)
  }

  const title = step === "move" ? "Move to Folder" : step === "delete" ? "Delete Document" : "Document"

  return (
    <BottomSheet visible onClose={onClose} title={title} cancelLabel={step === "actions" ? "Close" : "Cancel"}>
      <View style={{ gap: 2 }}>
        <Text numberOfLines={3} style={[type.bodyMedium, { color: colour.ink }]}>
          {doc.title}
        </Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{documentMetaLine(doc)}</Text>
        {!!shared && <Text style={[type.caption, { color: colour.inkMuted }]}>{shared}</Text>}
        {step === "actions" && !!doc.description && <Text style={[type.small, { color: colour.inkMuted, marginTop: space.xs }]}>{doc.description}</Text>}
      </View>

      {!!problem && <Notice tone="error" text={problem} />}

      {step === "actions" && (
        <View>
          <ActionLine icon={<Eye size={20} color={colour.forest800} />} label={opening ? "Opening…" : "Open"} caption="Preview it, share it or save it to Files." disabled={opening} onPress={onOpen} />
          {canManage && movable && (
            <ActionLine icon={<Folder size={20} color={colour.forest800} />} label="Move to Folder" caption="File it somewhere else in the library." onPress={() => { setProblem(null); setStep("move") }} />
          )}
          {canManage && (
            archived ? (
              <ActionLine
                icon={<ArchiveRestore size={20} color={colour.forest800} />}
                label="Restore"
                caption="Put it back in the library where it was."
                disabled={busy}
                onPress={() => void run(() => setDocumentArchived(supabase, clubId, doc.id, false), "Document restored.")}
              />
            ) : (
              <ActionLine
                icon={<Archive size={20} color={colour.forest800} />}
                label="Archive"
                caption="Take it out of the library without deleting it. It can be restored."
                disabled={busy}
                onPress={() => void run(() => setDocumentArchived(supabase, clubId, doc.id, true), "Document archived.")}
              />
            )
          )}
          {canManage && (
            <ActionLine icon={<CircleX size={20} color={colour.danger} />} label="Delete Document" danger onPress={() => { setProblem(null); setStep("delete") }} />
          )}
        </View>
      )}

      {step === "move" && (
        <View style={{ gap: space.md }}>
          <ScrollView style={{ maxHeight: 300 }}>
            <RadioList
              label="Folder"
              value={destination}
              onChange={setDestination}
              options={[{ key: "", label: "Club Documents (Top Level)" }, ...folderPaths(folders).map((f) => ({ key: f.id, label: f.path }))]}
            />
          </ScrollView>
          <Button
            label="Move Document"
            variant="brand"
            busy={busy}
            disabled={destination === (doc.folderId ?? "")}
            onPress={() => void run(() => moveClubDocument(supabase, clubId, doc.id, destination || null), "Document moved.")}
          />
        </View>
      )}

      {step === "delete" && (
        <View style={{ gap: space.md }}>
          {doc.shareCount > 0 ? (
            <>
              <Text style={[type.small, { color: colour.ink }]}>
                This document has been shared into a conversation, so it can't be permanently deleted. The people it was shared with still need to open it. Archive it instead to take it out of the library.
              </Text>
              {!archived && <Button label="Archive Instead" variant="brand" busy={busy} onPress={() => void run(() => setDocumentArchived(supabase, clubId, doc.id, true), "Document archived.")} />}
            </>
          ) : (
            <>
              <Text style={[type.small, { color: colour.ink }]}>
                This permanently deletes the document and its file. It can't be undone. A document that has been shared into a conversation can't be deleted; archive it instead.
              </Text>
              <Button label="Delete Permanently" variant="danger" busy={busy} onPress={() => void run(() => deleteClubDocument(supabase, doc.id, doc.storagePath), "Document deleted.")} />
              {!archived && <Button label="Archive Instead" variant="secondary" disabled={busy} onPress={() => void run(() => setDocumentArchived(supabase, clubId, doc.id, true), "Document archived.")} />}
            </>
          )}
        </View>
      )}
    </BottomSheet>
  )
}

function ActionLine({
  icon,
  label,
  caption,
  onPress,
  disabled = false,
  danger = false,
}: {
  icon: React.ReactNode
  label: string
  caption?: string
  onPress: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}. ${caption}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: disabled ? 0.55 : pressed ? 0.7 : 1 })}
    >
      <View accessible={false}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: danger ? colour.danger : colour.ink }]}>{label}</Text>
        {!!caption && <Text style={[type.caption, { color: colour.inkMuted }]}>{caption}</Text>}
      </View>
    </Pressable>
  )
}
