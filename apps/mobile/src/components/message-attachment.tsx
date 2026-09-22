import { useState } from "react"
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native"
import { Image } from "expo-image"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ThreadAttachment, ThreadDocumentShare } from "@ovalball/contracts"

import { openAttachment } from "../messages/open-attachment"
import { readableSize } from "../messages/documents"
import { FileText, X } from "./icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHAT SOMEBODY SENT YOU, INSIDE THE BUBBLE THAT SENT IT.
 *
 * AN IMAGE IS SHOWN, NOT DESCRIBED. A row reading "photo.jpg · 840 KB" makes somebody tap to find out
 * whether it is the team sheet they are waiting for. The thumbnail is the message.
 *
 * A DOCUMENT IS A ROW, because a PDF has no useful thumbnail at this size and a page of a fixture
 * agreement rendered 60px tall tells nobody anything. The row carries what identifies it: the name the
 * sender's device gave it and its size.
 *
 * TAPPING AN IMAGE STAYS IN OVALBALL. A full-screen view inside the app, not a browser: the signed URL
 * is a bearer credential for a private file and must not end up in Safari's history. Tapping a DOCUMENT
 * goes to the system's own preview, which is the native reader and still never leaves the sandbox.
 *
 * `signedUrl` IS THE CANONICAL READER'S. It is short-lived and re-issued per read, so a thumbnail that
 * has been on screen for an hour simply fails to load rather than becoming a permanent public link --
 * and nothing here caches it, persists it or logs it.
 */

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export function MessageAttachment({ attachment, mine }: { attachment: ThreadAttachment; mine: boolean }) {
  return (
    <Attached
      mine={mine}
      id={attachment.id}
      filename={attachment.filename}
      mimeType={attachment.mimeType}
      sizeBytes={attachment.sizeBytes}
      signedUrl={attachment.signedUrl}
      label={null}
    />
  )
}

/**
 * A shared club document, marked as one.
 *
 * It is NOT the same thing as an uploaded file and the bubble says so: this is a reference to the
 * club's own library, so it is titled by the document's title and captioned with its category. Somebody
 * reading it should know they are looking at the club's current Visitor Guide rather than a copy
 * somebody took a while ago.
 */
export function MessageDocumentShare({ share, mine }: { share: ThreadDocumentShare; mine: boolean }) {
  return (
    <Attached
      mine={mine}
      id={share.id}
      filename={share.filename}
      mimeType={share.mimeType}
      sizeBytes={share.sizeBytes}
      signedUrl={share.signedUrl}
      title={share.title}
      label={share.category ? `Club document · ${share.category}` : "Club document"}
    />
  )
}

function Attached({
  mine,
  id,
  filename,
  mimeType,
  sizeBytes,
  signedUrl,
  title,
  label,
}: {
  mine: boolean
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  signedUrl: string | null
  title?: string
  label: string | null
}) {
  const [preview, setPreview] = useState(false)
  const [opening, setOpening] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const isImage = IMAGE_TYPES.has(mimeType)
  const name = title ?? filename
  const size = readableSize(sizeBytes)

  async function open() {
    if (opening) return
    setFailure(null)
    if (isImage) {
      if (!signedUrl) {
        setFailure("This image isn't available to open just now.")
        return
      }
      setPreview(true)
      return
    }
    setOpening(true)
    const result = await openAttachment({ id, filename, mimeType, signedUrl })
    setOpening(false)
    if (!result.ok) setFailure(result.message)
  }

  return (
    <View style={{ marginTop: space.xs, gap: 4 }}>
      {!!label && (
        <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.8)" : colour.inkMuted, fontSize: 10 }]}>
          {label}
        </Text>
      )}

      {isImage && !!signedUrl ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`${name}. Open full size`}
          onPress={() => void open()}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Image
            source={{ uri: signedUrl }}
            // A sent photo is 1600px on its long edge; 220 high is a legible thumbnail at phone width
            // without guessing an aspect ratio the sender did not choose.
            style={{ width: 216, height: 216, borderRadius: radius.md, backgroundColor: colour.mint100 }}
            contentFit="cover"
            transition={140}
            accessible={false}
          />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}${size ? `, ${size}` : ""}. Open`}
          accessibilityState={{ busy: opening }}
          onPress={() => void open()}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.sm + 2,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            backgroundColor: mine ? "rgba(255,255,255,0.16)" : colour.chalk,
            borderWidth: 1,
            borderColor: mine ? "rgba(255,255,255,0.22)" : colour.line,
            opacity: pressed ? 0.85 : 1,
            maxWidth: 240,
          })}
        >
          {opening ? (
            <ActivityIndicator size="small" color={mine ? colour.onForest : colour.forest800} />
          ) : (
            <FileText size={18} color={mine ? colour.onForest : colour.forest800} strokeWidth={1.9} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={[type.caption, { color: mine ? colour.onForest : colour.ink, fontSize: 12 }]}>
              {name}
            </Text>
            {!!size && (
              <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.75)" : colour.inkMuted, fontSize: 10 }]}>
                {size}
              </Text>
            )}
          </View>
        </Pressable>
      )}

      {!!failure && (
        <Text accessibilityRole="alert" style={[type.caption, { color: mine ? "rgba(255,255,255,0.9)" : colour.danger, fontSize: 11 }]}>
          {failure}
        </Text>
      )}

      {isImage && !!signedUrl && (
        <ImagePreview visible={preview} url={signedUrl} name={name} onClose={() => setPreview(false)} />
      )}
    </View>
  )
}

/**
 * Full size, in the app.
 *
 * `contain` rather than `cover`: a team sheet cropped to fill the screen is a team sheet with its
 * bottom row missing, which is precisely the information somebody opened it for.
 */
function ImagePreview({
  visible,
  url,
  name,
  onClose,
}: {
  visible: boolean
  url: string
  name: string
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
        <Image
          source={{ uri: url }}
          style={{ flex: 1 }}
          contentFit="contain"
          accessibilityLabel={name}
          transition={160}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            position: "absolute",
            top: insets.top + space.sm,
            right: space.md,
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            borderRadius: TOUCH_TARGET / 2,
            backgroundColor: "rgba(7,28,20,0.6)",
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <X size={22} color={colour.onForest} strokeWidth={2.2} />
        </Pressable>
      </View>
    </Modal>
  )
}
