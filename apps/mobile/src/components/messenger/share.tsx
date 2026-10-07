import { ActivityIndicator, Text, View } from "react-native"

import type { useAttachments } from "../../messages/use-attachments"
import { AttachmentSheet } from "../attachment-sheet"
import { ContactCardSheet } from "../message-actions"
import { AttachmentTray } from "./thread"
import { colour, space, type } from "../../design/tokens"

type Attach = ReturnType<typeof useAttachments>

/**
 * SHARING INTO A CONVERSATION -- the same tray and the same sheets in the full conversation and the compact
 * messenger, driven by one `useAttachments`.
 */

/** Above the composer: "Preparing…" while a photo is read, then the chosen photo with its remove control. */
export function ShareAccessory({ attach, hasText }: { attach: Attach; hasText: boolean }) {
  const pending = attach.pending
  const needsCaption = pending !== null && !pending.mimeType.startsWith("image/")
  return (
    <>
      {attach.picking && (
        <View accessible accessibilityLabel="Preparing the file" accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: space.sm }}>
          <ActivityIndicator size="small" color={colour.forest800} />
          <Text style={[type.caption, { color: colour.inkMuted }]}>Preparing…</Text>
        </View>
      )}
      {pending && <AttachmentTray pending={pending} needsCaption={needsCaption && !hasText} onRemove={attach.clearPending} />}
    </>
  )
}

/** Whether the composer may send: words, or a chosen photo that has finished being prepared. */
export function shareReady(attach: Attach, hasText: boolean): boolean {
  const pending = attach.pending
  if (!pending) return hasText
  const needsCaption = !pending.mimeType.startsWith("image/")
  return pending.state !== "uploading" && (hasText || !needsCaption)
}

/** The "Share" grid and the contact card preview. */
export function ShareSheets({ attach, showDocuments }: { attach: Attach; showDocuments: boolean }) {
  return (
    <>
      <AttachmentSheet
        visible={attach.sheetOpen}
        onClose={attach.closeSheet}
        onChoose={(action) => void attach.choose(action)}
        canAttach={attach.support.canAttach}
        reason={attach.support.reason}
        showDocuments={showDocuments}
      />
      <ContactCardSheet
        visible={attach.cardOpen}
        card={attach.card}
        problem={attach.cardProblem}
        sending={attach.cardSending}
        onSend={() => void attach.sendCard()}
        onClose={attach.closeCard}
      />
    </>
  )
}
