import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"
import { teamMediaErrorMessage as pickErrorMessage, setTeamCover, uploadTeamCoverPhoto } from "@ovalball/contracts/team/media"

import { supabase } from "../auth/supabase"
import { demoTeamCoverAsset } from "./team-cover-demo"
import { teamCoverPhotoSource } from "./cover-library"
import { choosePhoto, readFileBytes, takePhoto } from "../messages/pickers"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { PhotoBottomShade } from "../components/photo-gradient"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { BookOpen, Camera, Image as ImageIcon } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"

/**
 * EDIT TEAM PHOTO -- the ONE canonical cover editor (Section 5/Section 18 convergence), reached from
 * the Team Profile's own ellipsis menu ("Team Photo") and from Media's "Edit Cover Photo" alike. Both
 * entry points land here; there is no second editor. `canEditCover` (`team.team.manage` OR
 * `club.profile.edit`) is re-checked on this screen itself rather than trusted from whichever menu
 * offered the row.
 */
export function TeamPhotoScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [canEdit, setCanEdit] = useState<boolean | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ uri: string; mimeType: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      const profile = await loadTeamProfile(supabase, id.clubId, teamId, id.rugbyCode)
      setCanEdit(profile.canEditCover)
    } catch (caught) {
      const failure = friendly(caught, "this team's photo")
      logDetail("team photo", failure)
      setProblem(failure.message)
    }
  }, [teamId])
  useEffect(() => {
    setIdentity(null)
    setCanEdit(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      // A fresh focus (e.g. returning from the Ovalball Image Library having just saved a selection
      // there) means "reload", not "discard a pending local preview the user hasn't saved yet".
      if (!preview) void load()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  )

  const photo = preview ? { uri: preview.uri } : identity ? teamCoverPhotoSource(identity.cover, demoTeamCoverAsset(identity)) : null

  async function pick(source: "camera" | "library") {
    setSaveProblem(null)
    const result = source === "camera" ? await takePhoto({ aspect: [3, 2] }) : await choosePhoto({ aspect: [3, 2] })
    if ("cancelled" in result) return
    if (!result.ok) {
      setSaveProblem(result.message)
      return
    }
    setPreview({ uri: result.file.uri, mimeType: result.file.mimeType })
  }

  async function saveCover() {
    if (!preview || !identity) return
    setBusy(true)
    setSaveProblem(null)
    const bytes = await readFileBytes(preview.uri)
    if (!bytes) {
      setBusy(false)
      setSaveProblem("That photo couldn't be read. Try choosing it again.")
      return
    }
    const uploaded = await uploadTeamCoverPhoto(supabase, identity.clubId, teamId, bytes, preview.mimeType)
    if (!uploaded.ok) {
      setBusy(false)
      setSaveProblem(uploaded.message)
      return
    }
    try {
      await setTeamCover(supabase, teamId, { storagePath: uploaded.path })
      setPreview(null)
      void load()
    } catch (caught) {
      setSaveProblem(pickErrorMessage(caught, "That photo couldn't be set as the cover."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Edit Team Photo" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity || canEdit === null ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ height: 220, borderRadius: radius.lg, backgroundColor: colour.line }} />
          <CardSkeleton lines={2} />
        </View>
      ) : !canEdit ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message="Changing this team's photo needs club or team management permission." />
        </View>
      ) : (
        <View style={{ padding: space.lg, gap: space.lg }}>
          <View style={{ height: 220, borderRadius: radius.lg, backgroundColor: surface.forest, overflow: "hidden" }}>
            {photo && <Image source={photo} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />}
            <PhotoBottomShade strength={0.5} />
          </View>

          {!!saveProblem && <Text style={[type.small, { color: colour.danger }]}>{saveProblem}</Text>}

          {preview ? (
            <View style={{ gap: space.sm }}>
              <Button label="Save Cover" onPress={saveCover} busy={busy} />
              <Button label="Choose a Different Photo" variant="secondary" onPress={() => setPreview(null)} disabled={busy} />
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Choose a Photo</Text>
              <ChoiceRow icon={<Camera size={19} color={colour.ink} />} label="Take Photo" onPress={() => pick("camera")} />
              <ChoiceRow icon={<ImageIcon size={19} color={colour.ink} />} label="Choose from Library" onPress={() => pick("library")} />
              <ChoiceRow icon={<BookOpen size={19} color={colour.ink} />} label="Use Ovalball Image Library" onPress={() => router.push({ pathname: "/teams/[teamId]/cover-library", params: { teamId } } as never)} />
              <Text style={[type.caption, { color: colour.inkSubtle }]}>
                {identity.cover.kind === "cover" ? "Your club's own uploaded photo." : identity.cover.kind === "stock" ? "An Ovalball library photo." : "Ovalball's photography, standing in until your club sets one."}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

function ChoiceRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : colour.surface })}
    >
      {icon}
      <Text style={[type.small, { color: colour.ink }]}>{label}</Text>
    </Pressable>
  )
}
