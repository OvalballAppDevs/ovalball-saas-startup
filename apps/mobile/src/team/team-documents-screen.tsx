import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import * as DocumentPicker from "expo-document-picker"

import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import {
  addTeamDocument,
  deleteTeamDocument,
  isTeamDocumentAuthorityError,
  readTeamDocuments,
  teamDocumentErrorMessage,
  TEAM_DOCUMENT_ALLOWED_MIME_TYPES,
  TEAM_DOCUMENT_MAX_SIZE_BYTES,
  type TeamDocumentItem,
} from "@ovalball/contracts/team/documents"

import { supabase } from "../auth/supabase"
import { readableSize } from "../messages/documents"
import { readFileBytes } from "../messages/pickers"
import { openAttachment } from "../messages/open-attachment"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { BottomSheet } from "../components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { CircleX, Ellipsis, FileText, Image as ImageIcon, Plus } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * TEAM DOCUMENTS -- Team Profile Section 7, presenting the SAME canonical Club Document Library rows
 * Club Documents shows for this team, never a second document store or a set of fake seeded cards.
 * `readTeamDocuments` refuses outright (42501) for a viewer with no authority at all, which this screen
 * treats as a distinct state from a genuinely empty, authorised team ("No documents shared with you" vs
 * "No team documents yet") -- the same distinction `team-gallery-screen.tsx` already draws for photos,
 * so a restricted viewer's document COUNT never leaks whether hidden documents exist.
 */
export function TeamDocumentsScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [documents, setDocuments] = useState<TeamDocumentItem[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [manageId, setManageId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openFailure, setOpenFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    setOpenFailure(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      const profile = await loadTeamProfile(supabase, id.clubId, teamId, id.rugbyCode)
      setCanManage(profile.canEditCover)
      setDocuments(await readTeamDocuments(supabase, teamId))
      setRefused(false)
    } catch (caught) {
      if (isTeamDocumentAuthorityError(caught)) {
        setRefused(true)
        setDocuments([])
        return
      }
      const failure = friendly(caught, "this team's documents")
      logDetail("team documents", failure)
      setProblem(failure.message)
    }
  }, [teamId])

  useEffect(() => {
    setIdentity(null)
    setDocuments(null)
    void load()
  }, [load])
  useFocusEffect(useCallback(() => { void load() }, [load]))

  const managing = manageId ? (documents ?? []).find((d) => d.id === manageId) ?? null : null

  async function open(item: TeamDocumentItem) {
    if (openingId) return
    setOpenFailure(null)
    setOpeningId(item.id)
    const result = await openAttachment({ id: item.id, filename: item.originalFilename, mimeType: item.mimeType, signedUrl: item.url })
    setOpeningId(null)
    if (!result.ok) setOpenFailure(result.message)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Documents" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : documents === null ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {!!openFailure && <ErrorState message={openFailure} />}
          {documents.length === 0 ? (
            refused ? (
              <EmptyState title="No documents shared with you" body="You don't currently have access to this team's documents." icon={<FileText size={22} color={colour.inkSubtle} />} />
            ) : (
              <EmptyState title="No team documents yet" body="Documents shared with this team will appear here." icon={<FileText size={22} color={colour.inkSubtle} />} />
            )
          ) : (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
              {documents.map((item, index) => (
                <DocumentRow
                  key={item.id}
                  item={item}
                  first={index === 0}
                  busy={openingId === item.id}
                  onPress={() => void open(item)}
                  onManage={canManage ? () => setManageId(item.id) : undefined}
                />
              ))}
            </View>
          )}
          {canManage && <Button label="Add Document" onPress={() => setAddOpen(true)} />}
        </ScrollView>
      )}

      {managing && (
        <ManageDocumentSheet
          item={managing}
          onClose={() => setManageId(null)}
          onDeleted={() => {
            setManageId(null)
            void load()
          }}
        />
      )}

      {addOpen && identity && (
        <AddDocumentSheet
          clubId={identity.clubId}
          teamId={teamId}
          onClose={() => setAddOpen(false)}
          onAdded={() => void load()}
        />
      )}
    </View>
  )
}

/** File-type icon and label, matching the message-attachment row's own restraint: one icon for an
 * image, one shared FileText icon for everything else -- never a bespoke icon per document type. */
function fileKind(mimeType: string): { icon: "image" | "file"; label: string } {
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") return { icon: "image", label: "Image" }
  if (mimeType === "application/pdf") return { icon: "file", label: "PDF" }
  if (mimeType === "application/msword" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return { icon: "file", label: "Word Document" }
  return { icon: "file", label: "Document" }
}

function DocumentRow({
  item,
  first,
  busy,
  onPress,
  onManage,
}: {
  item: TeamDocumentItem
  first: boolean
  busy: boolean
  onPress: () => void
  onManage?: () => void
}) {
  const kind = fileKind(item.mimeType)
  const size = readableSize(item.sizeBytes)
  const metaLine = [kind.label, size].filter(Boolean).join(" · ")

  // A PLAIN VIEW, NOT AN OUTER PRESSABLE -- two sibling Pressables (open, manage), never one nested
  // inside the other. A Pressable that carries its own accessibilityLabel implicitly becomes an opaque
  // accessible element, which swallowed the ellipsis button's own label/role entirely (found live, by
  // accessibility-tree inspection: "Manage {title}" never appeared as its own element, only the row's
  // combined label did) -- a screen reader user could never reach Manage independently.
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: TOUCH_TARGET + 16,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${metaLine}`}
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, minWidth: 0, opacity: pressed || busy ? 0.6 : 1 })}
      >
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
          {kind.icon === "image" ? <ImageIcon size={18} color={colour.forest800} /> : <FileText size={18} color={colour.forest800} />}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>{item.title}</Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{metaLine}</Text>
        </View>
      </Pressable>
      {onManage ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${item.title}`} onPress={onManage} hitSlop={10} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
          <Ellipsis size={18} color={colour.inkSubtle} />
        </Pressable>
      ) : null}
    </View>
  )
}

function ManageDocumentSheet({ item, onClose, onDeleted }: { item: TeamDocumentItem; onClose: () => void; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setProblem(null)
    const result = await deleteTeamDocument(supabase, item.id, item.storagePath)
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onDeleted()
  }

  return (
    <BottomSheet visible onClose={onClose} title="Manage Document">
      <View style={{ gap: space.md }}>
        <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>{item.title}</Text>
        {!confirmDelete ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.title} from this team's documents`} onPress={() => setConfirmDelete(true)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <CircleX size={18} color={colour.danger} />
            <Text style={[type.small, { color: colour.danger }]}>Delete Document</Text>
          </Pressable>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>Delete '{item.title}' from this team's documents? This can't be undone.</Text>
            {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
            <Button label="Delete Document" variant="danger" onPress={remove} busy={busy} />
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

type AddStep = "method" | "review"

function AddDocumentSheet({ clubId, teamId, onClose, onAdded }: { clubId: string; teamId: string; onClose: () => void; onAdded: () => void }) {
  const [step, setStep] = useState<AddStep>("method")
  const [picked, setPicked] = useState<{ uri: string; mimeType: string; name: string; sizeBytes: number } | null>(null)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [addedCount, setAddedCount] = useState(0)

  async function pick() {
    setProblem(null)
    let result: DocumentPicker.DocumentPickerResult
    try {
      result = await DocumentPicker.getDocumentAsync({ type: [...TEAM_DOCUMENT_ALLOWED_MIME_TYPES], copyToCacheDirectory: true, multiple: false })
    } catch {
      setProblem("That file couldn't be opened. Try again.")
      return
    }
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    if (!asset.mimeType || !(TEAM_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(asset.mimeType)) {
      setProblem("Use a PDF, Word document or image.")
      return
    }
    if (!asset.size || asset.size > TEAM_DOCUMENT_MAX_SIZE_BYTES) {
      setProblem("That file is too large -- documents are limited to 10MB.")
      return
    }
    setPicked({ uri: asset.uri, mimeType: asset.mimeType, name: asset.name, sizeBytes: asset.size })
    setTitle(asset.name.replace(/\.[A-Za-z0-9]{1,8}$/, ""))
    setStep("review")
  }

  async function confirmAdd() {
    if (!picked) return
    setBusy(true)
    setProblem(null)
    const bytes = await readFileBytes(picked.uri)
    if (!bytes) {
      setBusy(false)
      setProblem("That file couldn't be read. Try choosing it again.")
      return
    }
    const result = await addTeamDocument(
      supabase,
      clubId,
      teamId,
      { bytes, contentType: picked.mimeType, originalFilename: picked.name, sizeBytes: picked.sizeBytes },
      title.trim() || picked.name
    )
    setBusy(false)
    if (!result.ok) {
      setProblem(teamDocumentErrorMessage(result, result.message))
      return
    }
    setAddedCount((n) => n + 1)
    onAdded()
    setPicked(null)
    setTitle("")
    setStep("method")
  }

  return (
    <BottomSheet visible onClose={onClose} title="Add Document">
      {step === "method" && (
        <View style={{ gap: space.md }}>
          {addedCount > 0 && <Text style={[type.small, { color: colour.forest800 }]}>{addedCount} document{addedCount === 1 ? "" : "s"} added.</Text>}
          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a file to add to this team's documents" onPress={() => void pick()} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Plus size={20} color={colour.ink} />
            <Text style={[type.small, { color: colour.ink }]}>Choose File</Text>
          </Pressable>
        </View>
      )}

      {step === "review" && picked && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <FileText size={20} color={colour.forest800} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{picked.name}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{readableSize(picked.sizeBytes)}</Text>
            </View>
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>Title</Text>
            <TitleField value={title} onChange={setTitle} />
          </View>
          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button label="Add Document" onPress={confirmAdd} busy={busy} disabled={!title.trim()} />
          <Button label="Choose a Different File" variant="secondary" onPress={() => { setPicked(null); setTitle(""); setStep("method") }} disabled={busy} />
        </View>
      )}
    </BottomSheet>
  )
}

/** A plain, governed text field for the one editable field in this sheet -- no shared TextField
 * component exists for a single-line title in this codebase's team screens, so this mirrors the
 * TextInput styling `edit-description-sheet.tsx` already uses for its own single field. */
function TitleField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Document title"
      placeholderTextColor={colour.inkSubtle}
      accessibilityLabel="Document title"
      style={{
        minHeight: TOUCH_TARGET,
        borderWidth: 1,
        borderColor: colour.line,
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        color: colour.ink,
        fontSize: 15,
      }}
    />
  )
}
