import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  createFolder,
  readClubLibrary,
  readClubLibraryAuthority,
  signDocumentUrl,
  type ClubLibrary,
  type LibraryDocument,
} from "@ovalball/contracts/documents/library"

import { supabase } from "../auth/supabase"
import { AdminScreen } from "../admin/screen"
import { Notice } from "../admin/chips"
import { Tabs } from "../people/ui"
import { openAttachment } from "../messages/open-attachment"
import { TextSheet } from "../components/field-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { FileText, FolderPlus, Search, Upload, X } from "../components/icons"
import { friendly, logDetail } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { DocumentSheet } from "./document-sheet"
import { DocumentRow, FolderRow, ListGroup, useLibraryClubId } from "./shared"

/**
 * CLUB DOCUMENTS -- the club's own library, on the phone.
 *
 * THE SAME LIBRARY THE WEBSITE KEEPS (`app/(app)/documents`): the same rows, folders, categories and
 * private bucket, read and written through the shared contract (`@ovalball/contracts/documents/library`).
 * Nothing here is a second store, and nothing here is authority -- row-level security decides what
 * comes back, and `club.documents.manage` (asked of the server) only decides which controls are offered.
 *
 * A folder is a level of this one screen, reached by its own route so Back climbs out a level at a time.
 * Team documents sit under their team, exactly as the website shows them, and open the one Team
 * Documents screen rather than a copy of it.
 *
 * NO PATH, NO BUCKET URL. A document is opened by signing a short-lived URL at the moment it is tapped
 * and handing the file to the system's own preview sheet (`openAttachment`), which is also where it is
 * shared or saved.
 */
type LibraryView = "library" | "archived"

export function ClubDocumentsScreen({ folderId = null }: { folderId?: string | null }) {
  const router = useRouter()
  const clubId = useLibraryClubId()
  const [authority, setAuthority] = useState<{ view: boolean; manage: boolean } | null>(null)
  const [library, setLibrary] = useState<ClubLibrary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<LibraryView>("library")
  const [query, setQuery] = useState("")
  const [needle, setNeedle] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderProblem, setFolderProblem] = useState<string | null>(null)
  const request = useRef(0)

  // Typing searches after a pause, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const archived = view === "archived" && authority?.manage === true

  const load = useCallback(async () => {
    if (!clubId) return
    const mine = ++request.current
    setProblem(null)
    try {
      const nextAuthority = await readClubLibraryAuthority(supabase, clubId)
      if (mine !== request.current) return
      setAuthority(nextAuthority)
      if (!nextAuthority.view) {
        setLibrary(null)
        return
      }
      const next = await readClubLibrary(supabase, clubId, { folderId, query: needle, archived: view === "archived" && nextAuthority.manage })
      if (mine !== request.current) return
      setLibrary(next)
    } catch (caught) {
      if (mine !== request.current) return
      const failure = friendly(caught, "the club's documents")
      logDetail("club documents", failure)
      setProblem(failure.message)
    }
  }, [clubId, folderId, needle, view])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function open(doc: LibraryDocument) {
    if (openingId) return
    setNotice(null)
    setOpeningId(doc.id)
    const signedUrl = await signDocumentUrl(supabase, doc.storagePath)
    const result = await openAttachment({ id: doc.id, filename: doc.originalFilename, mimeType: doc.mimeType, signedUrl })
    setOpeningId(null)
    if (!result.ok) setNotice({ tone: "error", text: result.message })
  }

  async function addFolder(name: string) {
    if (!clubId) return
    setFolderBusy(true)
    setFolderProblem(null)
    const result = await createFolder(supabase, clubId, folderId, name)
    setFolderBusy(false)
    if (!result.ok) {
      setFolderProblem(result.message)
      return
    }
    setFolderOpen(false)
    setNotice({ tone: "ok", text: `Folder '${name.trim()}' created.` })
    void load()
  }

  const selected = selectedId ? library?.documents.find((d) => d.id === selectedId) ?? null : null
  const currentName = library?.currentFolder?.name ?? null
  const heading = folderId ? currentName ?? "Folder" : "Club Documents"
  const searching = needle.length > 0
  const canManage = authority?.manage === true

  return (
    <AdminScreen section={heading} onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: space.xs }}>
        {folderId && library && library.trail.length > 0 && (
          <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={2}>
            {["Club Documents", ...library.trail.slice(0, -1).map((f) => f.name)].join(" / ")}
          </Text>
        )}
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          {heading}
        </Text>
        {!folderId && (
          <Text style={[type.body, { color: colour.inkMuted }]}>
            Visitor guides, ground and pitch information, parking and match-day documents. Private to your club unless you share one into a conversation.
          </Text>
        )}
      </View>

      {!clubId ? (
        <EmptyState title="Choose a club context" body="Club Documents works on the club you are viewing. Switch to a club context from the header." />
      ) : problem ? (
        <ErrorState message={problem} onRetry={() => void load()} />
      ) : authority === null ? (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </View>
      ) : !authority.view ? (
        <EmptyState title="No access to Club Documents" body="You don't currently have access to this club's documents." icon={<FileText size={22} color={colour.inkSubtle} />} />
      ) : (
        <>
          {canManage && <Tabs tabs={[{ key: "library", label: "Library" }, { key: "archived", label: "Archived" }]} value={view} onChange={(next: LibraryView) => { setNotice(null); setView(next) }} />}

          {canManage && !archived && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <Button
                label="Upload Document"
                variant="brand"
                icon={<Upload size={18} color={colour.onForest} />}
                style={{ flexGrow: 1 }}
                onPress={() => router.push({ pathname: "/admin/documents/upload", params: folderId ? { folderId } : {} } as never)}
              />
              <Button
                label="New Folder"
                variant="secondary"
                icon={<FolderPlus size={18} color={colour.ink} />}
                style={{ flexGrow: 1 }}
                onPress={() => { setFolderProblem(null); setFolderOpen(true) }}
              />
            </View>
          )}

          <SearchField value={query} onChange={setQuery} placeholder={archived ? "Search the archive" : "Search all club documents"} />

          {!!notice && <Notice tone={notice.tone} text={notice.text} />}

          {library === null ? (
            <View style={{ gap: space.md }}>
              <CardSkeleton lines={3} />
            </View>
          ) : (
            <LibraryBody
              library={library}
              archived={archived}
              searching={searching}
              needle={needle}
              inFolder={!!folderId}
              canManage={canManage}
              openingId={openingId}
              onFolder={(id) => router.push({ pathname: "/admin/documents/folder/[folderId]", params: { folderId: id } } as never)}
              onTeam={(id) => router.push({ pathname: "/admin/documents/team/[teamId]", params: { teamId: id } } as never)}
              onOpen={(doc) => void open(doc)}
              onMore={(doc) => setSelectedId(doc.id)}
            />
          )}
        </>
      )}

      {selected && clubId && library && (
        <DocumentSheet
          doc={selected}
          clubId={clubId}
          canManage={canManage}
          folders={library.allFolders}
          opening={openingId === selected.id}
          onOpen={() => {
            // The system's preview sheet cannot rise over a sheet that is still on screen, so this one goes first.
            setSelectedId(null)
            setTimeout(() => void open(selected), 350)
          }}
          onClose={() => setSelectedId(null)}
          onChanged={(message) => {
            setSelectedId(null)
            setNotice({ tone: "ok", text: message })
            void load()
          }}
        />
      )}

      <TextSheet
        visible={folderOpen}
        title="New Folder"
        hint={currentName ? `Inside ${currentName}.` : "At the top level of Club Documents."}
        placeholder="Folder name"
        value=""
        onClose={() => setFolderOpen(false)}
        onSave={(name) => void addFolder(name)}
        saving={folderBusy}
        problem={folderProblem}
      />
    </AdminScreen>
  )
}

function LibraryBody({
  library,
  archived,
  searching,
  needle,
  inFolder,
  canManage,
  openingId,
  onFolder,
  onTeam,
  onOpen,
  onMore,
}: {
  library: ClubLibrary
  archived: boolean
  searching: boolean
  needle: string
  inFolder: boolean
  canManage: boolean
  openingId: string | null
  onFolder: (id: string) => void
  onTeam: (id: string) => void
  onOpen: (doc: LibraryDocument) => void
  onMore: (doc: LibraryDocument) => void
}) {
  const { folders, teams, documents } = library
  const flat = archived || searching

  if (flat && documents.length === 0) {
    return searching ? (
      <EmptyState title="No matching documents" body={`Nothing ${archived ? "in the archive" : "in the library"} matches '${needle}'.`} icon={<Search size={22} color={colour.inkSubtle} />} />
    ) : (
      <EmptyState title="Nothing archived" body="Archived documents are kept here and can be restored at any time." icon={<FileText size={22} color={colour.inkSubtle} />} />
    )
  }

  if (!flat && folders.length === 0 && teams.length === 0 && documents.length === 0) {
    return inFolder ? (
      <EmptyState title="This folder is empty" body={canManage ? "Upload a document here, or move one in from elsewhere in the library." : "Nothing has been filed here yet."} icon={<FileText size={22} color={colour.inkSubtle} />} />
    ) : (
      <EmptyState
        title="No documents yet"
        body={canManage ? "Upload a visitor guide, ground information or a match-day document and it will appear here." : "Your club hasn't added any documents yet."}
        icon={<FileText size={22} color={colour.inkSubtle} />}
      />
    )
  }

  return (
    <View style={{ gap: space.xl }}>
      {!flat && teams.length > 0 && (
        <ListGroup title="Teams">
          {teams.map((t, i) => (
            <FolderRow key={t.id} name={t.label} detail={`${t.count} document${t.count === 1 ? "" : "s"}`} first={i === 0} onPress={() => onTeam(t.id)} />
          ))}
        </ListGroup>
      )}
      {!flat && folders.length > 0 && (
        <ListGroup title="Folders">
          {folders.map((f, i) => (
            <FolderRow key={f.id} name={f.name} first={i === 0} onPress={() => onFolder(f.id)} />
          ))}
        </ListGroup>
      )}
      {documents.length > 0 && (
        <ListGroup title={searching ? "Results" : archived ? "Archived" : inFolder ? "Documents" : "General"}>
          {documents.map((d, i) => (
            <DocumentRow key={d.id} doc={d} first={i === 0} busy={openingId === d.id} onOpen={() => onOpen(d)} onMore={() => onMore(d)} />
          ))}
        </ListGroup>
      )}
    </View>
  )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  return (
    <View
      style={{
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingLeft: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colour.lineStrong,
        backgroundColor: colour.surface,
      }}
    >
      <Search size={18} color={colour.inkSubtle} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colour.inkSubtle}
        accessibilityLabel="Search documents"
        returnKeyType="search"
        autoCorrect={false}
        selectionColor={colour.pitch600}
        style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink, paddingVertical: space.sm }]}
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
          style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
        >
          <X size={18} color={colour.inkSubtle} />
        </Pressable>
      )}
    </View>
  )
}
