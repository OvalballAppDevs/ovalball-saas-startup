"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Bold, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, X } from "lucide-react"

import { ArticleView } from "@/components/club-home/article-view"
import { ClubThemeScope } from "@/components/club-home/primitives"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PublicClub } from "@/lib/club-public/club"
import {
  discardArticleImage,
  saveArticle,
  setArticleFeatured,
  setArticleStatus,
  uploadArticleImage,
} from "@/lib/club-content/actions"
import { readingMinutes } from "@/lib/club-content/markup"
import {
  ARTICLE_CATEGORIES,
  CONTENT_STATUS_LABEL,
  VISIBILITY_OPTIONS,
  articleCategoryLabel,
  articlePath,
  type ArticleCategory,
  type ContentStatus,
  type ContentVisibility,
} from "@/lib/club-content/vocabulary"
import { cn } from "@/lib/utils"

import { CopyLinkButton } from "./copy-link-button"

/**
 * THE ARTICLE EDITOR, for club news and team news alike.
 *
 * Built for a volunteer who has never used a CMS: write, look at it exactly
 * as the public will, publish, copy the link. Formatting is a toolbar that
 * inserts a small, readable markup into the text, so what is saved is plain
 * text anyone can fix by hand, and Preview renders it through the same
 * component the public article page uses.
 *
 * The editor enforces nothing. Every save and status change goes through
 * lib/club-content/actions, and the database decides what this person may do.
 */

export interface EditableArticle {
  id: string
  slug: string
  teamId: string | null
  title: string
  excerpt: string
  body: string
  category: ArticleCategory
  visibility: ContentVisibility
  status: ContentStatus
  featured: boolean
  heroImagePath: string | null
  heroImageUrl: string | null
  heroImageAlt: string
  publishedAt: string | null
  updatedAt: string | null
  isSystem: boolean
}

interface Draft {
  teamId: string | null
  title: string
  excerpt: string
  body: string
  category: ArticleCategory
  visibility: ContentVisibility
  heroImagePath: string | null
  heroImageUrl: string | null
  heroImageAlt: string
}

type Tab = "write" | "preview"

type ToolKey = "heading" | "bold" | "italic" | "link" | "bullets" | "numbers"
const TOOLS: { key: ToolKey; label: string; icon: typeof Bold }[] = [
  { key: "heading", label: "Heading", icon: Heading2 },
  { key: "bold", label: "Bold", icon: Bold },
  { key: "italic", label: "Italic", icon: Italic },
  { key: "link", label: "Link", icon: Link2 },
  { key: "bullets", label: "Bulleted List", icon: List },
  { key: "numbers", label: "Numbered List", icon: ListOrdered },
]

const TEXTAREA =
  "w-full rounded-lg border border-input bg-white px-3 py-2.5 text-base leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const SELECT =
  "h-11 w-full rounded-lg border border-input bg-white px-3 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function ArticleEditor({
  club,
  article,
  teams,
  lockedTeamId,
  canChooseLeadStory,
  basePath,
  publicOrigin,
}: {
  club: PublicClub
  article: EditableArticle | null
  /** Teams this person may write for. Club editors also get "The whole club". */
  teams: { id: string; name: string }[]
  /** Team news written from a team's page belongs to that team. */
  lockedTeamId: string | null
  canChooseLeadStory: boolean
  basePath: string
  publicOrigin: string
}) {
  const router = useRouter()
  const initial: Draft = useMemo(
    () => ({
      teamId: article?.teamId ?? lockedTeamId,
      title: article?.title ?? "",
      excerpt: article?.excerpt ?? "",
      body: article?.body ?? "",
      category: article?.category ?? "NEWS",
      visibility: article?.visibility ?? "PUBLIC",
      heroImagePath: article?.heroImagePath ?? null,
      heroImageUrl: article?.heroImageUrl ?? null,
      heroImageAlt: article?.heroImageAlt ?? "",
    }),
    [article, lockedTeamId]
  )
  const [draft, setDraft] = useState<Draft>(initial)
  const [saved, setSaved] = useState<Draft>(initial)
  const [tab, setTab] = useState<Tab>("write")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [pending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const status: ContentStatus = article?.status ?? "DRAFT"
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const teamName = teams.find((t) => t.id === draft.teamId)?.name ?? null
  const publicUrl = article && status === "PUBLISHED" ? `${publicOrigin}${articlePath(club.slug, article.slug)}` : null

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
    setNotice(null)
  }

  // ------------------------------------------------------------ toolbar
  function wrapSelection(before: string, after: string, placeholder: string) {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end, value } = el
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    update({ body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function prefixLines(prefix: (index: number) => string, placeholder: string) {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end, value } = el
    const lineStart = value.lastIndexOf("\n", start - 1) + 1
    const block = value.slice(lineStart, end) || placeholder
    const lines = block.split("\n").map((line, i) => `${prefix(i)}${line.replace(/^(#{2,3}\s+|[-*]\s+|\d+\.\s+)/, "")}`)
    const replacement = lines.join("\n")
    const needsGap = lineStart > 0 && value[lineStart - 1] === "\n" && value[lineStart - 2] !== "\n" ? "\n" : ""
    const next = value.slice(0, lineStart) + needsGap + replacement + value.slice(Math.max(end, lineStart))
    update({ body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(lineStart + needsGap.length, lineStart + needsGap.length + replacement.length)
    })
  }

  function runTool(tool: ToolKey) {
    if (tool === "heading") prefixLines(() => "## ", "Heading")
    else if (tool === "bold") wrapSelection("**", "**", "bold text")
    else if (tool === "italic") wrapSelection("*", "*", "italic text")
    else if (tool === "link") wrapSelection("[", "](https://)", "link text")
    else if (tool === "bullets") prefixLines(() => "- ", "List item")
    else prefixLines((i) => `${i + 1}. `, "List item")
  }

  // ------------------------------------------------------------- images
  async function onImageChosen(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    const form = new FormData()
    form.set("file", file)
    form.set("clubId", club.id)
    if (draft.teamId) form.set("teamId", draft.teamId)
    const result = await uploadArticleImage(form)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ""
    if (!result.ok) {
      setError(result.error)
      return
    }
    // An image uploaded and replaced before saving is removed straight away.
    if (draft.heroImagePath && draft.heroImagePath !== saved.heroImagePath) void discardArticleImage(draft.heroImagePath)
    update({ heroImagePath: result.data.path, heroImageUrl: result.data.url })
  }

  function removeImage() {
    if (draft.heroImagePath && draft.heroImagePath !== saved.heroImagePath) void discardArticleImage(draft.heroImagePath)
    update({ heroImagePath: null, heroImageUrl: null, heroImageAlt: "" })
  }

  // ------------------------------------------------------------ actions
  function persist(then?: (id: string) => Promise<{ ok: boolean; error?: string }>, doneNotice?: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      let id = article?.id ?? null
      if (dirty || !id) {
        const result = await saveArticle({
          articleId: id,
          clubId: club.id,
          teamId: draft.teamId,
          title: draft.title,
          excerpt: draft.excerpt,
          body: draft.body,
          category: draft.category,
          visibility: draft.visibility,
          heroImagePath: draft.heroImagePath,
          heroImageAlt: draft.heroImageAlt,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        id = result.data.id
        setSaved(draft)
      }
      if (then && id) {
        const outcome = await then(id)
        if (!outcome.ok) {
          setError(outcome.error ?? "That change could not be made.")
          if (!article) router.replace(`${basePath}/${id}`)
          return
        }
      }
      setNotice(doneNotice ?? "Saved.")
      if (!article && id) router.replace(`${basePath}/${id}?saved=1`)
      else router.refresh()
    })
  }

  const statusAction = (next: ContentStatus) => (id: string) => setArticleStatus(id, next)

  const canPublish = draft.title.trim().length >= 3 && draft.body.trim().length > 0 && (!draft.heroImagePath || draft.heroImageAlt.trim().length > 0)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <Link href={basePath} className="text-sm font-medium text-ink-muted hover:text-ink">
        News &amp; Announcements
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-display-l text-ink">{article ? "Edit Article" : "New Article"}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", status === "PUBLISHED" ? "bg-mint-100 text-forest-900" : "bg-ink/[0.07] text-ink/75")}>
          {CONTENT_STATUS_LABEL[status]}
        </span>
        {article?.featured && <span className="rounded-full bg-forest-900 px-2.5 py-0.5 text-xs font-semibold text-white">Lead Story</span>}
        {article?.isSystem && <span className="rounded-full bg-ink/[0.07] px-2.5 py-0.5 text-xs font-semibold text-ink/75">Written by Ovalball</span>}
      </div>

      {publicUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
            Live at <span className="font-medium text-ink">{publicUrl}</span>
          </p>
          <CopyLinkButton url={publicUrl} />
          <Link href={articlePath(club.slug, article!.slug)} target="_blank" className={buttonVariants({ variant: "outline" })}>
            View Article<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </div>
      )}

      <div role="group" aria-label="Editor view" className="mt-6 inline-flex rounded-lg bg-ink/[0.06] p-1">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-10 rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
              tab === t ? "bg-white text-ink shadow-sm" : "text-ink/65 hover:text-ink"
            )}
          >
            {t === "write" ? "Write" : "Preview"}
          </button>
        ))}
      </div>

      {tab === "write" ? (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_18rem]">
          <div className="grid gap-6">
            <div className="grid gap-2">
              <Label htmlFor="article-title">Headline</Label>
              <Input id="article-title" value={draft.title} maxLength={140} onChange={(e) => update({ title: e.target.value })} className="h-12 text-lg" placeholder="Under 12s win the county cup" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="article-excerpt">Summary</Label>
              <textarea id="article-excerpt" value={draft.excerpt} maxLength={300} rows={2} onChange={(e) => update({ excerpt: e.target.value })} className={TEXTAREA} aria-describedby="article-excerpt-help" />
              <p id="article-excerpt-help" className="text-sm text-ink-muted">
                One or two sentences shown on cards and when the link is shared. Leave it blank to use the start of the article.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="article-body">Article</Label>
              <div role="toolbar" aria-label="Formatting" aria-controls="article-body" className="flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-input bg-ink/[0.03] p-1">
                {TOOLS.map((tool) => (
                  <button
                    key={tool.label}
                    type="button"
                    onClick={() => runTool(tool.key)}
                    aria-label={tool.label}
                    title={tool.label}
                    className="grid size-10 place-items-center rounded-md text-ink/75 outline-none hover:bg-white hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <tool.icon aria-hidden="true" className="size-4" />
                  </button>
                ))}
              </div>
              <textarea
                id="article-body"
                ref={bodyRef}
                value={draft.body}
                rows={16}
                onChange={(e) => update({ body: e.target.value })}
                className={cn(TEXTAREA, "-mt-2 rounded-t-none font-[inherit]")}
                aria-describedby="article-body-help"
              />
              <p id="article-body-help" className="text-sm text-ink-muted">
                Leave a blank line between paragraphs. Select words and use the buttons above to format them, then check Preview. About {readingMinutes(draft.body)} min read.
              </p>
            </div>
          </div>

          <div className="grid content-start gap-6">
            <div className="grid gap-2">
              <Label htmlFor="article-team">Team</Label>
              {lockedTeamId ? (
                <p id="article-team" className="text-sm font-medium text-ink">{teamName ?? "This team"}</p>
              ) : (
                <select id="article-team" className={SELECT} value={draft.teamId ?? ""} onChange={(e) => update({ teamId: e.target.value || null })}>
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
              <Label htmlFor="article-category">Category</Label>
              <select id="article-category" className={SELECT} value={draft.category} onChange={(e) => update({ category: e.target.value as ArticleCategory })}>
                {article?.category === "WELCOME" && <option value="WELCOME">Welcome</option>}
                {ARTICLE_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">Who Can Read It</legend>
              {VISIBILITY_OPTIONS.map((v) => (
                <label key={v.key} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", draft.visibility === v.key ? "border-forest-800 bg-mint-100/50" : "border-ink/12 bg-white")}>
                  <input type="radio" name="visibility" value={v.key} checked={draft.visibility === v.key} onChange={() => update({ visibility: v.key })} className="mt-1 size-4 accent-forest-800" />
                  <span>
                    <span className="block text-sm font-semibold text-ink">{v.label}</span>
                    <span className="block text-sm text-ink-muted">{v.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-ink">Image</span>
              {draft.heroImageUrl ? (
                <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element -- preview of a Supabase Storage upload */}
                  <img src={draft.heroImageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
                  <div className="flex justify-end p-2">
                    <Button type="button" variant="ghost" onClick={removeImage}>
                      <X aria-hidden="true" /> Remove Image
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" className="h-11" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ImagePlus aria-hidden="true" />}
                  {uploading ? "Uploading…" : "Upload Image"}
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onImageChosen(e.target.files?.[0])} />
              <p className="text-sm text-ink-muted">JPG, PNG or WebP, up to 5MB. A wide photo works best.</p>
              {draft.heroImagePath && (
                <div className="grid gap-2">
                  <Label htmlFor="article-alt">Image Description</Label>
                  <Input id="article-alt" value={draft.heroImageAlt} maxLength={250} onChange={(e) => update({ heroImageAlt: e.target.value })} aria-describedby="article-alt-help" />
                  <p id="article-alt-help" className="text-sm text-ink-muted">
                    What the photo shows, for people who cannot see it. For example: Under 12s lifting the county cup.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10">
          <ClubThemeScope theme={club.theme} className="min-h-0 pb-10">
            <ArticleView
              club={club}
              pattern={club.theme.pattern}
              headingLevel={2}
              article={{
                title: draft.title,
                excerpt: draft.excerpt || null,
                body: draft.body,
                categoryLabel: articleCategoryLabel(draft.category),
                byline: article?.isSystem ? "Ovalball" : (teamName ?? club.name),
                teamName,
                publishedAt: article?.publishedAt ?? null,
                updatedAt: article?.updatedAt ?? null,
                heroUrl: draft.heroImageUrl,
                heroAlt: draft.heroImageAlt || null,
                membersOnly: draft.visibility === "MEMBERS",
                readingMinutes: readingMinutes(draft.body),
              }}
            />
          </ClubThemeScope>
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-8 -mx-4 border-t border-ink/10 bg-chalk/95 px-4 py-4 backdrop-blur md:mx-0 md:rounded-xl md:border md:px-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* Primary: what moves the story forward. */}
          {status === "DRAFT" && (
            <>
              <Button type="button" className="h-11 px-5" disabled={pending || !canPublish} onClick={() => persist(statusAction("PUBLISHED"), "Published.")}>
                {pending && <Loader2 aria-hidden="true" className="animate-spin" />} Publish
              </Button>
              <Button type="button" variant="outline" className="h-11 px-5" disabled={pending || (!dirty && Boolean(article))} onClick={() => persist(undefined, "Draft saved.")}>
                Save Draft
              </Button>
            </>
          )}
          {status === "PUBLISHED" && (
            <>
              {/* Named for what it does: a published article changes on the public page at once. */}
              <Button type="button" className="h-11 px-5" disabled={pending || !dirty || !canPublish} onClick={() => persist(undefined, "Changes published.")}>
                {pending && <Loader2 aria-hidden="true" className="animate-spin" />} Publish Changes
              </Button>
              {canChooseLeadStory && article && (
                <Button type="button" variant="outline" className="h-11 px-5" disabled={pending || dirty} onClick={() => persist((id) => setArticleFeatured(id, !article.featured), article.featured ? "No longer the lead story." : "Now the lead story.")}>
                  {article.featured ? "Remove Lead Story" : "Make Lead Story"}
                </Button>
              )}
            </>
          )}
          {status === "ARCHIVED" && (
            <Button type="button" className="h-11 px-5" disabled={pending || dirty} onClick={() => persist(statusAction("PUBLISHED"), "Restored.")}>
              Restore
            </Button>
          )}
          {dirty && (
            <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => setDraft(saved)}>
              Discard Changes
            </Button>
          )}

          {/* Secondary: taking the story down, kept apart and confirmed. */}
          {article && status !== "ARCHIVED" && (
            <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
              {confirmArchive ? (
                <>
                  <span className="text-sm font-medium text-ink">Take this article off the club&apos;s page?</span>
                  <Button type="button" variant="destructive" className="h-11 px-5" disabled={pending} onClick={() => { setConfirmArchive(false); persist(statusAction("ARCHIVED"), "Archived.") }}>
                    Confirm Archive
                  </Button>
                  <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirmArchive(false)}>
                    Keep Article
                  </Button>
                </>
              ) : (
                <>
                  {status === "PUBLISHED" && (
                    <Button type="button" variant="ghost" className="h-11" disabled={pending || dirty} onClick={() => persist(statusAction("DRAFT"), "Unpublished. It is a draft again.")}>
                      Unpublish
                    </Button>
                  )}
                  <Button type="button" variant="ghost" className="h-11 text-destructive-text" disabled={pending || dirty} onClick={() => setConfirmArchive(true)}>
                    Archive
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-muted" aria-live="polite">
          {error ? null : (notice ?? (dirty ? (article && status !== "DRAFT" ? "Unsaved changes. Publish or discard them before unpublishing or archiving." : "Unsaved changes.") : ""))}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive-text">
            {error}
          </p>
        )}
        {!canPublish && status !== "ARCHIVED" && (
          <p className="mt-2 text-sm text-ink-muted">
            To publish, add a headline and some text{draft.heroImagePath ? ", and describe the image" : ""}.
          </p>
        )}
      </div>
    </div>
  )
}
