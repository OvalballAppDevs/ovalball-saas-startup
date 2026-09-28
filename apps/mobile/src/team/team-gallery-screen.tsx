import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import { addTeamMediaPhoto, readTeamMedia, removeTeamMediaPhoto, setTeamCover, teamMediaErrorMessage, type TeamMediaItem } from "@ovalball/contracts/team/media"

import { supabase } from "../auth/supabase"
import { GalleryGrid, PhotoViewer } from "./media-tab"
import { choosePhoto, readFileBytes, takePhoto } from "../messages/pickers"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { BottomSheet } from "../components/bottom-sheet"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { Camera, CircleX, Image as ImageIcon } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE FULL TEAM GALLERY -- reached from Media's "Show all", or directly with `add=1` to open straight
 * onto Add Photos (the Media tab's own "Add Photos" CTA). One screen, not two: the tab's 6-item preview
 * and this full grid both read the same `readTeamMedia`, never a second query shape.
 */
export function TeamGalleryScreen({ teamId, openAdd }: { teamId: string; openAdd: boolean }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [media, setMedia] = useState<TeamMediaItem[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [manageId, setManageId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(openAdd)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      const profile = await loadTeamProfile(supabase, id.clubId, teamId, id.rugbyCode)
      setCanManage(profile.canEditCover)
      setMedia(await readTeamMedia(supabase, teamId, 200))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        setRefused(true)
        setMedia([])
        return
      }
      const failure = friendly(caught, "this team's photos")
      logDetail("team gallery", failure)
      setProblem(failure.message)
    }
  }, [teamId])

  useEffect(() => {
    setIdentity(null)
    setMedia(null)
    void load()
  }, [load])
  useFocusEffect(useCallback(() => { void load() }, [load]))

  const managing = manageId ? (media ?? []).find((m) => m.id === manageId) ?? null : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Team Gallery" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : refused ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message="This team's photos aren't part of your view." />
        </View>
      ) : media === null ? (
        <View style={{ padding: space.lg }}>
          <CardSkeleton lines={4} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {media.length === 0 ? (
            <EmptyState title="Build your team gallery" body="Add match days, training, team photos and club memories." icon={<ImageIcon size={22} color={colour.inkSubtle} />} />
          ) : (
            <GalleryGrid items={media} columns={3} onOpen={(i) => setViewerIndex(i)} />
          )}
          {canManage && <Button label="Add Photos" onPress={() => setAddOpen(true)} />}
        </ScrollView>
      )}

      {/* Never mounted at the same time as ManagePhotoSheet below -- two stacked React Native <Modal>s
          do not present correctly on iOS (found live, by physical review: tapping Manage while the
          viewer's own Modal was still open silently failed to open anything). Opening Manage closes
          the viewer first. */}
      {viewerIndex !== null && media && !managing && (
        <PhotoViewer
          items={media}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onManage={canManage ? (index) => setManageId(media[index].id) : undefined}
        />
      )}

      {managing && identity && (
        <ManagePhotoSheet
          teamId={teamId}
          item={managing}
          onClose={() => setManageId(null)}
          onSetCover={async () => {
            await setTeamCover(supabase, teamId, { storagePath: managing.storagePath })
            setManageId(null)
            setViewerIndex(null)
            void load()
          }}
          onDeleted={() => {
            setManageId(null)
            setViewerIndex(null)
            void load()
          }}
        />
      )}

      {addOpen && identity && (
        <AddPhotosSheet
          teamId={teamId}
          onClose={() => setAddOpen(false)}
          onAdded={() => void load()}
        />
      )}
    </View>
  )
}

function ManagePhotoSheet({
  teamId,
  item,
  onClose,
  onSetCover,
  onDeleted,
}: {
  teamId: string
  item: TeamMediaItem
  onClose: () => void
  onSetCover: () => void
  onDeleted: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setProblem(null)
    const result = await removeTeamMediaPhoto(supabase, item.id, item.storagePath)
    setBusy(false)
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onDeleted()
  }

  return (
    <BottomSheet visible onClose={onClose} title="Manage Photo">
      <View style={{ gap: space.md }}>
        {!!item.url && (
          <Image source={{ uri: item.url }} accessible={false} contentFit="cover" style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md }} />
        )}
        {!confirmDelete ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Set as cover photo" onPress={onSetCover} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Camera size={18} color={colour.ink} />
              <Text style={[type.small, { color: colour.ink }]}>Set as Cover</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete this photo from the team gallery" onPress={() => setConfirmDelete(true)} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <CircleX size={18} color={colour.danger} />
              <Text style={[type.small, { color: colour.danger }]}>Delete Photo</Text>
            </Pressable>
          </>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>Delete this photo from the team gallery? This can't be undone.</Text>
            {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
            <Button label="Delete Photo" variant="danger" onPress={remove} busy={busy} />
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

type AddStep = "method" | "review"

function AddPhotosSheet({ teamId, onClose, onAdded }: { teamId: string; onClose: () => void; onAdded: () => void }) {
  const [step, setStep] = useState<AddStep>("method")
  const [picked, setPicked] = useState<{ uri: string; mimeType: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [addedCount, setAddedCount] = useState(0)

  async function pick(source: "camera" | "library") {
    setProblem(null)
    const result = source === "camera" ? await takePhoto() : await choosePhoto()
    if ("cancelled" in result) return
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    setPicked({ uri: result.file.uri, mimeType: result.file.mimeType })
    setStep("review")
  }

  async function confirmAdd() {
    if (!picked) return
    setBusy(true)
    setProblem(null)
    const bytes = await readFileBytes(picked.uri)
    if (!bytes) {
      setBusy(false)
      setProblem("That photo couldn't be read. Try choosing it again.")
      return
    }
    const result = await addTeamMediaPhoto(supabase, teamId, bytes, picked.mimeType)
    setBusy(false)
    if (!result.ok) {
      setProblem(teamMediaErrorMessage(result, result.message))
      return
    }
    setAddedCount((n) => n + 1)
    onAdded()
    setPicked(null)
    setStep("method")
  }

  return (
    <BottomSheet visible onClose={onClose} title="Add to Team Gallery">
      {step === "method" && (
        <View style={{ gap: space.md }}>
          {addedCount > 0 && <Text style={[type.small, { color: colour.forest800 }]}>{addedCount} photo{addedCount === 1 ? "" : "s"} added.</Text>}
          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Take a photo for the team gallery" onPress={() => pick("camera")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Camera size={20} color={colour.ink} />
            <Text style={[type.small, { color: colour.ink }]}>Take Photo</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a photo from your library for the team gallery" onPress={() => pick("library")} style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ImageIcon size={20} color={colour.ink} />
            <Text style={[type.small, { color: colour.ink }]}>Choose from Photo Library</Text>
          </Pressable>
        </View>
      )}

      {step === "review" && picked && (
        <View style={{ gap: space.md }}>
          <Image source={{ uri: picked.uri }} accessible={false} contentFit="cover" style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md }} />
          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button label="Add to Gallery" onPress={confirmAdd} busy={busy} />
          <Button label="Choose a Different Photo" variant="secondary" onPress={() => { setPicked(null); setStep("method") }} disabled={busy} />
        </View>
      )}
    </BottomSheet>
  )
}
