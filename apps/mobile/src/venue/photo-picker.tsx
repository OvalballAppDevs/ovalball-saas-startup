import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"

import { MEDIA_PROVENANCE_WORDS } from "@ovalball/contracts/media/stock-library"

import { choosePhoto, readFileBytes } from "../messages/pickers"
import { BookOpen, Image as ImageIcon, Undo2 } from "../components/icons"
import { colour, radius, space, surface, type } from "../design/tokens"
import { friendly } from "../errors/translate"
import { IllustrativeTag, MediaPickerSheet } from "../media/media-picker"
import { fallbackAsset, stockAsset, stockPickerItems } from "../media/stock-assets"
import type { CoverWrite, DraftPhoto } from "./create-venue-logic"

/**
 * ONE PHOTO PICKER FOR A GROUND, A PITCH AND A CHANGING ROOM -- large preview, a strip of the library's first
 * pictures for this kind of facility (tap one to select it directly), then Choose From Ovalball Library (the
 * one Stock Media Library, by category, with a preview) and Upload Photo (the device's own gallery -- no
 * camera, the same two actions every facility has had). The draft never uploads anything itself: a picked
 * photo is held as a local uri and only uploaded once the record has a real id (`applyPendingUploads`).
 *
 * A library picture -- chosen, or standing in -- is marked Illustrative: it is not a photo of THIS ground.
 * The changing-room picker that was a copy of this one is retired; changing rooms use this, with their domain.
 *
 * Reset to Default -- the same words and the same meaning as the event and tournament pickers -- appears once
 * something is chosen: it stages "no chosen picture", and the host's save clears the stored cover
 * (`coverWriteFor`), so the one fallback rule stands in again.
 */
export function PhotoPicker({
  photo,
  onChange,
  domain,
  label,
  seed,
  overline,
}: {
  photo: DraftPhoto
  onChange: (next: DraftPhoto) => void
  domain: "VENUE" | "PITCH" | "CHANGING_ROOM"
  /** The library sheet's title, e.g. "Venue Photos". */
  label: string
  /** The record's id, so the picture standing in is the same one every other surface shows for it. */
  seed?: string | null
  overline?: string
}) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const strip = stockPickerItems(domain).slice(0, 6)

  const source =
    photo.kind === "stock"
      ? (stockAsset(photo.key) ?? fallbackAsset(domain, seed))
      : photo.kind === "upload"
        ? { uri: photo.localUri }
        : photo.kind === "existing"
          ? { uri: photo.url }
          : fallbackAsset(domain, seed)
  const illustrative = photo.kind === "stock" || photo.kind === "none"

  async function pick() {
    setProblem(null)
    const result = await choosePhoto({ aspect: [4, 3] })
    if ("cancelled" in result) return
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onChange({ kind: "upload", localUri: result.file.uri, mimeType: result.file.mimeType })
  }

  return (
    <View style={{ gap: space.sm }}>
      {!!overline && <Text style={[type.overline, { color: colour.inkSubtle }]}>{overline}</Text>}
      <View style={{ height: 200, borderRadius: radius.lg, backgroundColor: surface.forest, overflow: "hidden" }}>
        <Image source={source} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
        {illustrative && <IllustrativeTag />}
      </View>
      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {photo.kind === "upload" || photo.kind === "existing" ? MEDIA_PROVENANCE_WORDS.UPLOADED : photo.kind === "stock" ? MEDIA_PROVENANCE_WORDS.STOCK : MEDIA_PROVENANCE_WORDS.FALLBACK}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {strip.map((img) => {
          const on = photo.kind === "stock" && photo.key === img.key
          return (
            <Pressable
              key={img.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={img.label}
              onPress={() => onChange({ kind: "stock", key: img.key })}
              style={{ width: 64, height: 64, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 3 : 1, borderColor: on ? colour.forest800 : colour.line }}
            >
              <Image source={img.asset} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
            </Pressable>
          )
        })}
      </ScrollView>

      <ChoiceRow icon={<BookOpen size={18} color={colour.ink} />} label="Choose From Ovalball Library" onPress={() => setLibraryOpen(true)} />
      <ChoiceRow icon={<ImageIcon size={18} color={colour.ink} />} label="Upload Photo" onPress={() => void pick()} />
      {photo.kind !== "none" && <ChoiceRow icon={<Undo2 size={18} color={colour.ink} />} label="Reset to Default" onPress={() => onChange({ kind: "none" })} />}
      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}

      <MediaPickerSheet
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        domain={domain}
        title={label}
        startInLibrary
        selectedKey={photo.kind === "stock" ? photo.key : null}
        onChoose={(choice) => {
          setLibraryOpen(false)
          if (choice?.kind === "stock") onChange({ kind: "stock", key: choice.key })
        }}
      />
    </View>
  )
}

function ChoiceRow({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : colour.surface })}
    >
      {icon}
      <Text style={[type.small, { color: colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

/**
 * CARRY OUT A FACILITY'S PHOTO WRITE on Save Changes, through that facility's own governed contract (its
 * upload path and its `set_*_cover` RPC). Returns null when done, or a sentence saying the photo did not
 * change -- never silence: a host that swallowed the failure would go back to a screen still showing the
 * old picture, as if the save had not happened.
 */
export async function applyCoverWrite(
  write: CoverWrite,
  ops: {
    set: (selection: { storagePath: string } | { stockKey: string } | null) => Promise<void>
    upload: (bytes: ArrayBuffer, mimeType: string) => Promise<{ ok: true; path: string } | { ok: false; message: string }>
  }
): Promise<string | null> {
  try {
    if (write.kind === "keep") return null
    if (write.kind === "clear") {
      await ops.set(null)
      return null
    }
    if (write.kind === "stock") {
      await ops.set({ stockKey: write.key })
      return null
    }
    const bytes = await readFileBytes(write.localUri)
    if (!bytes) return "The photo could not be read from this device. Choose it again, then save."
    const uploaded = await ops.upload(bytes, write.mimeType)
    if (!uploaded.ok) return uploaded.message
    await ops.set({ storagePath: uploaded.path })
    return null
  } catch (cause) {
    return friendly(cause, "this photo").message
  }
}
