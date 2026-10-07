import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native"
import { Image } from "expo-image"

import { isIllustrative, stockMedia, stockCategoriesFor, type StockDomain, type StockMediaEntry } from "@ovalball/contracts/media/stock-library"

import { choosePhoto } from "../messages/pickers"
import { Camera, Check, Image as ImageIcon, Undo2, X } from "../components/icons"
import { FilterChip } from "../components/filter-chip"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { stockPickerItems, type StockPickerItem } from "./stock-assets"

/**
 * THE ONE MEDIA PICKER -- every place a person sets a picture for something Ovalball shows.
 *
 * A team's cover, a ground, a pitch, a changing room, an event and a tournament each had a picker of their
 * own: a strip and a sheet here, an inline grid there, a full-screen library somewhere else, with different
 * words for the same three choices. This is the one shape, generalised from the tournament photo sheet:
 *
 *   Choose From Ovalball Library -- the categorised Stock Media Library for this kind of object: chips to
 *     filter by category, a grid, a large preview of the picture before it is used, then Use This Picture;
 *   Upload Photo -- the host's own upload path (each object's bucket and path rules are its own);
 *   Reset to Default -- back to the one fallback rule, where the host offers it.
 *
 * WHAT IS CHOSEN IS A KEY OR A FILE, never a copy of a picture: the host stores the key against the object
 * (`*.cover_stock_key`) or uploads the file, and the server refuses a key the library would not offer for
 * that kind of object.
 */
export type MediaChoice = { kind: "stock"; key: string } | { kind: "upload"; uri: string; mimeType: string } | null

/** What the library offers for each kind of object, in a sentence. */
const LIBRARY_BLURB: Record<StockDomain, string> = {
  VENUE: "Grounds and clubhouses",
  PITCH: "Pitches and training",
  CHANGING_ROOM: "Changing rooms",
  TEAM: "Teams, training and match day",
  EVENT: "Socials, awards, fundraisers and more",
  TOURNAMENT: "Festivals, action and trophies",
}

export function MediaPickerSheet({
  open,
  onClose,
  domain,
  title,
  intro,
  onChoose,
  allowUpload = true,
  uploadAspect = [16, 9],
  showReset = false,
  startInLibrary = false,
  selectedKey,
  ordered,
}: {
  open: boolean
  onClose: () => void
  domain: StockDomain
  title: string
  intro?: string
  onChoose: (choice: MediaChoice) => void
  allowUpload?: boolean
  uploadAspect?: [number, number]
  showReset?: boolean
  /** Open straight into the library -- for a host whose own screen already offers Upload beside it. */
  startInLibrary?: boolean
  selectedKey?: string | null
  /** A host-specific ORDER of the same library pictures (a team's own kind of side first). Never a different set. */
  ordered?: StockMediaEntry[]
}) {
  const [library, setLibrary] = useState(startInLibrary)
  const [picking, setPicking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLibrary(startInLibrary)
      setProblem(null)
    }
  }, [open, startInLibrary])

  async function fromDevice() {
    setProblem(null)
    setPicking(true)
    const result = await choosePhoto({ aspect: uploadAspect })
    setPicking(false)
    if ("cancelled" in result) return
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    onChoose({ kind: "upload", uri: result.file.uri, mimeType: result.file.mimeType })
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }}>
          <Text accessibilityRole="header" style={[type.title, { flex: 1, color: colour.ink }]}>
            {library ? "Ovalball Library" : title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <X size={21} color={colour.inkSubtle} strokeWidth={2.2} />
          </Pressable>
        </View>

        {library ? (
          <StockLibraryBrowser
            domain={domain}
            selectedKey={selectedKey ?? null}
            ordered={ordered}
            onUse={(key) => onChoose({ kind: "stock", key })}
            onBack={startInLibrary ? onClose : () => setLibrary(false)}
            backLabel={startInLibrary ? "Cancel" : "Back"}
          />
        ) : (
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
            {!!intro && <Text style={[type.small, { color: colour.inkMuted, marginBottom: space.xs }]}>{intro}</Text>}
            <SheetRow
              icon={<ImageIcon size={19} color={colour.rugby700} strokeWidth={1.9} />}
              title="Choose From Ovalball Library"
              blurb={LIBRARY_BLURB[domain]}
              onPress={() => setLibrary(true)}
            />
            {allowUpload && (
              <SheetRow
                icon={<Camera size={19} color={colour.rugby700} strokeWidth={1.9} />}
                title="Upload Photo"
                blurb="Use a photo from this device"
                busy={picking}
                onPress={() => void fromDevice()}
              />
            )}
            {showReset && (
              <SheetRow
                icon={<Undo2 size={19} color={colour.rugby700} strokeWidth={1.9} />}
                title="Reset to Default"
                blurb="Go back to the standard Ovalball picture"
                onPress={() => onChoose(null)}
              />
            )}
            {!!problem && <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, paddingHorizontal: space.xs }]}>{problem}</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

/**
 * THE LIBRARY ITSELF -- category chips, a large preview, the grid, and Use This Picture. Used inside the sheet
 * above and on its own where a host gives the library a whole screen (a team's Ovalball Library).
 */
export function StockLibraryBrowser({
  domain,
  selectedKey,
  ordered,
  onUse,
  onBack,
  backLabel = "Back",
  busy = false,
}: {
  domain: StockDomain
  selectedKey: string | null
  ordered?: StockMediaEntry[]
  onUse: (key: string) => void
  onBack: () => void
  backLabel?: string
  busy?: boolean
}) {
  const items = useMemo(() => stockPickerItems(domain, ordered), [domain, ordered])
  const categories = useMemo(() => stockCategoriesFor(domain), [domain])
  const [category, setCategory] = useState<string | null>(null)
  const [preview, setPreview] = useState<StockPickerItem | null>(() => items.find((i) => i.key === selectedKey) ?? null)
  const shown = category ? items.filter((i) => i.category === category) : items
  const illustrative = isIllustrative(domain, "STOCK")

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
        {/* A LARGE PREVIEW ABOVE THE GRID, because a wide photograph judged as a small square is not being
            judged as the thing it will become. */}
        <View style={{ height: 170, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface }}>
          {preview ? (
            <Image source={preview.asset} accessible accessibilityLabel={`Preview: ${preview.label}`} contentFit="cover" style={{ width: "100%", height: "100%" }} transition={140} />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
              <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>Tap a picture to preview it</Text>
            </View>
          )}
        </View>
        <Text style={[type.caption, { color: colour.inkMuted, minHeight: 16 }]}>
          {preview ? preview.label : `${items.length} pictures`}
          {illustrative ? " · Illustrative: shown as an example, not a photo of your own." : ""}
        </Text>

        {categories.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}>
            <FilterChip label="All" selected={category === null} onPress={() => setCategory(null)} count={items.length} />
            {categories.map((c) => (
              <FilterChip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} count={items.filter((i) => i.category === c).length} />
            ))}
          </ScrollView>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {shown.map((img) => {
            const on = preview?.key === img.key
            const current = selectedKey === img.key
            return (
              <Pressable
                key={img.key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={current ? `${img.label}, in use now` : img.label}
                onPress={() => setPreview(img)}
                style={{ width: "31.5%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 3 : current ? 2 : 0, borderColor: on ? colour.forest800 : colour.pitch600 }}
              >
                <Image source={img.asset} accessible={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />
                {on && (
                  <View style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center" }}>
                    <Check size={13} color={colour.onForest} strokeWidth={3} />
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={[type.smallMedium, { color: colour.ink }]}>{backLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use This Picture"
          accessibilityState={{ disabled: !preview || busy, busy }}
          disabled={!preview || busy}
          onPress={() => preview && onUse(preview.key)}
          style={({ pressed }) => ({ flex: 2, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colour.forest800, opacity: !preview ? 0.4 : pressed ? 0.85 : 1 })}
        >
          {busy ? <ActivityIndicator color={colour.onForest} /> : <Text style={[type.smallMedium, { color: colour.onForest }]}>Use This Picture</Text>}
        </Pressable>
      </View>
    </View>
  )
}

function SheetRow({ icon, title, blurb, onPress, busy }: { icon: React.ReactNode; title: string; blurb: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${blurb}`}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 14,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: colour.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 22, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{blurb}</Text>
      </View>
      {busy && <ActivityIndicator color={colour.forest800} />}
    </Pressable>
  )
}

/** The library label for a chosen key, for a caption under a host's preview. */
export function chosenStockLabel(key: string | null | undefined): string | null {
  return stockMedia(key)?.label ?? null
}

/**
 * THE "ILLUSTRATIVE" MARK -- shown over a library picture wherever it could be mistaken for the real place or
 * the real people (`isIllustrative`): a visitor shown a library changing room under a club's name must not
 * think it IS that club's changing room.
 */
export function IllustrativeTag({ placement = "bottom", size = "regular", style }: {
  placement?: "bottom" | "top"
  size?: "regular" | "small"
  /** Only where a picture's own corners are taken (Arena Home's banner, under its floating header controls). */
  style?: StyleProp<ViewStyle>
}) {
  // The Match Centre arena's established mark, now the one every surface uses. A hero whose lower half carries
  // a crest and a name places it at the top instead. On a list THUMBNAIL the regular pill covers most of the
  // picture it describes, so `small` is the same words, for VoiceOver unchanged, as a small forest pip.
  const small = size === "small"
  const inset = small ? 3 : space.xs
  return (
    <View
      accessible
      accessibilityLabel="Illustrative picture, not a photo of the real place"
      style={[{ position: "absolute", left: inset, ...(placement === "top" ? { top: inset } : { bottom: inset }), paddingHorizontal: small ? 4 : space.sm, paddingVertical: small ? 1 : 2, borderRadius: radius.pill, backgroundColor: colour.forest800, opacity: 0.88 }, style]}
    >
      <Text style={[type.caption, { color: colour.surface }, small && { fontSize: 9, lineHeight: 12 }]}>Illustrative</Text>
    </View>
  )
}
