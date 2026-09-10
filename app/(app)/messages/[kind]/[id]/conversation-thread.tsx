"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, ArrowUp, Copy, FileText, Flag, FolderOpen, IdCard, Loader2, Lock, MoreHorizontal, Paperclip, Phone, Plus, Send, Trash2, X } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { UserAvatar } from "@/components/profile/user-avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents/categories"
import { cn } from "@/lib/utils"

import { deleteOwnMessage, reportMessage, sendFixtureMessage, sendFixtureMessageWithAttachment, type ConversationKind } from "../../actions"
import { previewMyContactCard, shareContactCard, type ContactCardPreview } from "./contact-card"
import { listShareableDocuments, shareDocumentToConversation, type ShareableDocument } from "./document-share"

export interface ThreadAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  signedUrl: string | null
}

export interface ThreadDocumentShare {
  id: string
  title: string
  category: string
  filename: string
  mimeType: string
  sizeBytes: number
  signedUrl: string | null
}

export interface ThreadContactCard {
  displayName: string
  roleLabel: string
  clubName: string
  teamName: string | null
  telephone: string
}

export interface ThreadMessage {
  id: string
  body: string
  createdAt: string
  /**
   * WRITTEN BY THE SIGNED-IN PERSON. The one thing that decides which side of
   * the thread a message sits on and which colour it is.
   *
   * There used to be an `isOwnClub` beside this, and the bubbles were coloured
   * by it: a Fixture Secretary reading a thread saw their Club Admin
   * colleague's messages styled as their own. That is a misattribution rather
   * than a styling choice -- in a club communications product, "who said this"
   * has to survive switching context -- so the club-scoped flag was removed
   * rather than left available.
   */
  isOwn: boolean
  isSystemEvent: boolean
  /** True once soft_delete_own_message()/moderator_delete_message() has tombstoned this message -- `body` is already the tombstone text by this point, never the original content. */
  isDeleted: boolean
  /** Only the sender, and only before it's already deleted (Section 87 -- never someone else's message). */
  canDelete: boolean
  /** Never your own message, never an already-deleted one, never a system event. */
  canReport: boolean
  senderName: string
  senderRoleLabel: string
  senderClubName: string
  senderAvatarUrl: string | null
  attachment: ThreadAttachment | null
  documentShare: ThreadDocumentShare | null
  contactCard: ThreadContactCard | null
}

const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp"
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

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

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * The small, restrained per-message Report/Delete control (Section 81/83)
 * -- a plain text link, never a prominent button, appearing only for the
 * messages it actually applies to (ThreadMessage.canReport/canDelete are
 * already computed server-side from isOwn/isDeleted, never re-derived
 * here). Deleting or reporting updates local state directly rather than
 * refetching the whole thread.
 */
function MessageActions({ message, onDeleted }: { message: ThreadMessage; onDeleted: () => void }) {
  const [mode, setMode] = useState<"idle" | "reporting" | "confirming-delete">("idle")
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [done, setDone] = useState<"reported" | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!message.canReport && !message.canDelete) return null

  async function handleReport() {
    if (!reason.trim()) return
    setWorking(true)
    setError(null)
    const result = await reportMessage(message.id, reason.trim())
    setWorking(false)
    if (result.ok) {
      setDone("reported")
      setMode("idle")
    } else {
      setError(result.error)
    }
  }

  async function handleDelete() {
    setWorking(true)
    setError(null)
    const result = await deleteOwnMessage(message.id)
    setWorking(false)
    if (result.ok) onDeleted()
    else setError(result.error)
  }

  if (done === "reported") {
    return <p className="mt-1 text-[11px] text-ink-muted">Reported to Ovalball support.</p>
  }

  if (mode === "reporting") {
    return (
      <div className="mt-1.5 w-full max-w-[80%] rounded-lg border border-ink/15 bg-chalk p-2.5">
        <label className="text-xs font-medium text-ink/60" htmlFor={`report-reason-${message.id}`}>
          Why are you reporting this message?
        </label>
        <textarea
          id={`report-reason-${message.id}`}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-none rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus-visible:border-pitch-600"
        />
        {error && <p className="mt-1 text-xs text-destructive-text">{error}</p>}
        <div className="mt-1.5 flex items-center gap-3">
          <button type="button" disabled={working || !reason.trim()} onClick={handleReport} className="text-xs font-medium text-destructive-text disabled:opacity-50">
            {working ? "Sending…" : "Send Report"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-ink-muted hover:text-ink/70">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (mode === "confirming-delete") {
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[11px] text-ink-muted">Delete this message?</span>
        <button type="button" disabled={working} onClick={handleDelete} className="text-[11px] font-medium text-destructive-text disabled:opacity-50">
          {working ? "Deleting…" : "Confirm"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="text-[11px] text-ink-muted hover:text-ink/70">
          Cancel
        </button>
      </div>
    )
  }

  // DISCOVERABLE, BUT SECONDARY.
  //
  // Report and Delete used to sit under every single message as two lines of
  // bare text, so a thread of ten messages carried twenty safety controls in
  // permanent view -- which is both visual noise and a strange thing to put in
  // front of somebody reading about a pitch inspection. They now live behind
  // one quiet overflow control on the message they act on.
  //
  // ALWAYS RENDERED, never hover-only: a phone has no hover, and a control
  // that only exists under a pointer does not exist on a touchscreen. It is
  // simply low-contrast until it is hovered or focused.
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`More actions for the message from ${message.senderName}`}
              className="flex size-7 items-center justify-center rounded-full text-ink-subtle opacity-60 outline-none transition-opacity hover:bg-ink/5 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-48">
          {message.canReport && (
            <DropdownMenuItem onClick={() => setMode("reporting")} className="text-destructive-text">
              <Flag className="size-3.5 shrink-0" aria-hidden="true" />
              Report Message
            </DropdownMenuItem>
          )}
          {message.canDelete && (
            <DropdownMenuItem onClick={() => setMode("confirming-delete")} className="text-destructive-text">
              <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
              Delete Message
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="ml-1 text-[11px] text-destructive-text">{error}</span>}
    </div>
  )
}

/**
 * ONE CONVERSATION.
 *
 * NEWEST MESSAGE AT THE TOP, with the composer above it. A deliberate choice,
 * and reaffirmed rather than inherited: these are operational, infrequent,
 * reference-heavy club conversations -- confirm a kick-off time, check a
 * venue, agree a pitch -- opened to find the latest answer rather than to read
 * a back-and-forth from the beginning. Realtime behaviour is adapted to that
 * order rather than the order being changed to suit realtime; see the arrival
 * handling below.
 *
 * BUBBLE OWNERSHIP IS THE AUTHENTICATED SENDER, full stop. Mine is blue and on
 * the right, everyone else's is green and on the left, and the shape and
 * alignment say the same thing as the colour so the thread survives without
 * hue. This replaced a club-scoped rule under which a Fixture Secretary saw a
 * colleague's messages as their own.
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
  /** False for a club conversation that hasn't been accepted yet -- the
   * request's first message is still shown, but there's nothing to
   * compose until the recipient answers the Message Request. */
  canCompose?: boolean
}) {
  const [messages, setMessages] = useState(initialMessages)
  // useState's initializer only runs on first mount -- without this, a
  // live broadcast-triggered router.refresh() (see useFixturePresence)
  // re-renders the SERVER page with fresh initialMessages, but this
  // already-mounted client component would keep showing its stale first-
  // mount snapshot forever, since React never re-runs a useState
  // initializer on a prop change. This also replaces every
  // "optimistic-..." entry above with the real server row (their own
  // comments already anticipated "until the next full page load" -- this
  // is that load, arriving automatically instead of manually). Adjusting
  // state during render (React's own documented pattern for "reset state
  // when a prop changes"), not in an effect -- an effect would setState
  // one render late, causing an extra cascading render for no benefit.
  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages)
  if (initialMessages !== prevInitialMessages) {
    setPrevInitialMessages(initialMessages)
    setMessages(initialMessages)
  }
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactPickerOpen, setContactPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleShareDocument(doc: ShareableDocument) {
    setError(null)
    const result = await shareDocumentToConversation(kind, id, doc.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPickerOpen(false)
    // Same "explicit recoverable state, never a fabricated URL" pattern as
    // the attachment optimistic-send below -- the real signed URL only
    // exists after a full reload, so this shows without a working link
    // until then.
    setMessages((prev) => [
      {
        id: `optimistic-${Date.now()}`,
        body: `Shared document: ${doc.title}`,
        createdAt: new Date().toISOString(),
        isOwn: true,
        isSystemEvent: false,
        isDeleted: false,
        canDelete: false,
        canReport: false,
        senderName: "You",
        senderRoleLabel: "",
        senderClubName: "",
        senderAvatarUrl: null,
        attachment: null,
        documentShare: { id: doc.id, title: doc.title, category: doc.category, filename: doc.originalFilename, mimeType: "", sizeBytes: doc.sizeBytes, signedUrl: null },
        contactCard: null,
      },
      ...prev,
    ])
  }

  async function handleShareContactCard(preview: ContactCardPreview) {
    setError(null)
    const result = await shareContactCard(kind, id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setContactPickerOpen(false)
    setMessages((prev) => [
      {
        id: `optimistic-${Date.now()}`,
        body: `${preview.displayName} shared a contact card`,
        createdAt: new Date().toISOString(),
        isOwn: true,
        isSystemEvent: false,
        isDeleted: false,
        canDelete: false,
        canReport: false,
        senderName: "You",
        senderRoleLabel: "",
        senderClubName: "",
        senderAvatarUrl: null,
        attachment: null,
        documentShare: null,
        contactCard: {
          displayName: preview.displayName,
          roleLabel: preview.roleLabel!,
          clubName: preview.clubName!,
          teamName: preview.teamName,
          telephone: preview.telephone!,
        },
      },
      ...prev,
    ])
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setError(null)
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachments must be 2MB or smaller.")
      return
    }
    setPendingFile(file)
  }

  async function handleSend() {
    const body = draft.trim()
    if ((!body && !pendingFile) || sending) return
    setSending(true)
    setError(null)

    const result = pendingFile
      ? await sendFixtureMessageWithAttachment(kind, id, body, pendingFile)
      : await sendFixtureMessage(kind, id, body)
    setSending(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    // Optimistic prepend (newest-first) -- we know our own identity
    // locally, no need to refetch the whole thread just to show the
    // message we just sent. An attached file needs a real signed URL from
    // the server, so a sent attachment briefly shows without a preview
    // until the next full page load -- acceptable, never a fabricated URL.
    setMessages((prev) => [
      {
        id: `optimistic-${Date.now()}`,
        body: body || (pendingFile ? `Attached: ${pendingFile.name}` : ""),
        createdAt: new Date().toISOString(),
        isOwn: true,
        isSystemEvent: false,
        isDeleted: false,
        canDelete: false,
        canReport: false,
        senderName: "You",
        senderRoleLabel: "",
        senderClubName: "",
        senderAvatarUrl: null,
        attachment: pendingFile
          ? { id: "optimistic", filename: pendingFile.name, mimeType: pendingFile.type, sizeBytes: pendingFile.size, signedUrl: null }
          : null,
        documentShare: null,
        contactCard: null,
      },
      ...prev,
    ])
    setDraft("")
    setPendingFile(null)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ---------------------------------------------------------------------
  // ORDER: NEWEST AT THE TOP, and the composer above it.
  //
  // Deliberately not the usual chat order. These are operational, reference-
  // heavy club conversations -- confirm a kick-off, check a venue, agree a
  // pitch -- opened to find out the latest thing rather than to read a
  // back-and-forth from the beginning. The most recent message is the answer,
  // so it is the first thing on screen and the reply box is next to it.
  // ---------------------------------------------------------------------
  const ordered = [...messages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // ---------------------------------------------------------------------
  // REALTIME, WITHOUT BEING SHOVED.
  //
  // A message arriving must never move what somebody is currently reading.
  // Because new messages land at the TOP, a reader who has scrolled down into
  // history is exactly the person who would be disturbed by it -- so:
  //
  //   at (or near) the top   the new message is simply there, in view
  //   reading older content  the scroll position is left alone and a quiet
  //                          "new messages" control appears
  //
  // The screen reader announcement is the same one, once, from a single
  // status region -- not aria-live over the whole list, which announces every
  // re-render of every message and is worse than silence.
  // ---------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pendingArrivals, setPendingArrivals] = useState(0)
  const seenCount = useRef(ordered.length)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    // Scrolling back to the top IS reading the new messages, so the pill goes.
    // (Whether a reader is away is read from the DOM at arrival time, not from
    // this state -- see the arrival effect below.)
    const onScroll = () => {
      if (node.scrollTop <= 48) setPendingArrivals(0)
    }
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => node.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const arrived = ordered.length - seenCount.current
    seenCount.current = ordered.length
    if (arrived <= 0) return
    // ASK THE DOM WHERE THE READER IS, at the moment the message lands.
    //
    // Reading the `awayFromTop` state here instead looked equivalent and was
    // not: this effect closes over whatever that state was when it last ran,
    // so a message arriving after a scroll saw the stale value and the pill
    // never appeared. The scroll position is a fact about the DOM, so it is
    // read from the DOM.
    const node = scrollRef.current
    if (!node || node.scrollTop <= 48) return
    // Only a reader who has moved away needs telling; for everyone else the
    // message is already on screen and an announcement would be noise.
    setPendingArrivals((n) => n + arrived)
  }, [ordered.length])

  function jumpToLatest() {
    // scrollTop, not scrollTo({ behavior: "smooth" }).
    //
    // The smooth version silently did nothing on this container while still
    // clearing the pill -- so pressing "new messages" dismissed the offer and
    // left the reader exactly where they were, which is worse than not
    // offering it. Assigning scrollTop always works, and going straight there
    // is also the right answer for anyone who has asked for reduced motion.
    const node = scrollRef.current
    if (node) node.scrollTop = 0
    setPendingArrivals(0)
  }

  const canSend = Boolean(draft.trim() || pendingFile)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-ink/10 bg-white">
      {/* -----------------------------------------------------------------
          THE COMPOSER, at the top, beside the newest message.
          ----------------------------------------------------------------- */}
      <div className="shrink-0 border-b border-ink/10 bg-white px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-1.5">
          <ClubAvatar logoUrl={sendingAsClubLogoUrl} name={sendingAsClubName} size="xs" />
          <p className="text-xs text-ink-muted">
            Sending as{" "}
            <span className="font-medium text-ink/75">
              {sendingAsClubName}
              {sendingAsTeamName ? ` · ${sendingAsTeamName}` : ""}
            </span>
          </p>
        </div>
        {!canCompose ? (
          // NOT A HIDDEN CONTROL. The composer is replaced by an explanation
          // of why there is nothing to type into, so a restricted conversation
          // looks deliberately restricted rather than broken.
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-chalk px-3.5 py-2.5 text-sm text-ink-muted">
            <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <span>
              This conversation isn&rsquo;t open yet. Once the message request is accepted, you can reply here.
            </span>
          </p>
        ) : (
          <>
            {pendingFile && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-ink/15 bg-chalk px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <p className="truncate text-xs text-ink/70">
                    {pendingFile.name} <span className="text-ink-muted">&middot; {formatBytes(pendingFile.size)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  aria-label="Remove attachment"
                  className="flex size-8 shrink-0 items-center justify-center rounded text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
            {pickerOpen && <DocumentPicker onShare={handleShareDocument} onClose={() => setPickerOpen(false)} />}
            {contactPickerOpen && <ContactCardPicker kind={kind} id={id} onShare={handleShareContactCard} onClose={() => setContactPickerOpen(false)} />}
            <div className="mt-2 flex items-end gap-2">
              {kind !== "club" && (
                <>
                  <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={handleFilePicked} className="hidden" />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Add to message"
                          title="Add to message"
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-lg border text-ink-muted outline-none transition-colors hover:border-ink/25 hover:text-ink/75 focus-visible:ring-2 focus-visible:ring-pitch-400",
                            pickerOpen || contactPickerOpen ? "border-pitch-600 text-pitch-600" : "border-ink/15"
                          )}
                        >
                          <Plus className="size-4" aria-hidden="true" />
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
                          <p>Attach a file</p>
                          <p className="text-xs text-ink-muted">One-off image or PDF</p>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="items-start py-2" onClick={() => setContactPickerOpen((v) => !v)}>
                        <IdCard className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                        <div>
                          <p>Contact card</p>
                          <p className="text-xs text-ink-muted">Share your name, role and telephone number</p>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a message…"
                aria-label="Message"
                rows={1}
                className="min-h-11 flex-1 resize-none rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !canSend}
                aria-label={sending ? "Sending message" : "Send message"}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-pitch-600 text-white outline-none transition-colors hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              </button>
            </div>
            {/* A FAILED SEND SAYS SO AND OFFERS THE WAY BACK. The draft is
                still in the box, so "Try Again" is a real second attempt at the
                same message, never a re-type. Nothing was ever shown as sent. */}
            {error && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive-text" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-destructive-text">{error}</p>
                  {canSend && (
                    <button
                      type="button"
                      onClick={handleSend}
                      className="mt-1 text-sm font-medium text-destructive-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      Try Again
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* -----------------------------------------------------------------
          THE MESSAGES.
          ----------------------------------------------------------------- */}
      <div className="relative min-h-0 flex-1">
        {/* ONE status region for the whole thread. Announces arrivals a
            reader cannot see; says nothing when they can. */}
        <p aria-live="polite" className="sr-only">
          {pendingArrivals > 0
            ? `${pendingArrivals} new ${pendingArrivals === 1 ? "message" : "messages"} above`
            : ""}
        </p>

        {pendingArrivals > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute inset-x-0 top-2 z-10 mx-auto flex h-9 w-fit items-center gap-1.5 rounded-full bg-forest-950 px-3.5 text-xs font-medium text-white shadow-lg outline-none transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ArrowUp className="size-3.5" aria-hidden="true" />
            {pendingArrivals} new {pendingArrivals === 1 ? "message" : "messages"}
          </button>
        )}

        <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
          {ordered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-ink">No messages yet</p>
              <p className="max-w-[32ch] text-sm text-ink-muted">
                {kind === "club"
                  ? "Say hello, and what you'd like to arrange."
                  : "Confirm the kick-off time, the pitch, or anything else about this fixture."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {ordered.map((m, i) => {
                const previous = ordered[i - 1]
                const showDay = !previous || dayKey(previous.createdAt) !== dayKey(m.createdAt)
                // A visual RUN is consecutive messages from the same person on
                // the same day, close together in time. Only the first of a run
                // carries the avatar and the name; the rest are just what they
                // said next.
                const startsRun =
                  showDay ||
                  m.isSystemEvent ||
                  previous.isSystemEvent ||
                  previous.senderName !== m.senderName ||
                  previous.isOwn !== m.isOwn ||
                  Math.abs(new Date(previous.createdAt).getTime() - new Date(m.createdAt).getTime()) > 5 * 60 * 1000

                if (m.isSystemEvent) {
                  return (
                    <li key={m.id} className="flex flex-col">
                      {showDay && <DaySeparator iso={m.createdAt} />}
                      <p className="mx-auto my-2 max-w-[85%] rounded-full bg-ink/5 px-3 py-1 text-center text-xs text-ink-muted">{m.body}</p>
                    </li>
                  )
                }

                return (
                  <li key={m.id} className={cn("flex flex-col", startsRun ? "mt-3 first:mt-0" : "mt-0.5", m.isOwn ? "items-end" : "items-start")}>
                    {showDay && <DaySeparator iso={m.createdAt} />}

                    {/* WHO SAID IT, once per run, and only for other people --
                        a person does not need their own name over their own
                        words. */}
                    {startsRun && !m.isOwn && (
                      <div className="mb-1 flex items-center gap-1.5 pl-0.5">
                        <UserAvatar avatarUrl={m.senderAvatarUrl} name={m.senderName} size="xs" />
                        <p className="text-xs font-medium text-ink/75">
                          {m.senderName}
                          {m.senderRoleLabel && (
                            <span className="font-normal text-ink-muted">
                              {" "}&middot; {m.senderRoleLabel}, {m.senderClubName}
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    <div
                      className={cn(
                        // BUBBLE WIDTH is capped in characters, not in percent:
                        // a long message on a wide laptop should not become a
                        // 900px line nobody can track back from.
                        "max-w-[min(85%,46ch)] rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap",
                        m.isDeleted
                          ? "border border-dashed border-ink/20 bg-transparent text-ink-muted italic"
                          : m.isOwn
                            ? // MINE: blue, right. Ownership is the authenticated
                              // sender being me -- never my club, my team, or the
                              // context I happen to have selected.
                              "bg-messenger-blue text-white"
                            : // THEIRS: green, left.
                              "bg-mint-100 text-forest-950",
                        // Shape carries the same distinction as colour, so the
                        // thread still reads correctly without hue: the tail
                        // corner squares off on the side the message came from,
                        // and only on the last bubble of a run.
                        !m.isDeleted && (m.isOwn ? "rounded-br-md" : "rounded-bl-md")
                      )}
                    >
                      {m.body}
                      {m.attachment && <AttachmentView attachment={m.attachment} />}
                      {m.documentShare && <DocumentShareView share={m.documentShare} />}
                      {m.contactCard && <ContactCardView card={m.contactCard} />}
                    </div>

                    <div className={cn("mt-0.5 flex items-center gap-0.5 px-1", m.isOwn && "flex-row-reverse")}>
                      <span className="text-[11px] text-ink-muted">
                        <time dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
                        {m.isOwn && <span className="sr-only"> &middot; sent by you</span>}
                      </span>
                      <MessageActions
                        message={m}
                        onDeleted={() =>
                          setMessages((prev) => prev.map((pm) => (pm.id === m.id ? { ...pm, isDeleted: true, canDelete: false, canReport: false, body: "Message has been deleted by user.", attachment: null, documentShare: null, contactCard: null } : pm)))
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** The local calendar day a timestamp falls on, for grouping. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * The line between one day and the next. Centred, quiet, and a real heading
 * for assistive technology rather than a decorative rule -- so a screen reader
 * user moving through a long thread hears where the days change.
 */
function DaySeparator({ iso }: { iso: string }) {
  const date = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000)
  const label =
    dayDiff === 0
      ? "Today"
      : dayDiff === 1
        ? "Yesterday"
        : dayDiff < 7 && dayDiff > 0
          ? date.toLocaleDateString("en-GB", { weekday: "long" })
          : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" })

  return (
    <div className="my-3 flex w-full items-center gap-3 self-stretch first:mt-0">
      <span className="h-px flex-1 bg-ink/10" aria-hidden="true" />
      <h3 className="text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase">{label}</h3>
      <span className="h-px flex-1 bg-ink/10" aria-hidden="true" />
    </div>
  )
}
