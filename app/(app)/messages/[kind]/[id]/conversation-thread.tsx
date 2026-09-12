"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, FileText, FolderOpen, IdCard, Paperclip, Phone, Plus, X } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents/categories"
import type {
  ThreadAttachment,
  ThreadContactCard,
  ThreadDocumentShare,
  ThreadMessage,
} from "@/lib/messenger/thread-types"
import { Composer } from "@/components/messenger/composer"
import { MessageThread } from "@/components/messenger/message-thread"

export type { ThreadAttachment, ThreadContactCard, ThreadDocumentShare, ThreadMessage }

import { deleteOwnMessage, reportMessage, sendFixtureMessage, sendFixtureMessageWithAttachment, type ConversationKind } from "../../actions"
import { previewMyContactCard, shareContactCard, type ContactCardPreview } from "./contact-card"
import { listShareableDocuments, shareDocumentToConversation, type ShareableDocument } from "./document-share"

const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp"
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

/**
 * The chosen file, shown before it is sent. An object URL rather than a
 * server round trip: nothing has been uploaded yet at this point, and the
 * URL is revoked as soon as the file changes so a long composing session
 * does not leak them.
 */
function PendingFileThumbnail({ file }: { file: File }) {
  // Derived during render rather than stored in state: the URL is a pure
  // function of the file, so keeping a copy in state only creates a second
  // thing that can be wrong. useMemo also lets the previous one be revoked
  // exactly when the file changes.
  const url = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file])

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  if (!url) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-ink/10">
        <Paperclip className="size-4 text-ink-muted" aria-hidden="true" />
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL for a file the person just chose, not an optimizable asset
    <img src={url} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-ink/10" />
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

function AttachmentView({ attachment }: { attachment: ThreadAttachment }) {
  const isImage = attachment.mimeType.startsWith("image/")
  if (isImage && attachment.signedUrl) {
    return (
      <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="mt-2 block max-w-[220px] overflow-hidden rounded-lg border border-ink/10">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-URL attachment, not an optimizable static asset */}
        <img src={attachment.signedUrl} alt={attachment.filename} className="max-h-48 w-full object-cover" />
      </a>
    )
  }
  return (
    <a
      href={attachment.signedUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-2.5 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-ink hover:border-ink/20"
    >
      <FileText className="size-5 shrink-0 text-forest-800" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{attachment.filename}</p>
        <p className="text-xs text-ink-muted">{formatBytes(attachment.sizeBytes)}</p>
      </div>
    </a>
  )
}

function DocumentShareView({ share }: { share: ThreadDocumentShare }) {
  return (
    <a
      href={share.signedUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-2.5 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-ink hover:border-ink/20"
    >
      <FolderOpen className="size-5 shrink-0 text-forest-800" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{share.title}</p>
        <p className="text-xs text-ink-muted">
          {DOCUMENT_CATEGORY_LABEL[share.category] ?? share.category} &middot; {formatBytes(share.sizeBytes)}
        </p>
      </div>
    </a>
  )
}

function ContactCardView({ card }: { card: ThreadContactCard }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 w-64 rounded-lg border border-ink/10 bg-white px-3.5 py-3 text-ink">
      <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Contact</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium">
        <IdCard className="size-4 shrink-0 text-forest-800" />
        {card.displayName}
      </p>
      <p className="mt-0.5 text-xs text-ink/60">
        {card.roleLabel} &middot; {card.clubName}
        {card.teamName ? ` · ${card.teamName}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-chalk px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Phone className="size-3.5 shrink-0 text-ink-muted" />
          {card.telephone}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <a
            href={`tel:${card.telephone.replace(/\s+/g, "")}`}
            className="flex min-h-9 items-center rounded px-2.5 py-2 text-xs font-medium text-forest-800 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Call
          </a>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(card.telephone)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            aria-label="Copy telephone number"
            title="Copy number"
            className="flex size-9 items-center justify-center rounded text-ink-muted outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      </div>
      {copied && <p className="mt-1 text-[11px] text-pitch-700">Copied.</p>}
    </div>
  )
}

function ContactCardPicker({
  kind,
  id,
  onShare,
  onClose,
}: {
  kind: ConversationKind
  id: string
  onShare: (preview: ContactCardPreview) => Promise<void>
  onClose: () => void
}) {
  const [preview, setPreview] = useState<ContactCardPreview | null | "loading">("loading")
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let active = true
    previewMyContactCard(kind, id).then((result) => {
      if (active) setPreview(result)
    })
    return () => {
      active = false
    }
  }, [kind, id])

  return (
    <div className="mt-2 rounded-lg border border-ink/15 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Share contact card</p>
        <button type="button" onClick={onClose} aria-label="Close contact card preview" className="rounded p-0.5 text-ink-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      {preview === "loading" ? (
        <p className="mt-2 text-sm text-ink-muted">Loading…</p>
      ) : !preview || !preview.telephone || !preview.roleLabel ? (
        <div className="mt-2">
          <p className="text-sm text-ink/60">
            {!preview?.roleLabel
              ? "You don't have a club role on this fixture to share a contact card from."
              : "Your contact card doesn't have a telephone number yet."}
          </p>
          {preview && !preview.telephone && preview.roleLabel && (
            <a href="/account" className="mt-1.5 inline-block text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
              Add telephone number
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 rounded-md border border-ink/10 bg-chalk px-3 py-2.5">
            <p className="text-sm font-medium text-ink">{preview.displayName}</p>
            <p className="mt-0.5 text-xs text-ink/60">
              {preview.roleLabel} &middot; {preview.clubName}
              {preview.teamName ? ` · ${preview.teamName}` : ""}
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink/70">
              <Phone className="size-3.5 text-ink-muted" />
              {preview.telephone}
            </p>
          </div>
          <p className="mt-2 text-xs text-ink-muted">This shares these contact details with the authorised participants in this fixture conversation.</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={sharing}
              onClick={async () => {
                setSharing(true)
                await onShare(preview)
                setSharing(false)
              }}
              className="rounded-md bg-pitch-600 px-3 py-1.5 text-sm font-medium text-white outline-none hover:bg-pitch-600/90 disabled:opacity-50"
            >
              {sharing ? "Sharing…" : "Share contact card"}
            </button>
            <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink/70">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function DocumentPicker({ onShare, onClose }: { onShare: (doc: ShareableDocument) => void; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [docs, setDocs] = useState<ShareableDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [sharingId, setSharingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const timeout = setTimeout(async () => {
      if (!active) return
      setLoading(true)
      const result = await listShareableDocuments(query)
      if (active) {
        setDocs(result)
        setLoading(false)
      }
    }, 200)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [query])

  return (
    <div className="mt-2 rounded-lg border border-ink/15 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Share a document</p>
        <button type="button" onClick={onClose} aria-label="Close document picker" className="rounded p-0.5 text-ink-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your club's documents…"
        className="mt-2 h-9 w-full rounded-md border border-ink/15 px-2.5 text-sm outline-none focus-visible:border-pitch-600"
      />
      <ul className="mt-2 max-h-56 overflow-y-auto">
        {loading ? (
          <li className="px-1 py-3 text-sm text-ink-muted">Loading…</li>
        ) : docs.length === 0 ? (
          <li className="px-1 py-3 text-sm text-ink-muted">
            {query.trim().length >= 2 ? "No documents match." : "No documents in your library yet."}
          </li>
        ) : (
          docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-2 hover:bg-ink/[0.03]">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{d.title}</p>
                <p className="text-xs text-ink-muted">
                  {DOCUMENT_CATEGORY_LABEL[d.category] ?? d.category} &middot; {formatBytes(d.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                disabled={sharingId === d.id}
                onClick={async () => {
                  setSharingId(d.id)
                  await onShare(d)
                  setSharingId(null)
                }}
                className="shrink-0 rounded-md bg-pitch-600 px-2.5 py-1 text-xs font-medium text-white outline-none hover:bg-pitch-600/90 disabled:opacity-50"
              >
                {sharingId === d.id ? "Sharing…" : "Share"}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}


/**
 * THE WORKSPACE CONVERSATION.
 *
 * Renders the SAME MessageThread and the SAME Composer as the compact
 * Messenger in the header. What it adds is what a bigger surface earns: the
 * attachment, club-document and contact-card affordances, which the panel
 * deliberately does not offer because offering them there would mean
 * inventing them.
 *
 * Everything else -- bubble ownership, grouping, date separators, system
 * events, arrival handling, the failed-send behaviour -- is the shared
 * implementation, so the two surfaces cannot drift into two products.
 */
export function ConversationThread({
  kind,
  id,
  initialMessages,
  sendingAsClubName,
  sendingAsTeamName,
  sendingAsClubLogoUrl,
  canCompose = true,
}: {
  kind: ConversationKind
  id: string
  initialMessages: ThreadMessage[]
  sendingAsClubName: string
  sendingAsTeamName: string
  sendingAsClubLogoUrl: string | null
  /** False for a club conversation that has not been accepted yet. */
  canCompose?: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = useState(initialMessages)
  // A live broadcast triggers router.refresh(), which re-renders the server
  // page with fresh initialMessages. React never re-runs a useState
  // initializer on a prop change, so without this the already-mounted client
  // would keep showing its first-mount snapshot for ever. Adjusting state
  // during render is React's own documented pattern for "reset state when a
  // prop changes"; an effect would set it a render late.
  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages)
  if (initialMessages !== prevInitialMessages) {
    setPrevInitialMessages(initialMessages)
    setMessages(initialMessages)
  }

  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactPickerOpen, setContactPickerOpen] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSend(body: string) {
    const result = pendingFile
      ? await sendFixtureMessageWithAttachment(kind, id, body, pendingFile)
      : await sendFixtureMessage(kind, id, body)
    if (!result.ok) return result
    setPendingFile(null)
    // Re-read from the server rather than push a local copy: the message shown
    // is the message stored, which is what keeps this surface, the compact
    // Messenger and the conversation preview showing the same thing.
    router.refresh()
    return { ok: true as const }
  }

  async function handleShareDocument(doc: ShareableDocument) {
    setAttachError(null)
    const result = await shareDocumentToConversation(kind, id, doc.id)
    if (!result.ok) {
      setAttachError(result.error)
      return
    }
    setPickerOpen(false)
    router.refresh()
  }

  async function handleShareContactCard() {
    setAttachError(null)
    const result = await shareContactCard(kind, id)
    if (!result.ok) {
      setAttachError(result.error)
      return
    }
    setContactPickerOpen(false)
    router.refresh()
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setAttachError(null)
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError("Attachments must be 2MB or smaller.")
      return
    }
    setPendingFile(file)
  }

  return (
    // No card around the conversation. The pane IS the conversation: history
    // scrolls, composer is pinned to the foot of it, and nothing nests.
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-chalk">
      <MessageThread
        messages={messages}
        density="full"
        renderExtras={(m) => (
          <>
            {m.attachment && <AttachmentView attachment={m.attachment} />}
            {m.documentShare && <DocumentShareView share={m.documentShare} />}
            {m.contactCard && <ContactCardView card={m.contactCard} />}
          </>
        )}
        onDeleteMessage={async (messageId) => {
          const result = await deleteOwnMessage(messageId)
          if (result.ok) router.refresh()
          return result
        }}
        onReportMessage={async (messageId, reason) => {
          const result = await reportMessage(messageId, reason)
          if (result.ok) router.refresh()
          return result
        }}
        emptyTitle="No messages yet"
        emptyBody={
          kind === "club"
            ? "Say hello, and what you'd like to arrange."
            : "Confirm the kick-off time, the pitch, or anything else about this fixture."
        }
      />
      <Composer
        onSend={handleSend}
        attachmentReady={pendingFile !== null}
        disabled={!canCompose}
        disabledReason="This conversation isn't open yet. Once the message request is accepted, you can reply here."
        // WHO YOU ARE SENDING AS is one quiet line under the box, not its own
        // bordered strip above it. It answers a question people ask once.
        footnote={
          <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-subtle">
            <ClubAvatar logoUrl={sendingAsClubLogoUrl} name={sendingAsClubName} size="xs" />
            <span className="truncate">As {sendingAsTeamName || sendingAsClubName}</span>
          </p>
        }
        // The attachment menu belongs ON the composer row, beside Send, where
        // every other product puts it -- not on a strip of its own above.
        leading={
          kind === "club" ? null : (
            <>
              <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={handleFilePicked} className="hidden" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Add to message"
                      title="Add to message"
                      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-chalk text-ink-muted ring-1 ring-ink/12 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <Plus className="size-[18px]" aria-hidden="true" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuItem className="items-start py-2" onClick={() => setPickerOpen((v) => !v)}>
                    <FolderOpen className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div>
                      <p>Document</p>
                      <p className="text-xs text-ink-muted">Share from your club library</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="items-start py-2" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div>
                      <p>Attach a File</p>
                      <p className="text-xs text-ink-muted">One-off image or PDF</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="items-start py-2" onClick={() => setContactPickerOpen((v) => !v)}>
                    <IdCard className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div>
                      <p>Contact Card</p>
                      <p className="text-xs text-ink-muted">Share your name, role and telephone number</p>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
        extras={
          kind === "club" ? null : (
            <div className="empty:hidden">
              {pendingFile && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-chalk px-2 py-2 ring-1 ring-ink/10">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/* A PICTURE, WHERE THERE IS A PICTURE. A paperclip and a
                        filename is what you show for a PDF; for an image the
                        useful confirmation is the image itself, so somebody
                        can see they picked the right one before sending. */}
                    <PendingFileThumbnail file={pendingFile} />
                    <p className="truncate text-xs text-ink/70">
                      {pendingFile.name} <span className="text-ink-muted">&middot; {formatBytes(pendingFile.size)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingFile(null)}
                    aria-label="Remove attachment"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
              {pickerOpen && <DocumentPicker onShare={handleShareDocument} onClose={() => setPickerOpen(false)} />}
              {contactPickerOpen && (
                <ContactCardPicker kind={kind} id={id} onShare={handleShareContactCard} onClose={() => setContactPickerOpen(false)} />
              )}
              {attachError && (
                <p role="alert" className="mb-2 text-sm text-destructive-text">
                  {attachError}
                </p>
              )}
            </div>
          )
        }
      />

    </div>
  )
}
