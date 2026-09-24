import { useCallback, useEffect, useRef, useState } from "react"
import { Image, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  contentErrorMessage,
  loadEditableArticle,
  readPublishingScopes,
  saveArticle,
  setArticleFeatured,
  setArticleStatus,
  type EditableArticle,
  type PublishingScope,
} from "@ovalball/contracts/club/content"
import { ARTICLE_CATEGORIES, CONTENT_STATUS_LABEL, VISIBILITY_OPTIONS, type ArticleCategory, type ContentStatus, type ContentVisibility } from "@ovalball/contracts/club/vocabulary"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useAppContexts } from "../../../../../src/context/contexts"
import { Chip, ChipRow, Notice, ScopePicker, statusTone, TextBox } from "../../../../../src/admin/content/pieces"
import { BodyPreview } from "../../../../../src/admin/content/preview"
import { discardArticleImage, uploadArticleImage } from "../../../../../src/admin/content/upload"
import { ReasonSheet, type ReasonAsk } from "../../../../../src/admin/reason-sheet"
import { supabase } from "../../../../../src/auth/supabase"
import { choosePhoto, takePhoto } from "../../../../../src/messages/pickers"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * ONE NEWS ARTICLE, WRITTEN NATIVELY (CA-M5).
 *
 * The same row, the same operations (`save_club_article`, `set_club_article_status`,
 * `set_club_article_featured`) and the same small markup the website's editor writes -- a plain text
 * box with a toolbar that inserts the markup, and a preview through the one shared parser. The audience
 * picker is the server's list; the picture goes to the club's own folder of the public news bucket,
 * where the bucket's policy decides; the lead story is a club decision and is offered only with club
 * scope. Ovalball's own welcome article is shown but not editable here.
 */
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

function draftFrom(a: EditableArticle): Draft {
  return { teamId: a.teamId, title: a.title, excerpt: a.excerpt, body: a.body, category: a.category, visibility: a.visibility, heroImagePath: a.heroImagePath, heroImageUrl: a.heroImageUrl, heroImageAlt: a.heroImageAlt }
}

function problemWith(d: Draft): string | null {
  const title = d.title.trim()
  if (title.length < 3 || title.length > 140) return "Give it a headline between 3 and 140 characters."
  if (d.excerpt.length > 300) return "Keep the summary to 300 characters or fewer."
  if (d.body.length > 20000) return "The article is too long. Keep it under 20,000 characters."
  if (d.heroImagePath && (d.heroImageAlt.trim().length < 1 || d.heroImageAlt.trim().length > 250)) return "Describe the image in a few words, so people who cannot see it know what it shows."
  return null
}

const TOOLBAR: { label: string; insert: (selected: string) => string; a11y: string }[] = [
  { label: "H2", a11y: "Insert heading", insert: (s) => `## ${s || "Heading"}` },
  { label: "H3", a11y: "Insert smaller heading", insert: (s) => `### ${s || "Smaller heading"}` },
  { label: "B", a11y: "Bold", insert: (s) => `**${s || "bold"}**` },
  { label: "I", a11y: "Italic", insert: (s) => `*${s || "italic"}*` },
  { label: "•", a11y: "Bulleted list", insert: (s) => `- ${s || "item"}` },
  { label: "1.", a11y: "Numbered list", insert: (s) => `1. ${s || "item"}` },
  { label: "Link", a11y: "Insert link", insert: (s) => `[${s || "text"}](https://)` },
]

export default function ArticleEditor() {
  const router = useRouter()
  const { articleId: param, teamId: teamParam } = useLocalSearchParams<{ articleId: string; teamId?: string }>()
  const isNew = param === "new"
  const articleId = isNew ? null : param
  // The club of whichever context the person stands in -- a Coach publishes from their team context. The
  // scopes read (the server) decides what they may publish; the context only says which club to ask about.
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? null

  const [scopes, setScopes] = useState<PublishingScope[] | null>(null)
  const [existing, setExisting] = useState<EditableArticle | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const bodyRef = useRef<TextInput | null>(null)
  const selection = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const orphanUpload = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadError(null)
    try {
      const mine = await readPublishingScopes(supabase, clubId)
      setScopes(mine)
      if (articleId) {
        const clubWide = mine.some((s) => s.kind === "club")
        let found: EditableArticle | null = null
        if (clubWide) found = await loadEditableArticle(supabase, { clubId, teamId: null }, articleId)
        else {
          for (const s of mine) {
            if (s.kind !== "team" || !s.teamId) continue
            found = await loadEditableArticle(supabase, { clubId, teamId: s.teamId }, articleId)
            if (found) break
          }
        }
        setExisting(found)
        if (found) setDraft((d) => (dirty && d ? d : draftFrom(found)))
      } else {
        setDraft((d) => {
          if (d) return d
          const preset = typeof teamParam === "string" && mine.some((s) => s.teamId === teamParam) ? teamParam : mine.some((s) => s.kind === "club") ? null : (mine.find((s) => s.kind === "team")?.teamId ?? null)
          return { teamId: preset, title: "", excerpt: "", body: "", category: "NEWS", visibility: "PUBLIC", heroImagePath: null, heroImageUrl: null, heroImageAlt: "" }
        })
      }
    } catch (cause) {
      const translated = friendly(cause, "this article")
      logDetail("admin:article", translated)
      setLoadError(translated)
      setScopes((s) => s ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, articleId, teamParam])

  useEffect(() => {
    setScopes(null)
    setExisting(null)
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  function edit(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
    setMessage(null)
  }

  const clubScope = !!scopes?.some((s) => s.kind === "club")
  const mayWrite = (scopes?.length ?? 0) > 0
  const scopeStillHeld = !!draft && !!scopes && scopes.some((s) => (s.kind === "club" ? draft.teamId === null : s.teamId === draft.teamId))
  const system = !!existing?.isSystem
  const problem = draft ? problemWith(draft) : "Loading"
  const status: ContentStatus | null = existing?.status ?? null

  async function run(op: () => Promise<void>, done: string) {
    if (!clubId) return
    setBusy(true)
    setMessage(null)
    try {
      await op()
      setMessage({ tone: "ok", text: done })
      setDirty(false)
      orphanUpload.current = null
      await load()
    } catch (cause) {
      setMessage({ tone: "error", text: contentErrorMessage(cause, friendly(cause, "this article").message) })
      // The refusal stays on screen and the form stays as typed; only the scopes are re-asked, so the
      // actions disable when the audience is no longer held rather than the item vanishing mid-sentence.
      if ((cause as { code?: string }).code === "42501") setScopes(await readPublishingScopes(supabase, clubId).catch(() => []))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<string> {
    if (!clubId || !draft) throw new Error("Nothing to save.")
    const { id } = await saveArticle(supabase, {
      articleId,
      clubId,
      teamId: draft.teamId,
      title: draft.title.trim(),
      excerpt: draft.excerpt.trim(),
      body: draft.body,
      category: draft.category,
      visibility: draft.visibility,
      heroImagePath: draft.heroImagePath,
      heroImageAlt: draft.heroImageAlt.trim(),
    })
    return id
  }

  async function saveThen(next: ContentStatus | null, done: string) {
    await run(async () => {
      const id = await save()
      if (next) await setArticleStatus(supabase, id, next)
      if (isNew) router.replace(`/admin/news/article/${id}` as never)
    }, done)
  }

  function insert(make: (selected: string) => string) {
    if (!draft) return
    const { start, end } = selection.current
    const before = draft.body.slice(0, start)
    const selected = draft.body.slice(start, end)
    const after = draft.body.slice(end)
    const needsBreak = before.length > 0 && !before.endsWith("\n")
    const text = make(selected)
    const blockish = /^(#|-|1\.)/.test(text)
    edit({ body: `${before}${blockish && needsBreak ? "\n" : ""}${text}${after}` })
    bodyRef.current?.focus()
  }

  async function pick(source: "camera" | "library") {
    if (!clubId || !draft) return
    setMessage(null)
    const picked = source === "camera" ? await takePhoto() : await choosePhoto()
    if ("cancelled" in picked) return
    if (!picked.ok) {
      setMessage({ tone: "error", text: picked.message })
      return
    }
    setUploading(true)
    try {
      const result = await uploadArticleImage(supabase, clubId, draft.teamId, picked.file)
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message })
        return
      }
      if (orphanUpload.current) await discardArticleImage(supabase, orphanUpload.current)
      orphanUpload.current = result.path
      edit({ heroImagePath: result.path, heroImageUrl: result.url })
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto() {
    if (!draft) return
    if (orphanUpload.current && orphanUpload.current === draft.heroImagePath) {
      await discardArticleImage(supabase, orphanUpload.current)
      orphanUpload.current = null
    }
    edit({ heroImagePath: null, heroImageUrl: null, heroImageAlt: "" })
  }

  const categories = ARTICLE_CATEGORIES.filter((c) => c.key !== "WELCOME" || system)
  const title = isNew ? "New Article" : (existing?.title ?? "Article")
  const editable = !busy && !system

  return (
    <AdminScreen section={title} onRefresh={() => void load()} refreshing={false}>
      {scopes === null && !loadError && <CardSkeleton lines={6} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {scopes !== null && !loadError && !mayWrite && <EmptyState title="You cannot publish here" body="Writing news needs the club's or a team's publishing permission." />}
      {scopes !== null && !loadError && mayWrite && !isNew && !existing && <EmptyState title="Article not found" body="It may have been removed, or it belongs to a team you do not write for." />}

      {scopes !== null && mayWrite && draft && (isNew || existing) && (
        <>
          {existing && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <StatusPill label={CONTENT_STATUS_LABEL[existing.status]} tone={statusTone(existing.status)} />
              {existing.featured && <StatusPill label="Lead Story" tone="positive" />}
              {existing.visibility === "MEMBERS" && <StatusPill label="Members" tone="neutral" />}
            </View>
          )}
          {system && <Notice tone="info" text="Ovalball's welcome article is managed by Ovalball. You can publish, unpublish or archive it, but not rewrite it." />}

          <Card style={{ gap: space.lg }}>
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Audience</Text>
              <ScopePicker scopes={scopes} value={draft.teamId} onChange={(teamId) => edit({ teamId })} disabled={!editable} />
              <Text style={[type.caption, { color: colour.inkMuted }]}>{draft.teamId ? "A team story: filed under the team on the club's page." : "A club story, on the club's page."}</Text>
              {!scopeStillHeld && <Notice tone="error" text="You no longer write for the audience this article is set to. Choose one you can publish to." />}
            </View>
            <ChipRow label="Category" options={categories.map((c) => ({ key: c.key, label: c.label }))} value={draft.category} onChange={(category) => edit({ category })} disabled={!editable} />
            <TextBox label="Headline" value={draft.title} onChange={(v) => edit({ title: v })} max={140} placeholder="What happened" editable={editable} />
            <TextBox label="Summary" value={draft.excerpt} onChange={(v) => edit({ excerpt: v })} max={300} multiline placeholder="One or two sentences shown on the card. Left blank, the opening of the article is used." editable={editable} />
            <ChipRow label="Who Can See It" options={VISIBILITY_OPTIONS.map((o) => ({ key: o.key, label: o.label, description: o.description }))} value={draft.visibility} onChange={(visibility) => edit({ visibility })} disabled={!editable} />
          </Card>

          <Card style={{ gap: space.md }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Picture</Text>
            {draft.heroImageUrl ? (
              <>
                <Image source={{ uri: draft.heroImageUrl }} accessibilityLabel={draft.heroImageAlt || "Article picture"} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: "rgba(16,21,18,0.06)" }} resizeMode="cover" />
                <TextBox label="Describe the Picture" value={draft.heroImageAlt} onChange={(v) => edit({ heroImageAlt: v })} max={250} placeholder="A few words for people who cannot see it" editable={editable} hint="Required when there is a picture." />
                {editable && <Button label="Remove Picture" variant="quiet" onPress={() => void removePhoto()} disabled={uploading} />}
              </>
            ) : (
              editable && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Take Photo" variant="secondary" onPress={() => void pick("camera")} busy={uploading} style={{ flex: 1 }} />
                  <Button label="Choose Photo" variant="secondary" onPress={() => void pick("library")} busy={uploading} style={{ flex: 1 }} />
                </View>
              )
            )}
            <Text style={[type.caption, { color: colour.inkMuted }]}>JPG, PNG or WebP, under 5MB. Use your own club's photos.</Text>
          </Card>

          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Article</Text>
              <Chip label={preview ? "Edit" : "Preview"} on={preview} onPress={() => setPreview((p) => !p)} role="button" />
            </View>
            {preview ? (
              <BodyPreview body={draft.body} />
            ) : (
              <>
                {editable && (
                  <View accessibilityLabel="Formatting" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                    {TOOLBAR.map((t) => (
                      <Chip key={t.label} label={t.label} on={false} onPress={() => insert(t.insert)} role="button" />
                    ))}
                  </View>
                )}
                <TextBox
                  label="Article body"
                  value={draft.body}
                  onChange={(v) => edit({ body: v })}
                  max={20000}
                  multiline
                  tall
                  placeholder={"Write the story. A blank line starts a new paragraph.\n\n## Heading   **bold**   *italic*   - list   [link](https://…)"}
                  editable={editable}
                  inputRef={bodyRef}
                  onSelectionChange={(start, end) => {
                    selection.current = { start, end }
                  }}
                />
              </>
            )}
          </Card>

          {message && <Notice tone={message.tone} text={message.text} />}
          {problem && dirty && <Text style={[type.caption, { color: colour.warning }]}>{problem}</Text>}

          <View style={{ gap: space.sm }}>
            {isNew ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Save Draft" variant="secondary" onPress={() => void saveThen(null, "Saved as a draft. Nobody can see it yet.")} busy={busy} disabled={!!problem || !scopeStillHeld || uploading} style={{ flex: 1 }} />
                <Button label="Publish" onPress={() => void saveThen("PUBLISHED", "Published to the club's page.")} busy={busy} disabled={!!problem || !scopeStillHeld || uploading || draft.body.trim().length === 0} style={{ flex: 1 }} />
              </View>
            ) : (
              <>
                {!system && <Button label="Save Changes" onPress={() => void saveThen(null, "Saved.")} busy={busy} disabled={!dirty || !!problem || !scopeStillHeld || uploading} />}
                {status === "DRAFT" && <Button label="Publish" variant="secondary" onPress={() => void run(async () => { if (dirty && !system) await save(); await setArticleStatus(supabase, existing!.id, "PUBLISHED") }, "Published to the club's page.")} busy={busy} disabled={(!system && !!problem) || !scopeStillHeld} />}
                {status === "PUBLISHED" && <Button label="Unpublish" variant="secondary" onPress={() => void run(() => setArticleStatus(supabase, existing!.id, "DRAFT"), "Unpublished. It is a draft again.")} busy={busy} />}
                {status === "ARCHIVED" && <Button label="Restore" variant="secondary" onPress={() => void run(() => setArticleStatus(supabase, existing!.id, "PUBLISHED"), "Restored and published.")} busy={busy} />}
                {status === "PUBLISHED" && clubScope && (
                  <Button label={existing!.featured ? "Remove Lead Story" : "Make Lead Story"} variant="secondary" onPress={() => void run(() => setArticleFeatured(supabase, existing!.id, !existing!.featured), existing!.featured ? "No longer the lead story." : "This is now the club's lead story.")} busy={busy} />
                )}
                {status !== "ARCHIVED" && (
                  <Button
                    label="Archive"
                    variant="quiet"
                    disabled={busy}
                    onPress={() =>
                      setAsk({
                        title: `Archive "${existing!.title}"?`,
                        body: "It comes off the club's page and is kept as history. You can restore it later.",
                        confirmLabel: "Archive Article",
                        destructive: true,
                        reason: "none",
                        onConfirm: async () => {
                          await setArticleStatus(supabase, existing!.id, "ARCHIVED")
                          setMessage({ tone: "ok", text: "Archived." })
                          await load()
                        },
                      })
                    }
                  />
                )}
              </>
            )}
          </View>
        </>
      )}

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void load()} errorMessage={(cause) => contentErrorMessage(cause, friendly(cause, "this article").message)} />
    </AdminScreen>
  )
}
