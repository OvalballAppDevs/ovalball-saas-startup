import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { DIRECT_SHARE_CATEGORY_HINT } from "@ovalball/contracts"
import { librarySearchNeedle } from "@ovalball/contracts/documents/library"
import { documentCategoryLabel } from "@ovalball/contracts/documents/categories"

import { supabase } from "../../auth/supabase"
import { shareDocument, type AttachableKind } from "../../messages/attachments"
import { readableSize, searchClubDocuments, type ClubDocument } from "../../messages/documents"
import { friendly, logDetail } from "../../errors/translate"
import { BookOpen, ChevronRight, FileText } from "../icons"
import { CardSkeleton, EmptyState, ErrorState } from "../ui"
import { TOUCH_TARGET, colour, messenger, radius, space, type } from "../../design/tokens"

/**
 * SHARE SOMETHING ALREADY IN OVALBALL -- the one Club Documents picker for messaging.
 *
 * The full-screen picker and the compact messenger both draw this, so the search, the note, the
 * category rule for direct conversations and the server's own refusal wording are written once.
 *
 * THE LIST IS WHAT RLS RETURNS. `club_documents` resolves through `internal.can_view_document_library`,
 * so this asks for documents and receives exactly the ones this identity may see. Seeing is not
 * sharing: `share_message_document` additionally checks the club's sharing policy and that the sender
 * may post here, and a refusal is shown in the server's words. Nothing is copied -- a share is a
 * reference to the club's document, opened later through a short-lived signed link.
 */
export function DocumentPicker({
  kind,
  id,
  onShared,
  compact = false,
  bottomInset = 0,
}: {
  kind: AttachableKind
  id: string
  onShared: () => void
  compact?: boolean
  bottomInset?: number
}) {
  const [search, setSearch] = useState("")
  const [documents, setDocuments] = useState<ClubDocument[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [note, setNote] = useState("")

  const load = useCallback(
    async (needle: string) => {
      setProblem(null)
      try {
        // Made safe for the PostgREST filter it is interpolated into: a comma or a bracket in a search
        // is a word to look for, never a second condition.
        setDocuments(await searchClubDocuments(supabase, librarySearchNeedle(needle), kind))
      } catch (caught) {
        const failure = friendly(caught, "your club's documents")
        logDetail("club documents", failure)
        setProblem(failure.message)
      }
    },
    [kind]
  )

  // DEBOUNCED: a search that fires on every keystroke is six queries to throw five away.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(search), first.current ? 0 : 250)
    first.current = false
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [search, load])

  async function share(document: ClubDocument) {
    if (sharing || !id) return
    setSharing(document.id)
    setProblem(null)
    const result = await shareDocument(supabase, kind, id, document.id, note)
    setSharing(null)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onShared()
  }

  const field = {
    minHeight: compact ? 40 : TOUCH_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.lineStrong,
    backgroundColor: colour.surface,
    color: colour.ink,
  } as const

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: compact ? space.md : space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <TextInput
          accessibilityLabel="Search club documents"
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          placeholderTextColor={colour.inkSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={colour.pitch600}
          style={[type.body, field]}
        />
        <TextInput
          accessibilityLabel="Note"
          value={note}
          onChangeText={setNote}
          placeholder="Add a note (optional)"
          placeholderTextColor={colour.inkSubtle}
          selectionColor={colour.pitch600}
          style={[type.body, field]}
        />
      </View>

      {kind === "direct" && (
        <Text style={[type.caption, { color: colour.inkMuted, paddingHorizontal: compact ? space.md : space.lg, paddingBottom: space.sm }]}>{DIRECT_SHARE_CATEGORY_HINT}</Text>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: compact ? space.md : space.lg, paddingBottom: bottomInset + (compact ? space.md : space.xxl), gap: space.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {problem && <ErrorState message={problem} onRetry={() => load(search)} />}

        {!problem && documents === null && (
          <>
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </>
        )}

        {documents?.length === 0 && (
          <EmptyState
            title={search.trim() ? "No matches" : "No documents to share"}
            body={
              search.trim()
                ? `No document you can share here matches “${search.trim()}”.`
                : kind === "direct"
                  ? `Documents your club has uploaded to Ovalball appear here. ${DIRECT_SHARE_CATEGORY_HINT}`
                  : "Documents your club has uploaded to Ovalball appear here."
            }
            icon={<BookOpen size={22} color={colour.inkSubtle} />}
          />
        )}

        {!!documents?.length && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {documents.map((document, index) => {
              const meta = [document.category ? documentCategoryLabel(document.category) : null, readableSize(document.sizeBytes)].filter(Boolean).join(" · ")
              return (
                <Pressable
                  key={document.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Share ${document.title}${meta ? `, ${meta}` : ""}`}
                  accessibilityState={{ busy: sharing === document.id }}
                  disabled={Boolean(sharing)}
                  onPress={() => void share(document)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET + (compact ? 4 : 12),
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingVertical: space.sm + 2,
                    paddingHorizontal: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? messenger.pressed : "transparent",
                    opacity: sharing && sharing !== document.id ? 0.5 : 1,
                  })}
                >
                  <FileText size={20} color={colour.forest800} strokeWidth={1.9} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
                      {document.title}
                    </Text>
                    {!!meta && (
                      <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
                        {meta}
                      </Text>
                    )}
                  </View>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
