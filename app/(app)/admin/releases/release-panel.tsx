"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { recordRelease, setReleasePublished } from "./actions"

export interface ReleaseRow {
  id: string
  version: string
  buildSha: string | null
  title: string | null
  status: "draft" | "published"
  releasedAt: string
}

/**
 * Release history and the form that adds to it.
 *
 * A release is editable — notes get corrected — which is why publishing is
 * a toggle rather than a one-way door. There is no delete: a version that
 * shipped stays in the list whether or not its notes are public.
 */
export function ReleasePanel({
  releases,
  canManage,
  suggestedVersion,
  suggestedBuildSha,
}: {
  releases: ReleaseRow[]
  canManage: boolean
  suggestedVersion: string
  suggestedBuildSha: string
}) {
  const [adding, setAdding] = useState(false)

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">Releases</h2>
        {canManage && !adding ? (
          <Button type="button" variant="outline" className="h-8" onClick={() => setAdding(true)}>
            Record a release
          </Button>
        ) : null}
      </div>

      {adding ? (
        <RecordReleaseForm
          suggestedVersion={suggestedVersion}
          suggestedBuildSha={suggestedBuildSha}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {releases.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink/55">
          No release has been recorded yet. The first one can be the version running now.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
          {releases.map((release) => (
            <li key={release.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-mono text-sm text-ink">{release.version}</span>
                  {release.title ? <span className="text-sm text-ink/80">{release.title}</span> : null}
                </p>
                <p className="mt-1 text-xs text-ink/55">
                  <span className="font-mono">{release.buildSha ?? "no build recorded"}</span>
                  {" · "}
                  {formatDate(release.releasedAt)}
                </p>
              </div>

              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  release.status === "published" ? "bg-mint-100 text-forest-950" : "bg-ink/5 text-ink/60"
                }`}
              >
                {release.status === "published" ? "Published" : "Draft"}
              </span>

              {canManage ? <PublishToggle release={release} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PublishToggle({ release }: { release: ReleaseRow }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const publishing = release.status !== "published"

  async function handleClick() {
    setBusy(true)
    setError(null)
    const result = await setReleasePublished({ releaseId: release.id, published: publishing })
    if (!result.ok) setError(result.error)
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button type="button" variant="ghost" className="h-8" disabled={busy} onClick={handleClick}>
        {busy ? "Saving…" : publishing ? "Publish" : "Unpublish"}
      </Button>
    </div>
  )
}

function RecordReleaseForm({
  suggestedVersion,
  suggestedBuildSha,
  onDone,
}: {
  suggestedVersion: string
  suggestedBuildSha: string
  onDone: () => void
}) {
  const [version, setVersion] = useState(suggestedVersion)
  // "unknown" is what lib/version.ts reports when NEXT_PUBLIC_GIT_SHA was
  // not set at build time. Recording that string as a build identity would
  // be worse than recording nothing.
  const [buildSha, setBuildSha] = useState(suggestedBuildSha === "unknown" ? "" : suggestedBuildSha)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [publish, setPublish] = useState(false)
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const result = await recordRelease({ version, buildSha, title, notes, publish })
    if (result.ok) {
      setStatus("idle")
      onDone()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="release-version">Version</Label>
          <Input
            id="release-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="0.0.2"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="release-sha">Build</Label>
          <Input
            id="release-sha"
            value={buildSha}
            onChange={(e) => setBuildSha(e.target.value)}
            placeholder="Leave empty if this deploy's SHA is not known here"
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="release-title">Title</Label>
        <Input
          id="release-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Calendar and pitch allocation"
        />
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="release-notes">Notes</Label>
        <textarea
          id="release-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Written for club administrators, not for engineers."
          className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm text-ink/80">
        <input
          type="checkbox"
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
          className="mt-0.5 size-4 rounded border-ink/25 text-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        <span>
          Publish these notes now
          <span className="block text-xs text-ink/55">
            Published notes are readable by anyone, including signed-out visitors.
          </span>
        </span>
      </label>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-5 flex items-center gap-2">
        <Button type="button" className="h-9" disabled={!version.trim() || status === "saving"} onClick={handleSave}>
          {status === "saving" ? "Recording…" : "Record release"}
        </Button>
        <Button type="button" variant="ghost" className="h-9" onClick={onDone} disabled={status === "saving"}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
