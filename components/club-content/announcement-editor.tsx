"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveAnnouncement, setAnnouncementStatus } from "@/lib/club-content/actions"
import {
  CONTENT_STATUS_LABEL,
  PRIORITY_OPTIONS,
  VISIBILITY_OPTIONS,
  type AnnouncementPriority,
  type ContentStatus,
  type ContentVisibility,
} from "@/lib/club-content/vocabulary"
import { cn } from "@/lib/utils"

/**
 * A short notice with a start, an optional end and an optional link. Not a
 * small article: "Clubhouse closed Saturday" needs a title, maybe a sentence,
 * and to disappear on its own on Sunday.
 */

export interface EditableAnnouncement {
  id: string
  teamId: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  visibility: ContentVisibility
  status: ContentStatus
  startsAt: string
  expiresAt: string | null
  linkLabel: string
  linkUrl: string
}

/** ISO instant -> the value a datetime-local input shows, in the browser's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

const TEXTAREA =
  "w-full rounded-lg border border-input bg-white px-3 py-2.5 text-base leading-relaxed text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const SELECT =
  "h-11 w-full rounded-lg border border-input bg-white px-3 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function AnnouncementEditor({
  clubId,
  announcement,
  teams,
  lockedTeamId,
  basePath,
}: {
  clubId: string
  announcement: EditableAnnouncement | null
  teams: { id: string; name: string }[]
  lockedTeamId: string | null
  basePath: string
}) {
  const router = useRouter()
  const initial = useMemo(
    () => ({
      teamId: announcement?.teamId ?? lockedTeamId,
      title: announcement?.title ?? "",
      body: announcement?.body ?? "",
      priority: announcement?.priority ?? ("NORMAL" as AnnouncementPriority),
      visibility: announcement?.visibility ?? ("PUBLIC" as ContentVisibility),
      startsAt: toLocalInput(announcement?.startsAt ?? null),
      expiresAt: toLocalInput(announcement?.expiresAt ?? null),
      linkLabel: announcement?.linkLabel ?? "",
      linkUrl: announcement?.linkUrl ?? "",
    }),
    [announcement, lockedTeamId]
  )
  const [draft, setDraft] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const status: ContentStatus = announcement?.status ?? "DRAFT"
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const update = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
    setNotice(null)
  }

  function persist(next: ContentStatus | null, doneNotice: string) {
    startTransition(async () => {
      let id = announcement?.id ?? null
      if (dirty || !id) {
        const result = await saveAnnouncement({
          announcementId: id,
          clubId,
          teamId: draft.teamId,
          title: draft.title,
          body: draft.body,
          priority: draft.priority,
          visibility: draft.visibility,
          startsAt: fromLocalInput(draft.startsAt),
          expiresAt: fromLocalInput(draft.expiresAt),
          linkLabel: draft.linkLabel,
          linkUrl: draft.linkUrl,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        id = result.data.id
        setSaved(draft)
      }
      if (next && id) {
        const outcome = await setAnnouncementStatus(id, next)
        if (!outcome.ok) {
          setError(outcome.error)
          if (!announcement) router.replace(`${basePath}/announcements/${id}`)
          return
        }
      }
      setNotice(doneNotice)
      if (!announcement && id) router.replace(`${basePath}/announcements/${id}`)
      else router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href={basePath} className="text-sm font-medium text-ink-muted hover:text-ink">
        News &amp; Announcements
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-display-l text-ink">{announcement ? "Edit Announcement" : "New Announcement"}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", status === "PUBLISHED" ? "bg-mint-100 text-forest-900" : "bg-ink/[0.07] text-ink/75")}>
          {CONTENT_STATUS_LABEL[status]}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">A short notice at the top of the club&apos;s page. It shows between the start and end you choose.</p>

      <div className="mt-8 grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="ann-title">Title</Label>
          <Input id="ann-title" value={draft.title} maxLength={100} onChange={(e) => update({ title: e.target.value })} className="h-11" placeholder="Clubhouse closed on Saturday" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ann-body">Details</Label>
          <textarea id="ann-body" value={draft.body} maxLength={500} rows={3} onChange={(e) => update({ body: e.target.value })} className={TEXTAREA} aria-describedby="ann-body-count" />
          <p id="ann-body-count" className="text-sm text-ink-muted">
            Optional. {500 - draft.body.length} characters left.
          </p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Priority</legend>
          <div className="flex flex-wrap gap-2">
            {PRIORITY_OPTIONS.map((p) => (
              <label key={p.key} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4", draft.priority === p.key ? "border-forest-800 bg-mint-100/50" : "border-ink/12 bg-white")}>
                <input type="radio" name="priority" value={p.key} checked={draft.priority === p.key} onChange={() => update({ priority: p.key })} className="size-4 accent-forest-800" />
                <span className="text-sm font-semibold text-ink">{p.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ann-start">Show From</Label>
            <Input id="ann-start" type="datetime-local" value={draft.startsAt} onChange={(e) => update({ startsAt: e.target.value })} className="h-11" aria-describedby="ann-start-help" />
            <p id="ann-start-help" className="text-sm text-ink-muted">Leave blank to show it as soon as it is published.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ann-end">Show Until</Label>
            <Input id="ann-end" type="datetime-local" value={draft.expiresAt} onChange={(e) => update({ expiresAt: e.target.value })} className="h-11" aria-describedby="ann-end-help" />
            <p id="ann-end-help" className="text-sm text-ink-muted">Leave blank to keep it up until you archive it.</p>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ann-team">Team</Label>
            {lockedTeamId ? (
              <p id="ann-team" className="text-sm font-medium text-ink">{teams.find((t) => t.id === lockedTeamId)?.name ?? "This team"}</p>
            ) : (
              <select id="ann-team" className={SELECT} value={draft.teamId ?? ""} onChange={(e) => update({ teamId: e.target.value || null })}>
                <option value="">The Whole Club</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ann-visibility">Who Can Read It</Label>
            <select id="ann-visibility" className={SELECT} value={draft.visibility} onChange={(e) => update({ visibility: e.target.value as ContentVisibility })}>
              {VISIBILITY_OPTIONS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ann-link-label">Link Label</Label>
            <Input id="ann-link-label" value={draft.linkLabel} maxLength={40} onChange={(e) => update({ linkLabel: e.target.value })} className="h-11" placeholder="Book a place" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ann-link-url">Link Address</Label>
            <Input id="ann-link-url" value={draft.linkUrl} onChange={(e) => update({ linkUrl: e.target.value })} className="h-11" placeholder="https://" aria-describedby="ann-link-help" />
          </div>
          <p id="ann-link-help" className="-mt-4 text-sm text-ink-muted sm:col-span-2">
            Optional. An https:// address, or a page on Ovalball such as /calendar.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 mt-8 -mx-4 border-t border-ink/10 bg-chalk/95 px-4 py-4 backdrop-blur md:mx-0 md:rounded-xl md:border md:px-5">
        <div className="flex flex-wrap items-center gap-3">
          {status === "DRAFT" && (
            <>
              <Button type="button" className="h-11 px-5" disabled={pending || draft.title.trim().length < 3} onClick={() => persist("PUBLISHED", "Published.")}>
                {pending && <Loader2 aria-hidden="true" className="animate-spin" />} Publish
              </Button>
              <Button type="button" variant="outline" className="h-11 px-5" disabled={pending || (!dirty && Boolean(announcement))} onClick={() => persist(null, "Draft saved.")}>
                Save Draft
              </Button>
            </>
          )}
          {status === "PUBLISHED" && (
            <>
              <Button type="button" className="h-11 px-5" disabled={pending || !dirty} onClick={() => persist(null, "Changes published.")}>
                Publish Changes
              </Button>
              <Button type="button" variant="ghost" className="h-11" disabled={pending || dirty} onClick={() => persist("DRAFT", "Unpublished.")}>
                Unpublish
              </Button>
            </>
          )}
          {status === "ARCHIVED" && (
            <Button type="button" className="h-11 px-5" disabled={pending || dirty} onClick={() => persist("PUBLISHED", "Restored.")}>
              Restore
            </Button>
          )}
          {announcement && status !== "ARCHIVED" && (
            <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
              {confirmArchive ? (
                <>
                  <span className="text-sm font-medium text-ink">Take this announcement down?</span>
                  <Button type="button" variant="destructive" className="h-11 px-5" disabled={pending} onClick={() => { setConfirmArchive(false); persist("ARCHIVED", "Archived.") }}>
                    Confirm Archive
                  </Button>
                  <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirmArchive(false)}>
                    Keep It
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" className="h-11 text-destructive-text" disabled={pending || dirty} onClick={() => setConfirmArchive(true)}>
                  Archive
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-muted" aria-live="polite">
          {error ? null : (notice ?? (dirty ? "Unsaved changes." : ""))}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
