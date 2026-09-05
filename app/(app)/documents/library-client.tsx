"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, FileText, FolderClosed, FolderPlus, Upload } from "lucide-react"

import { DOCUMENT_CATEGORY_OPTIONS } from "@/lib/documents/categories"

import { archiveClubDocument, createDocumentFolder, moveClubDocument, uploadClubDocument } from "./actions"

export interface LibraryDocument {
  id: string
  title: string
  description: string | null
  category: string
  categoryLabel: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  folderId: string | null
  updatedAt: string
  usageCount: number
  signedUrl: string | null
}

export interface LibraryFolder {
  id: string
  name: string
  parent_folder_id: string | null
}

export interface FolderOption {
  id: string
  path: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentLibraryClient({
  canManage,
  currentFolderId,
  currentFolderName,
  folders,
  allFolders,
  documents,
}: {
  canManage: boolean
  currentFolderId: string | null
  currentFolderName: string | null
  folders: LibraryFolder[]
  allFolders: FolderOption[]
  documents: LibraryDocument[]
}) {
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<string>("other")
  const [movingDocId, setMovingDocId] = useState<string | null>(null)

  async function handleMove(documentId: string, folderId: string | null) {
    const result = await moveClubDocument(documentId, folderId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMovingDocId(null)
    router.refresh()
  }

  async function handleUpload() {
    if (!pendingFile || !title.trim()) return
    setUploading(true)
    setError(null)
    const formData = new FormData()
    formData.set("file", pendingFile)
    formData.set("title", title.trim())
    formData.set("category", category)
    if (currentFolderId) formData.set("folderId", currentFolderId)
    const result = await uploadClubDocument(formData)
    setUploading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setUploadOpen(false)
    setPendingFile(null)
    setTitle("")
    router.refresh()
  }

  async function handleCreateFolder() {
    const result = await createDocumentFolder(newFolderName, currentFolderId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setFolderOpen(false)
    setNewFolderName("")
    router.refresh()
  }

  const empty = folders.length === 0 && documents.length === 0

  return (
    <div className="mt-6">
      {currentFolderId && (
        <div className="mb-3 flex items-center gap-1.5 text-sm">
          <Link href="/documents" className="text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Documents
          </Link>
          <span className="text-ink/30">/</span>
          <span className="font-medium text-ink">{currentFolderName}</span>
        </div>
      )}

      {canManage && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-pitch-600 px-3.5 text-sm font-medium text-white outline-none transition-colors hover:bg-pitch-600/90 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <Upload className="size-4" />
            Upload Document
          </button>
          <button
            type="button"
            onClick={() => setFolderOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3.5 text-sm font-medium text-ink/70 outline-none transition-colors hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <FolderPlus className="size-4" />
            New Folder
          </button>
        </div>
      )}

      {uploadOpen && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-sm font-medium text-ink">Upload document</p>
          <p className="mt-0.5 text-xs text-ink/45">PDF, JPEG, PNG, or WEBP. Up to 10MB.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
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
              <span className="text-xs font-medium text-ink/50">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 w-56 rounded-md border border-ink/15 px-2.5 text-sm outline-none focus-visible:border-pitch-600"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink/50">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
              >
                {DOCUMENT_CATEGORY_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={uploading || !pendingFile || !title.trim()}
              onClick={handleUpload}
              className="h-9 rounded-md bg-pitch-600 px-3.5 text-sm font-medium text-white outline-none hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button type="button" onClick={() => setUploadOpen(false)} className="text-sm font-medium text-ink/50 hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}

      {folderOpen && (
        <div className="mb-4 flex items-end gap-3 rounded-lg border border-ink/10 bg-white p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink/50">Folder name</span>
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="h-9 w-56 rounded-md border border-ink/15 px-2.5 text-sm outline-none focus-visible:border-pitch-600"
            />
          </label>
          <button
            type="button"
            disabled={!newFolderName.trim()}
            onClick={handleCreateFolder}
            className="h-9 rounded-md bg-pitch-600 px-3.5 text-sm font-medium text-white outline-none hover:bg-pitch-600/90 disabled:opacity-40"
          >
            Create
          </button>
          <button type="button" onClick={() => setFolderOpen(false)} className="text-sm font-medium text-ink/50 hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-sm text-destructive">{error}</p>}

      {empty ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <FileText className="size-5 text-ink/30" />
          <div>
            <p className="text-sm font-medium text-ink">Keep your important club and fixture resources in one place</p>
            <p className="mt-1 max-w-md text-sm text-ink/55">
              Good documents to store here: visitor guides, ground and pitch information, parking information,
              match-day documentation, fixture information, and approved images or maps.
            </p>
          </div>
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2">
              {folders.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/documents?folder=${f.id}`}
                    className="flex items-center gap-2.5 rounded-lg border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <FolderClosed className="size-4 text-ink/40" />
                    <span className="text-sm font-medium text-ink">{f.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-col gap-2">
            {documents.map((d) => (
              <li key={d.id} className="rounded-lg border border-ink/10 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText className="size-4 shrink-0 text-forest-800" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                    <p className="text-xs text-ink/45">
                      {d.categoryLabel} &middot; {formatBytes(d.sizeBytes)}
                      {d.usageCount > 0 && <> &middot; Shared in {d.usageCount} fixture conversation{d.usageCount === 1 ? "" : "s"}</>}
                    </p>
                  </div>
                  {d.signedUrl && (
                    <a href={d.signedUrl} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
                      View
                    </a>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => setMovingDocId(movingDocId === d.id ? null : d.id)}
                        className="shrink-0 text-sm font-medium text-ink/55 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        Move to&hellip;
                      </button>
                      <button
                        type="button"
                        title="Archive"
                        onClick={async () => {
                          await archiveClubDocument(d.id, true)
                          router.refresh()
                        }}
                        className="shrink-0 rounded p-1.5 text-ink/40 outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        <Archive className="size-4" />
                      </button>
                    </>
                  )}
                </div>
                {movingDocId === d.id && (
                  <div className="mt-2.5 flex items-center gap-2 border-t border-ink/10 pt-2.5">
                    <label className="text-xs text-ink/50" htmlFor={`move-${d.id}`}>
                      Move to
                    </label>
                    <select
                      id={`move-${d.id}`}
                      autoFocus
                      defaultValue={d.folderId ?? ""}
                      onChange={(e) => handleMove(d.id, e.target.value || null)}
                      className="h-8 rounded-md border border-ink/15 px-2 text-sm outline-none focus-visible:border-pitch-600"
                    >
                      <option value="">Documents (root)</option>
                      {allFolders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.path}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setMovingDocId(null)} className="text-xs text-ink/40 hover:text-ink/70">
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
