import { useCallback, useEffect, useState } from "react"
import { FlatList, Modal, Pressable, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import { readTeamMedia, teamMediaErrorMessage, type TeamMediaItem } from "@ovalball/contracts/team/media"
import type { TeamProfileIdentity } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { NotForYou } from "./screen"
import { teamCoverPhotoSource } from "./cover-library"
import { demoTeamCoverAsset } from "./team-cover-demo"
import { PhotoBottomShade } from "../components/photo-gradient"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { Camera, Ellipsis, Image as ImageIcon, X } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * MEDIA -- the fifth Team Profile tab (Section 5): the team's current cover and a preview of its real
 * Team Gallery, genuinely distinct from the Ovalball Image Library's curated stock
 * (`cover-library.ts`). Never populates the gallery preview with stock imagery -- an empty gallery is
 * shown honestly rather than padded out with photography that is not this team's own history.
 */
export function MediaTab({
  identity,
  rosterVisible,
  canManage,
}: {
  identity: TeamProfileIdentity
  rosterVisible: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [media, setMedia] = useState<TeamMediaItem[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setMedia(await readTeamMedia(supabase, identity.id, 6))
      setRefused(false)
    } catch (caught) {
      const e = caught as { code?: string }
      if (e.code === "42501") {
        setRefused(true)
        setMedia([])
        return
      }
      setProblem(teamMediaErrorMessage(caught, "Couldn't load this team's photos. Try again."))
    }
  }, [identity.id])

  useEffect(() => {
    setMedia(null)
    setProblem(null)
    setRefused(false)
    void load()
  }, [load])

  if (!rosterVisible || refused) {
    return <NotForYou title="Photos aren&apos;t part of your view" body="This team's photos are shown to the people who follow this team." />
  }
  if (problem && !media) {
    return <ErrorState message={problem} onRetry={load} />
  }

  const photo = teamCoverPhotoSource(identity.cover, demoTeamCoverAsset(identity))
  const coverCaption = identity.cover.kind === "cover" ? "Your club's own uploaded photo." : identity.cover.kind === "stock" ? "An Ovalball library photo." : "Ovalball's photography, standing in until your club sets one."

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ marginHorizontal: -space.lg, marginTop: -space.md }}>
        <View style={{ height: 200, overflow: "hidden" }}>
          <Image source={photo} accessible={false} contentFit="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <PhotoBottomShade strength={0.35} />
          {canManage && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit team cover photo"
              onPress={() => router.push({ pathname: "/teams/[teamId]/photo", params: { teamId: identity.id } } as never)}
              style={({ pressed }) => ({ position: "absolute", right: space.md, bottom: space.md, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "rgba(16,21,18,0.55)", opacity: pressed ? 0.8 : 1 })}
            >
              <Camera size={15} color="#fff" />
              <Text style={[type.smallMedium, { color: "#fff" }]}>Edit Cover Photo</Text>
            </Pressable>
          )}
        </View>
        <Text style={[type.caption, { color: colour.inkSubtle, paddingHorizontal: space.lg, paddingTop: 6 }]}>{coverCaption}</Text>
      </View>

      {media === null ? (
        <GallerySkeleton />
      ) : (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Team Gallery</Text>
            {media.length > 6 && (
              <Pressable accessibilityRole="link" accessibilityLabel="Show all team photos" onPress={() => router.push({ pathname: "/teams/[teamId]/gallery", params: { teamId: identity.id } } as never)} hitSlop={8}>
                <Text style={[type.small, { color: colour.forest800 }]}>Show all</Text>
              </Pressable>
            )}
          </View>

          {media.length === 0 ? (
            <EmptyState title="Build your team gallery" body="Add match days, training, team photos and club memories." icon={<ImageIcon size={22} color={colour.inkSubtle} />} />
          ) : (
            <GalleryGrid items={media.slice(0, 6)} onOpen={(i) => setViewerIndex(i)} />
          )}

          {canManage && (
            <Button
              label="Add Photos"
              onPress={() => router.push({ pathname: "/teams/[teamId]/gallery", params: { teamId: identity.id, add: "1" } } as never)}
            />
          )}
        </View>
      )}

      {viewerIndex !== null && media && (
        <PhotoViewer items={media} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </View>
  )
}

function GallerySkeleton() {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ height: 22, width: 140, borderRadius: 4, backgroundColor: colour.line, opacity: 0.5 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ width: "31.5%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: colour.line, opacity: 0.4 }} />
        ))}
      </View>
    </View>
  )
}

/** A tight, no-filename photographic grid -- two columns on the tab preview, three on the full Team
 * Gallery screen (`columns`). Never text, never a filename, never a giant admin control. */
export function GalleryGrid({ items, onOpen, columns = 3 }: { items: TeamMediaItem[]; onOpen: (index: number) => void; columns?: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {items.map((item, i) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel="Open team photo"
          onPress={() => onOpen(i)}
          style={({ pressed }) => ({ width: columns === 2 ? "48.5%" : "31.5%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: colour.line, opacity: pressed ? 0.85 : 1 })}
        >
          {item.url ? <Image source={{ uri: item.url }} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ImageIcon size={18} color={colour.inkSubtle} /></View>}
        </Pressable>
      ))}
    </View>
  )
}

/** Full-screen viewer: swipe left/right between the already-loaded set, close, an optional caption --
 * never a second network fetch, since `items` already carries every resolved signed URL. */
export function PhotoViewer({
  items,
  startIndex,
  onClose,
  onManage,
}: {
  items: TeamMediaItem[]
  startIndex: number
  onClose: () => void
  /** Only offered to an authorised manager. Rendered INSIDE this component's own Modal -- a sibling
   * placed outside it would sit behind the Modal's separate native layer and never be visible (found
   * live, by physical review: the overflow action simply didn't appear on screen at all). */
  onManage?: (index: number) => void
}) {
  const { width } = useWindowDimensions()
  const [index, setIndex] = useState(startIndex)
  const current = items[index]

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          data={items}
          keyExtractor={(item) => item.id}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, height: "100%", alignItems: "center", justifyContent: "center" }}>
              {item.url && <Image source={{ uri: item.url }} accessible={false} contentFit="contain" style={{ width, height: "100%" }} />}
            </View>
          )}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo viewer" onPress={onClose} style={{ position: "absolute", top: 56, right: space.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
          <X size={20} color="#fff" />
        </Pressable>
        {onManage && (
          <Pressable accessibilityRole="button" accessibilityLabel="Manage this photo" onPress={() => onManage(index)} style={{ position: "absolute", top: 56, left: space.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
            <Ellipsis size={20} color="#fff" />
          </Pressable>
        )}
        {items.length > 1 && (
          <View style={{ position: "absolute", bottom: 48, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 }}>
            {items.map((_, i) => (
              <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === index ? "#fff" : "rgba(255,255,255,0.35)" }} />
            ))}
          </View>
        )}
        {!!current?.caption && (
          <View style={{ position: "absolute", bottom: 72, left: space.lg, right: space.lg }}>
            <Text style={[type.small, { color: "#fff", textAlign: "center" }]}>{current.caption}</Text>
          </View>
        )}
      </View>
    </Modal>
  )
}

