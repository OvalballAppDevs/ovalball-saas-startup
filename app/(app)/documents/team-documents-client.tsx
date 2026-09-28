"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, Trash2, Upload } from "lucide-react"

import { deleteClubDocument, uploadTeamDocument } from "./actions"

export interface TeamDocumentRow {
  id: string
  title: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  signedUrl: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF"
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") return "Image"
  if (mimeType === "application/msword" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "Word Document"
  return "Document"
}

/**
 * TEAM DOCUMENTS -- the SAME canonical `club_documents` rows Team Profile shows on mobile, presented
 * here through the general Club Documents surface's "Teams" grouping. Never folder move, never
 * archive: a team document's owning team is structural (Section 7's own brief), so the only actions
 * offered are Add and Delete, both through the canonical RPCs.
 */
export function TeamDocumentsClient({ teamId, teamLabel, canManage, documents }: { teamId: string; teamLabel: string; canManage: boolean; documents: TeamDocumentRow[] }) {
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleUpload() {
    if (!pendingFile || !title.trim()) return
    setUploading(true)
    setError(null)
    const formData = new FormData()
    formData.set("file", pendingFile)
    formData.set("title", title.trim())
    const result = await uploadTeamDocument(teamId, formData)
    setUploading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setUploadOpen(false)
    setPendingFile(null)
    setTitle("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    router.refresh()
  }

  async function handleDelete(documentId: string) {
    setDeleting(true)
    const result = await deleteClubDocument(documentId)
    setDeleting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmDeleteId(null)
    router.refresh()
  }

  return (
    <div className="mt-6">
      {canManage && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-pitch-600 px-3.5 text-sm font-medium text-white outline-none transition-colors hover:bg-pitch-600/90 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Upload className="size-4" />
            Add Document
          </button>
        </div>
      )}

      {uploadOpen && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-sm font-medium text-ink">Add a document to {teamLabel}</p>
          <p className="mt-0.5 text-xs text-ink-muted">PDF, Word document, JPEG, PNG, or WEBP. Up to 10MB.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="mt-2 text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (f.size > 10 * 1024 * 1024) {
                setError("Documents must be 10MB or smaller.")
                return
              }
              setPendingFile(f)
              if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""))
            }}
          />
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 w-56 rounded-md border border-ink/15 px-2.5 text-sm outline-none focus-visible:border-pitch-600"
              />
            </label>
            <button
              type="button"
              disabled={uploading || !pendingFile || !title.trim()}
              onClick={handleUpload}
              className="h-9 rounded-md bg-pitch-600 px-3.5 text-sm font-medium text-white outline-none hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? "Adding…" : "Add Document"}
            </button>
            <button type="button" onClick={() => setUploadOpen(false)} className="text-sm font-medium text-ink-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-sm text-destructive-text">{error}</p>}

      {documents.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <FileText className="size-5 text-ink-muted" />
          <div>
            <p className="text-sm font-medium text-ink">No team documents yet</p>
            <p className="mt-1 max-w-md text-sm text-ink-muted">Documents shared with this team will appear here.</p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((d) => (
            <li key={d.id} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="size-4 shrink-0 text-forest-800" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                  <p className="text-xs text-ink-muted">
                    {typeLabel(d.mimeType)} &middot; {formatBytes(d.sizeBytes)}
                  </p>
                </div>
                {d.signedUrl && (
                  <a href={d.signedUrl} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                    View
                  </a>
                )}
                {canManage &&
                  (confirmDeleteId === d.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => handleDelete(d.id)}
                        className="text-sm font-medium text-destructive-text outline-none hover:underline disabled:opacity-40"
                      >
                        {deleting ? "Deleting…" : "Confirm Delete"}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-sm font-medium text-ink-muted hover:text-ink">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => setConfirmDeleteId(d.id)}
                      className="shrink-0 rounded p-1.5 text-ink-muted outline-none hover:bg-destructive/10 hover:text-destructive-text focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ))}
              </div>
              {confirmDeleteId === d.id && (
                <p className="mt-2 border-t border-ink/10 pt-2 text-xs text-ink-muted">
                  Delete &lsquo;{d.title}&rsquo; from {teamLabel}&rsquo;s documents? This can&rsquo;t be undone.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
