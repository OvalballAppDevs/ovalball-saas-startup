import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { Image } from "expo-image"
import { useFocusEffect, useRouter } from "expo-router"

import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { demoTeamCoverAsset } from "./team-cover-demo"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { PhotoBottomShade } from "../components/photo-gradient"
import { CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { Camera } from "../components/icons"
import { colour, radius, space, surface, type } from "../design/tokens"

/**
 * TEAM PHOTO -- the canonical destination for "change the team's cover photo" (owner brief Section 3/17),
 * establishing the real shell now rather than a fake picker. Reached only from the Team Profile's own
 * ellipsis menu, and only where `canEditCover` already said yes -- the SAME signal (`team.team.manage`
 * OR `club.profile.edit`) is re-checked here rather than trusted from the menu having shown the row,
 * because a screen reached by a stale deep link must refuse on its own account. There is no working
 * picker yet: Section 6 owns the real editor (existing/library/upload) and Section 7 the approved image
 * library. Showing a fabricated one here would be worse than an honest "not yet" -- the photograph shown
 * is real (the team's own cover, or the same deterministic fallback its Profile and Home card already
 * use), never invented for this screen alone.
 */
export function TeamPhotoScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [canEdit, setCanEdit] = useState<boolean | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

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
      void load()
    }, [load])
  )

  const photo = identity ? (identity.cover.kind === "cover" ? { uri: identity.cover.url } : demoTeamCoverAsset(identity)) : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Team Photo" onBack={() => router.back()} tone="forest" />
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
          <EmptyState
            title="Choosing a new photo is coming soon"
            body="Picking from your own photos or from Ovalball's approved team photography is being built next. This is your team's current photo."
            icon={<Camera size={22} color={colour.inkSubtle} />}
          />
          <Text style={[type.caption, { color: colour.inkSubtle }]}>
            {identity.cover.kind === "cover" ? "Your club's own uploaded photo." : "Ovalball's photography, standing in until your club sets one."}
          </Text>
        </View>
      )}
    </View>
  )
}
