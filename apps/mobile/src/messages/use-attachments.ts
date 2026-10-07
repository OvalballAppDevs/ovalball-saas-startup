import { useState } from "react"

import { supabase } from "../auth/supabase"
import { friendly, logDetail } from "../errors/translate"
import { attachmentSupport, sendWithAttachment, type AttachableKind } from "./attachments"
import { choosePhoto, readFileBytes, takePhoto, type PickResult } from "./pickers"
import { previewContactCard, shareContactCard, type ContactCardPreview } from "./contact-card"
import type { AttachmentAction } from "../components/attachment-sheet"
import type { ConversationKind } from "./conversation"

/**
 * WHAT CAN BE SHARED INTO A CONVERSATION, FOR EVERY WINDOW ONTO IT.
 *
 * The full conversation and the compact messenger offer the same four things through the same canonical RPCs --
 * a photo from the library or the camera, a Club Document, a contact card -- so the choosing, the tray and the
 * sending live here once. Club Documents is the one place the two differ: the full screen pushes its picker, the
 * compact messenger shows the same picker inside the panel. That difference is the caller's `onDocuments`.
 */

/** A chosen photo, on its way: chosen and checked, uploading, or refused. */
export interface Picked {
  name: string
  mimeType: string
  sizeBytes: number
  uri: string
  state: "ready" | "uploading" | "failed"
}

export function useAttachments(kind: ConversationKind, id: string, options: { onDocuments: () => void; onSent: () => Promise<void> | void }) {
  const support = attachmentSupport(kind)
  const target = support.canAttach ? (kind as AttachableKind) : null
  const [sheetOpen, setSheetOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pending, setPending] = useState<Picked | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [card, setCard] = useState<ContactCardPreview | null>(null)
  const [cardProblem, setCardProblem] = useState<string | null>(null)
  const [cardSending, setCardSending] = useState(false)

  async function choose(action: AttachmentAction) {
    if (!target) {
      setProblem(support.reason)
      return
    }
    if (action === "documents") {
      options.onDocuments()
      return
    }
    if (action === "contact") {
      setCard(null)
      setCardProblem(null)
      setCardOpen(true)
      const preview = await previewContactCard(supabase, target, id)
      if (preview.ok) setCard(preview.card)
      else setCardProblem(preview.message)
      return
    }
    setProblem(null)
    setPicking(true)
    let result: PickResult
    try {
      result = action === "camera" ? await takePhoto() : await choosePhoto()
    } catch (caught) {
      logDetail("attachment picker", friendly(caught, "that file"))
      result = { ok: false, message: "Couldn't open that. Try again." }
    }
    setPicking(false)
    if ("cancelled" in result) return
    if (!result.ok) {
      setProblem(result.message)
      return
    }
    setPending({ ...result.file, state: "ready" })
  }

  /** Send the chosen photo with its optional caption. The bytes are read now, not when it was chosen. */
  async function sendPending(caption: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!pending || !target) return { ok: false, message: support.reason ?? "Attachments aren't available here." }
    const file = pending
    setPending({ ...file, state: "uploading" })
    setProblem(null)
    const bytes = await readFileBytes(file.uri)
    const result = bytes
      ? await sendWithAttachment(supabase, target, id, caption, { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, bytes })
      : ({ ok: false, message: "Couldn't read that file. Choose it again." } as const)
    if (!result.ok) {
      setPending({ ...file, state: "failed" })
      setProblem(result.message)
      return result
    }
    setPending(null)
    await options.onSent()
    return result
  }

  async function sendCard() {
    if (cardSending || !target) return
    setCardSending(true)
    setCardProblem(null)
    const result = await shareContactCard(supabase, target, id)
    setCardSending(false)
    if (!result.ok) {
      setCardProblem(result.message)
      return
    }
    setCardOpen(false)
    await options.onSent()
  }

  return {
    support,
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    choose,
    picking,
    pending,
    clearPending: () => {
      setPending(null)
      setProblem(null)
    },
    sendPending,
    problem,
    setProblem,
    cardOpen,
    closeCard: () => setCardOpen(false),
    card,
    cardProblem,
    cardSending,
    sendCard,
  }
}
