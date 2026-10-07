import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useRouter } from "expo-router"
import * as DocumentPicker from "expo-document-picker"
import {
  CLUB_DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_CATEGORY_OPTIONS,
  defaultDocumentTitle,
  documentFileKind,
  folderPaths,
  formatFileSize,
  readClubLibraryAuthority,
  readLibraryFolders,
  uploadClubDocument,
  validateClubDocumentFile,
  type LibraryFolder,
} from "@ovalball/contracts/documents/library"

import { supabase } from "../auth/supabase"
import { AdminScreen } from "../admin/screen"
import { Notice } from "../admin/chips"
import { readFileBytes } from "../messages/pickers"
import { TextField } from "../components/form"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { FileText, Image as ImageIcon, Upload } from "../components/icons"
import { friendly, logDetail } from "../errors/translate"
import { colour, radius, space, type } from "../design/tokens"
import { RadioList, useLibraryClubId } from "./shared"

/**
 * UPLOAD A DOCUMENT TO THE CLUB'S LIBRARY.
 *
 * This is the library's own upload, which is why it may hold the device file picker: a club document has
 * to come from somewhere, and this is the product that receives it (`DOCUMENT_PICKER_OWNERS`). Messaging
 * never gets a picker -- a document reaches a conversation by being shared FROM this library.
 *
 * The picker is limited to the four formats the library's table accepts, and the file is checked again
 * against the website's own rules before anything is sent; the server then checks everything a third
 * time. A failed upload leaves nothing behind (`uploadClubDocument` removes an object it could not record).
 */
interface Picked {
  uri: string
  name: string
  mimeType: string
  sizeBytes: number
}

export function UploadDocumentScreen({ folderId = null }: { folderId?: string | null }) {
  const router = useRouter()
  const clubId = useLibraryClubId()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<string>("other")
  const [destination, setDestination] = useState<string>(folderId ?? "")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadProblem(null)
    try {
      const authority = await readClubLibraryAuthority(supabase, clubId)
      setAllowed(authority.manage)
      if (authority.manage) setFolders(await readLibraryFolders(supabase, clubId))
    } catch (caught) {
      const failure = friendly(caught, "the club's folders")
      logDetail("club documents upload", failure)
      setLoadProblem(failure.message)
    }
  }, [clubId])

  useEffect(() => {
    void load()
  }, [load])

  async function pick() {
    setProblem(null)
    let result: DocumentPicker.DocumentPickerResult
    try {
      result = await DocumentPicker.getDocumentAsync({ type: [...CLUB_DOCUMENT_ALLOWED_MIME_TYPES], copyToCacheDirectory: true, multiple: false })
    } catch {
      setProblem("That file couldn't be opened. Try again.")
      return
    }
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const refusal = validateClubDocumentFile({ mimeType: asset.mimeType, sizeBytes: asset.size })
    if (refusal) {
      setProblem(refusal)
      return
    }
    setPicked({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType!, sizeBytes: asset.size! })
    if (!title.trim()) setTitle(defaultDocumentTitle(asset.name))
    if (asset.mimeType?.startsWith("image/") && category === "other") setCategory("image")
  }

  async function upload() {
    if (!clubId || !picked) return
    setBusy(true)
    setProblem(null)
    const bytes = await readFileBytes(picked.uri)
    if (!bytes) {
      setBusy(false)
      setProblem("That file couldn't be read. Try choosing it again.")
      return
    }
    const result = await uploadClubDocument(supabase, {
      clubId,
      folderId: destination || null,
      title,
      category,
      file: { bytes, mimeType: picked.mimeType, name: picked.name, sizeBytes: picked.sizeBytes },
    })
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    // The library re-reads when it comes back into focus, so the new document is simply there.
    if (router.canGoBack()) router.back()
    else router.replace("/admin/documents" as never)
  }

  if (!clubId) {
    return (
      <AdminScreen section="Upload Document">
        <EmptyState title="Choose a club context" body="Documents are uploaded to the club you are viewing. Switch to a club context from the header." />
      </AdminScreen>
    )
  }

  const kind = picked ? documentFileKind(picked.mimeType) : null

  return (
    <AdminScreen section="Upload Document">
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Upload Document
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>A PDF, JPEG, PNG or WEBP, up to 10MB. It stays private to your club unless somebody shares it into a conversation.</Text>
      </View>

      {loadProblem ? (
        <ErrorState message={loadProblem} onRetry={() => void load()} />
      ) : allowed === null ? (
        <CardSkeleton lines={3} />
      ) : !allowed ? (
        <EmptyState title="You can't upload here" body="Uploading to Club Documents needs permission to manage this club's documents." icon={<FileText size={22} color={colour.inkSubtle} />} />
      ) : (
        <>
          <View style={{ gap: space.sm }}>
            <FieldLabel>File</FieldLabel>
            {picked && kind ? (
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                    {kind.kind === "image" ? <ImageIcon size={19} color={colour.forest800} /> : <FileText size={19} color={colour.forest800} />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>{picked.name}</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{[kind.label, formatFileSize(picked.sizeBytes)].filter(Boolean).join(" · ")}</Text>
                  </View>
                </View>
                <Button label="Choose a Different File" variant="quiet" disabled={busy} onPress={() => void pick()} style={{ marginTop: space.sm }} />
              </Card>
            ) : (
              <Button label="Choose File" variant="secondary" icon={<Upload size={18} color={colour.ink} />} onPress={() => void pick()} accessibilityHint="Opens your device's files to choose a PDF or image" />
            )}
          </View>

          <View style={{ gap: space.sm }}>
            <FieldLabel>Title</FieldLabel>
            <TextField label="Title" value={title} onChange={setTitle} placeholder="For example, Visitor Guide 2026" autoCapitalize="words" />
          </View>

          <View style={{ gap: space.sm }}>
            <FieldLabel>Category</FieldLabel>
            <RadioList label="Category" value={category} onChange={setCategory} options={DOCUMENT_CATEGORY_OPTIONS.map(([key, label]) => ({ key, label }))} />
          </View>

          {folders.length > 0 && (
            <View style={{ gap: space.sm }}>
              <FieldLabel>Folder</FieldLabel>
              <RadioList
                label="Folder"
                value={destination}
                onChange={setDestination}
                options={[{ key: "", label: "Club Documents (Top Level)" }, ...folderPaths(folders).map((f) => ({ key: f.id, label: f.path }))]}
              />
            </View>
          )}

          {!!problem && <Notice tone="error" text={problem} />}

          <Button
            label={busy ? "Uploading…" : "Upload Document"}
            variant="brand"
            busy={busy}
            disabled={!picked || !title.trim()}
            onPress={() => void upload()}
          />
        </>
      )}
    </AdminScreen>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={[type.smallMedium, { color: colour.ink }]}>{children}</Text>
}
