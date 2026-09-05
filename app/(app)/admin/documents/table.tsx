"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { archiveClubDocument } from "../../documents/actions"

export interface AdminDocumentRow {
  id: string
  title: string
  category: string
  filename: string
  mimeType: string
  sizeBytes: number
  clubName: string
  uploadedByName: string
  updatedAt: string
  archived: boolean
  usageCount: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AdminDocumentsTable({ rows, canManage, query }: { rows: AdminDocumentRow[]; canManage: boolean; query: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [q, setQ] = useState(query)
  const [pending, startTransition] = useTransition()

  function handleSearch(value: string) {
    setQ(value)
    const params = new URLSearchParams(searchParams.toString())
    if (value.trim()) params.set("q", value.trim())
    else params.delete("q")
    router.push(`/admin/documents?${params.toString()}`)
  }

  return (
    <div className="mt-6">
      <input
        type="search"
        value={q}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search by document title…"
        className="h-10 w-full max-w-sm rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
      />

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">
              <th scope="col" className="px-4 py-3">Document</th>
              <th scope="col" className="px-4 py-3">Club</th>
              <th scope="col" className="px-4 py-3">Category</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Size</th>
              <th scope="col" className="px-4 py-3">Uploaded By</th>
              <th scope="col" className="px-4 py-3">Updated</th>
              <th scope="col" className="px-4 py-3">Shared</th>
              <th scope="col" className="px-4 py-3">Status</th>
              {canManage && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ink/6 last:border-0 hover:bg-ink/[0.02]">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{r.title}</p>
                  <p className="text-xs text-ink/45">{r.filename}</p>
                </td>
                <td className="px-4 py-3 text-ink/70">{r.clubName}</td>
                <td className="px-4 py-3 text-ink/60">{r.category}</td>
                <td className="px-4 py-3 text-ink/50">{r.mimeType.split("/")[1]}</td>
                <td className="px-4 py-3 text-ink/50">{formatBytes(r.sizeBytes)}</td>
                <td className="px-4 py-3 text-ink/60">{r.uploadedByName}</td>
                <td className="px-4 py-3 text-ink/50">{new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                <td className="px-4 py-3 text-ink/60">{r.usageCount > 0 ? `${r.usageCount} fixture${r.usageCount === 1 ? "" : "s"}` : <span className="text-ink/30">Unreferenced</span>}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${r.archived ? "bg-ink/8 text-ink/50" : "bg-mint-100 text-forest-900"}`}>
                    {r.archived ? "Archived" : "Active"}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await archiveClubDocument(r.id, !r.archived)
                          router.refresh()
                        })
                      }
                      className="text-sm font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      {r.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink/50">No documents match.</div>}
      </div>
    </div>
  )
}
