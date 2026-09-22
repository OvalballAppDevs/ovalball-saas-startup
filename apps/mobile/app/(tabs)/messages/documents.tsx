import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { supabase } from "../../../src/auth/supabase"
import { shareDocument, type AttachableKind } from "../../../src/messages/attachments"
import { readableSize, searchClubDocuments, type ClubDocument } from "../../../src/messages/documents"
import { friendly, logDetail } from "../../../src/errors/translate"
import { BookOpen, ChevronRight, FileText } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * SHARE SOMETHING ALREADY IN OVALBALL.
 *
 * THE SEARCH RUNS ON THE SERVER AND THE LIST IS WHAT RLS RETURNS. `club_documents` resolves through
 * `internal.can_view_document_library`, so this screen asks for documents and receives exactly the
 * ones this identity may see. There is no club filter here, and adding one would look like the
 * authority while being a weaker copy of it.
 *
 * SEEING IS NOT SHARING, AND THE SERVER OWNS THAT TOO. `share_fixture_document` additionally checks the
 * club's `allow_document_library_sharing` policy and that the sender may post in this conversation. So
 * a document can legitimately appear here and still be refused on share -- and when it is, the club's
 * own words are shown rather than a guess made in advance. Holding a copy of the policy on the phone
 * to grey rows out would be the wrong kind of helpful.
 *
 * NOTHING IS COPIED. A share is a reference, so the conversation points at the club's document and a
 * later revision is not left orphaned beside it.
 */
export default function ClubDocuments() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ kind?: string; id?: string }>()
  const kind = (params.kind === "request" ? "request" : "fixture") as AttachableKind
  const id = String(params.id ?? "")

  const [search, setSearch] = useState("")
  const [documents, setDocuments] = useState<ClubDocument[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [note, setNote] = useState("")

  const load = useCallback(async (needle: string) => {
    setProblem(null)
    try {
      setDocuments(await searchClubDocuments(supabase, needle))
    } catch (caught) {
      const failure = friendly(caught, "your club's documents")
      logDetail("club documents", failure)
      setProblem(failure.message)
    }
  }, [])

  // DEBOUNCED, because every keystroke is a round trip otherwise -- and a library search that fires
  // six times while somebody types "visitor" is six queries to throw five of away.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(search), documents === null ? 0 : 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // `documents` is read only to make the FIRST load immediate; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Back to the conversation the share has just landed in, rather than forward to a confirmation.
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the conversation"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Club Documents
        </Text>
      </View>

      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm }}>
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

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
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
                ? `No document you can see matches “${search.trim()}”.`
                : "Documents your club has uploaded to Ovalball appear here."
            }
            icon={<BookOpen size={22} color={colour.inkSubtle} />}
          />
        )}

        {!!documents?.length && (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {documents.map((document, index) => {
              const meta = [document.category, readableSize(document.sizeBytes)].filter(Boolean).join(" · ")
              return (
                <Pressable
                  key={document.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Share ${document.title}${meta ? `, ${meta}` : ""}`}
                  accessibilityState={{ busy: sharing === document.id }}
                  disabled={Boolean(sharing)}
                  onPress={() => void share(document)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET + 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    paddingVertical: space.sm + 2,
                    paddingHorizontal: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
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

const field = {
  minHeight: TOUCH_TARGET,
  paddingHorizontal: space.md,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colour.lineStrong,
  backgroundColor: colour.surface,
  color: colour.ink,
} as const
