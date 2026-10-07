import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { Image } from "expo-image"

import { setTournamentCover, tournamentMediaErrorMessage, uploadTournamentCoverPhoto } from "@ovalball/contracts/tournament-media"

import { readFileBytes } from "../messages/pickers"
import { Camera } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"
import { coverPhotoSource, fallbackAsset } from "../media/stock-assets"
import { MediaPickerSheet, type MediaChoice } from "../media/media-picker"

/**
 * THE TOURNAMENT PHOTO CONTROL -- one component, used while creating a tournament and while editing
 * one that already exists.
 *
 * THE TWO CALLERS DIFFER IN WHERE THE ANSWER GOES, NOT IN WHAT THE ANSWER IS. The create wizard holds
 * the choice in its draft until the tournament exists; the detail screen writes it immediately. So
 * this component does not know about Supabase at all: it reports a `TournamentCoverChoice` and lets
 * the caller decide what that means. Two photo controls that looked the same and behaved differently
 * would be the thing to avoid.
 *
 * THE CURRENT PHOTOGRAPH IS THE CONTROL. Tapping the picture is how you change it, which is the rule
 * the rest of Ovalball already follows for a profile picture and a club crest.
 */

/** What the organiser chose. `null` means "use the canonical Ovalball default" -- an explicit reset,
 * not an absence, which is why it is part of the union rather than the lack of one. */
export type TournamentCoverChoice = MediaChoice

export function TournamentPhotoControl({
  /** What is on the tournament now, already resolved. */
  current,
  /** A not-yet-saved local pick, shown in preference to `current` so the organiser sees their choice. */
  pending,
  onChoose,
  busy,
  problem,
  label = "Tournament Photo",
  hideLabel,
}: {
  current: { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }
  pending?: TournamentCoverChoice
  onChoose: (choice: TournamentCoverChoice) => void
  busy?: boolean
  problem?: string | null
  label?: string
  /** The caller already names this section (a Card's own title does), so the control must not say it
   * again -- "Tournament Photo" over "TOURNAMENT PHOTO" reads as a mistake, not as emphasis. */
  hideLabel?: boolean
}) {
  const [open, setOpen] = useState(false)

  const source =
    pending?.kind === "upload"
      ? { uri: pending.uri }
      : pending?.kind === "stock"
        ? coverPhotoSource("TOURNAMENT", { kind: "stock", key: pending.key })
        : pending === null
          ? fallbackAsset("TOURNAMENT")
          : coverPhotoSource("TOURNAMENT", current)

  const isDefault = pending === null || (pending === undefined && current.kind === "none")

  return (
    <View style={{ gap: space.xs }}>
      {!hideLabel && <Text style={[type.overline, { color: colour.inkSubtle }]}>{label.toUpperCase()}</Text>}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${isDefault ? "Using the default Ovalball photo" : "A photo has been chosen"}. Change photo`}
        onPress={() => setOpen(true)}
        disabled={busy}
        style={({ pressed }) => ({
          height: 160,
          borderRadius: radius.lg,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: colour.surface,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <Image source={source} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} transition={120} />

        {/* The affordance sits ON the picture, because the picture IS the button. A dark scrim keeps
            the label legible over a bright photograph without dimming the whole image. */}
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingVertical: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: "rgba(7,28,20,0.62)" }}>
          <Camera size={15} color={colour.onForest} strokeWidth={2} />
          <Text style={[type.caption, { flex: 1, color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>Change Photo</Text>
          {isDefault && <Text style={[type.caption, { color: "rgba(248,250,247,0.72)", fontSize: 11 }]}>Ovalball default</Text>}
        </View>

        {busy && (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,28,20,0.45)" }}>
            <ActivityIndicator color={colour.onForest} />
          </View>
        )}
      </Pressable>

      {!!problem && <Text style={[type.caption, { color: colour.danger }]}>{problem}</Text>}

      {/* THE ONE MEDIA PICKER (src/media/media-picker.tsx), for a tournament: the Ovalball library's
          tournament pictures, an upload cropped to the 16:9 every tournament surface draws, or the default. */}
      <MediaPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        domain="TOURNAMENT"
        title="Tournament Photo"
        intro="Give this tournament its own photo so it is easy to pick out from the others."
        uploadAspect={[16, 9]}
        showReset={!isDefault}
        selectedKey={pending?.kind === "stock" ? pending.key : current.kind === "stock" ? current.key : null}
        onChoose={(choice: MediaChoice) => {
          setOpen(false)
          onChoose(choice)
        }}
      />
    </View>
  )
}

/** The Supabase client, as the contracts' own writers type it. Named here so this module does not have
 * to import the generated Database type just to describe a parameter it only passes through. */
type SupabaseLike = Parameters<typeof setTournamentCover>[0]

/**
 * APPLYING A CHOICE TO A TOURNAMENT THAT EXISTS.
 *
 * Shared by the detail screen and by the create wizard's follow-up upload, so an uploaded photo takes
 * exactly the same path in both: bytes to the bucket under the governed path, then the one governed
 * RPC. Returns a sentence on failure rather than throwing, because every caller shows it in the same
 * place.
 */
export async function applyTournamentCoverChoice(
  deps: { supabase: SupabaseLike; clubId: string; tournamentId: string },
  choice: TournamentCoverChoice,
): Promise<string | null> {
  try {
    if (choice === null) {
      await setTournamentCover(deps.supabase, deps.tournamentId, null)
      return null
    }
    if (choice.kind === "stock") {
      await setTournamentCover(deps.supabase, deps.tournamentId, { stockKey: choice.key })
      return null
    }
    const bytes = await readFileBytes(choice.uri)
    if (!bytes) return "That photo couldn't be read. Try choosing it again."
    const uploaded = await uploadTournamentCoverPhoto(deps.supabase, deps.clubId, deps.tournamentId, bytes, choice.mimeType)
    if (!uploaded.ok) return uploaded.message
    await setTournamentCover(deps.supabase, deps.tournamentId, { storagePath: uploaded.path })
    return null
  } catch (caught) {
    return tournamentMediaErrorMessage(caught, "That photo couldn't be set as the tournament photo.")
  }
}
