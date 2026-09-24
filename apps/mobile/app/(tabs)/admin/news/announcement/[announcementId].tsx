import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  contentErrorMessage,
  loadEditableAnnouncement,
  readPublishingScopes,
  saveAnnouncement,
  setAnnouncementStatus,
  type EditableAnnouncement,
  type PublishingScope,
} from "@ovalball/contracts/club/content"
import { CONTENT_STATUS_LABEL, PRIORITY_OPTIONS, VISIBILITY_OPTIONS, type AnnouncementPriority, type ContentStatus, type ContentVisibility } from "@ovalball/contracts/club/vocabulary"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useAppContexts } from "../../../../../src/context/contexts"
import { announcementWindowLabel, ChipRow, joinLocal, Notice, ScopePicker, splitLocal, statusTone, TextBox, todayLocal } from "../../../../../src/admin/content/pieces"
import { ReasonSheet, type ReasonAsk } from "../../../../../src/admin/reason-sheet"
import { supabase } from "../../../../../src/auth/supabase"
import { DateField, Field, TimeField } from "../../../../../src/components/form"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, StatusPill } from "../../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { colour, space, type } from "../../../../../src/design/tokens"

/**
 * ONE ANNOUNCEMENT, WRITTEN NATIVELY (CA-M5).
 *
 * The same row, the same operation (`save_club_announcement`) and the same lifecycle
 * (`set_club_announcement_status`: Draft, Published, Archived) as the website. The audience picker is
 * the server's list of scopes this person may publish to; the server decides again on every save, so an
 * editor opened with authority that has since gone fails safely and says so. A published announcement
 * is live only inside its window -- the dates here are recorded, and the server, not the phone, decides
 * when it is showing.
 */
interface Draft {
  teamId: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  visibility: ContentVisibility
  startDate: string
  startTime: string | null
  endDate: string
  endTime: string | null
  linkLabel: string
  linkUrl: string
}

function draftFrom(a: EditableAnnouncement): Draft {
  const s = splitLocal(a.startsAt)
  const e = splitLocal(a.expiresAt)
  return { teamId: a.teamId, title: a.title, body: a.body, priority: a.priority, visibility: a.visibility, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, linkLabel: a.linkLabel, linkUrl: a.linkUrl }
}

function problemWith(d: Draft): string | null {
  const title = d.title.trim()
  if (title.length < 3 || title.length > 100) return "Give the announcement a title between 3 and 100 characters."
  if (d.body.length > 500) return "Keep the announcement to 500 characters or fewer."
  if (!d.startDate) return "Choose when the announcement starts."
  const starts = joinLocal(d.startDate, d.startTime)
  const ends = d.endDate ? joinLocal(d.endDate, d.endTime) : null
  if (starts && ends && new Date(ends).getTime() <= new Date(starts).getTime()) return "The end date must be after the start date."
  if ((d.linkLabel.trim() === "") !== (d.linkUrl.trim() === "")) return "A link needs both a label and an address."
  if (d.linkLabel.trim().length > 40) return "Keep the link label to 40 characters or fewer."
  if (d.linkUrl.trim() && !/^https:\/\/[^\s]+$/.test(d.linkUrl.trim()) && !/^\/(?!\/)[^\s]*$/.test(d.linkUrl.trim())) return "Links must start with https:// or be a page on Ovalball, such as /calendar."
  return null
}

export default function AnnouncementEditor() {
  const router = useRouter()
  const { announcementId: param, teamId: teamParam } = useLocalSearchParams<{ announcementId: string; teamId?: string }>()
  const isNew = param === "new"
  const announcementId = isNew ? null : param
  // The club of whichever context the person stands in -- a Coach publishes from their team context. The
  // scopes read (the server) decides what they may publish; the context only says which club to ask about.
  const { active } = useAppContexts()
  const clubId = active?.clubId ?? null

  const [scopes, setScopes] = useState<PublishingScope[] | null>(null)
  const [existing, setExisting] = useState<EditableAnnouncement | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadError(null)
    try {
      const mine = await readPublishingScopes(supabase, clubId)
      setScopes(mine)
      if (announcementId) {
        // The club's console when the person has club authority; otherwise each team scope is tried
        // until the row answers -- RLS bounds it either way.
        const clubWide = mine.some((s) => s.kind === "club")
        let found: EditableAnnouncement | null = null
        if (clubWide) found = await loadEditableAnnouncement(supabase, { clubId, teamId: null }, announcementId)
        else {
          for (const s of mine) {
            if (s.kind !== "team" || !s.teamId) continue
            found = await loadEditableAnnouncement(supabase, { clubId, teamId: s.teamId }, announcementId)
            if (found) break
          }
        }
        setExisting(found)
        if (found) setDraft((d) => (dirty && d ? d : draftFrom(found)))
      } else {
        setDraft((d) => {
          if (d) return d
          const preset = typeof teamParam === "string" && mine.some((s) => s.teamId === teamParam) ? teamParam : mine.some((s) => s.kind === "club") ? null : (mine.find((s) => s.kind === "team")?.teamId ?? null)
          const now = splitLocal(new Date().toISOString())
          return { teamId: preset, title: "", body: "", priority: "NORMAL", visibility: "PUBLIC", startDate: now.date || todayLocal(), startTime: now.time, endDate: "", endTime: null, linkLabel: "", linkUrl: "" }
        })
      }
    } catch (cause) {
      const translated = friendly(cause, "this announcement")
      logDetail("admin:announcement", translated)
      setLoadError(translated)
      setScopes((s) => s ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, announcementId, teamParam])

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

  const mayWrite = (scopes?.length ?? 0) > 0
  const scopeStillHeld = !!draft && !!scopes && scopes.some((s) => (s.kind === "club" ? draft.teamId === null : s.teamId === draft.teamId))
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
      await load()
    } catch (cause) {
      const text = contentErrorMessage(cause, friendly(cause, "this announcement").message)
      setMessage({ tone: "error", text })
      // CA-M4 principle: a refusal means the authority read is stale -- ask the server again.
      // The refusal stays on screen and the form stays as typed; only the scopes are re-asked, so the
      // actions disable when the audience is no longer held rather than the item vanishing mid-sentence.
      if ((cause as { code?: string }).code === "42501") setScopes(await readPublishingScopes(supabase, clubId).catch(() => []))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<string> {
    if (!clubId || !draft) throw new Error("Nothing to save.")
    const { id } = await saveAnnouncement(supabase, {
      announcementId,
      clubId,
      teamId: draft.teamId,
      title: draft.title.trim(),
      body: draft.body,
      priority: draft.priority,
      visibility: draft.visibility,
      startsAt: joinLocal(draft.startDate, draft.startTime),
      expiresAt: draft.endDate ? joinLocal(draft.endDate, draft.endTime) : null,
      linkLabel: draft.linkLabel.trim(),
      linkUrl: draft.linkUrl.trim(),
    })
    return id
  }

  async function saveThen(next: ContentStatus | null, done: string) {
    await run(async () => {
      const id = await save()
      if (next) await setAnnouncementStatus(supabase, id, next)
      if (isNew) router.replace(`/admin/news/announcement/${id}` as never)
    }, done)
  }

  const title = isNew ? "New Announcement" : (existing?.title ?? "Announcement")
  const window = existing ? announcementWindowLabel(existing.status, existing.startsAt, existing.expiresAt) : null

  return (
    <AdminScreen section={title} onRefresh={() => void load()} refreshing={false}>
      {scopes === null && !loadError && <CardSkeleton lines={5} />}
      {loadError && <ErrorState message={loadError.message} onRetry={() => void load()} offline={loadError.retryable} />}
      {scopes !== null && !loadError && !mayWrite && <EmptyState title="You cannot publish here" body="Writing announcements needs the club's or a team's publishing permission." />}
      {scopes !== null && !loadError && mayWrite && !isNew && !existing && <EmptyState title="Announcement not found" body="It may have been removed, or it belongs to a team you do not write for." />}

      {scopes !== null && mayWrite && draft && (isNew || existing) && (
        <>
          {existing && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <StatusPill label={CONTENT_STATUS_LABEL[existing.status]} tone={statusTone(existing.status)} />
              {window && <StatusPill label={window} tone={window === "Live" ? "positive" : "neutral"} />}
            </View>
          )}

          <Card style={{ gap: space.lg }}>
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Audience</Text>
              <ScopePicker scopes={scopes} value={draft.teamId} onChange={(teamId) => edit({ teamId })} disabled={busy} />
              <Text style={[type.caption, { color: colour.inkMuted }]}>{draft.teamId ? "Shown with that team's notices, and on the club's page." : "Shown to the whole club."}</Text>
              {!scopeStillHeld && <Notice tone="error" text="You no longer write for the audience this announcement is set to. Choose one you can publish to." />}
            </View>
            <TextBox label="Title" value={draft.title} onChange={(v) => edit({ title: v })} max={100} placeholder="What people need to know" editable={!busy} />
            <TextBox label="Announcement" value={draft.body} onChange={(v) => edit({ body: v })} max={500} multiline placeholder="Keep it short: what, when, where, and what to do." editable={!busy} />
            <ChipRow label="Priority" options={PRIORITY_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} value={draft.priority} onChange={(priority) => edit({ priority })} disabled={busy} hint="Priority orders the list and is said in words. It never flashes." />
            <ChipRow label="Who Can See It" options={VISIBILITY_OPTIONS.map((o) => ({ key: o.key, label: o.label, description: o.description }))} value={draft.visibility} onChange={(visibility) => edit({ visibility })} disabled={busy} />
          </Card>

          <Card style={{ gap: space.lg }}>
            <Field label="Starts" hint="An announcement shows from this moment. The server keeps the time.">
              <View style={{ gap: space.sm }}>
                <DateField label="Start date" value={draft.startDate || todayLocal()} onChange={(startDate) => edit({ startDate })} />
                <TimeField label="Start time" value={draft.startTime} onChange={(startTime) => edit({ startTime })} />
              </View>
            </Field>
            <Field label="Ends" hint="Optional. After this it disappears from the list on its own.">
              <View style={{ gap: space.sm }}>
                {draft.endDate ? (
                  <>
                    <DateField label="End date" value={draft.endDate} onChange={(endDate) => edit({ endDate })} />
                    <TimeField label="End time" value={draft.endTime} onChange={(endTime) => edit({ endTime })} />
                    <Button label="No End Date" variant="quiet" onPress={() => edit({ endDate: "", endTime: null })} disabled={busy} />
                  </>
                ) : (
                  <Button label="Set an End Date" variant="secondary" onPress={() => edit({ endDate: draft.startDate || todayLocal(), endTime: "18:00" })} disabled={busy} />
                )}
              </View>
            </Field>
          </Card>

          <Card style={{ gap: space.lg }}>
            <TextBox label="Link Label" value={draft.linkLabel} onChange={(v) => edit({ linkLabel: v })} max={40} placeholder="Optional, e.g. See the calendar" editable={!busy} />
            <TextBox label="Link Address" value={draft.linkUrl} onChange={(v) => edit({ linkUrl: v })} placeholder="https://… or a page on Ovalball, such as /calendar" editable={!busy} autoCapitalize="none" keyboardType="url" hint="Links must start with https:// or be a page on Ovalball." />
          </Card>

          {message && <Notice tone={message.tone} text={message.text} />}
          {problem && dirty && <Text style={[type.caption, { color: colour.warning }]}>{problem}</Text>}

          <View style={{ gap: space.sm }}>
            {isNew ? (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Save Draft" variant="secondary" onPress={() => void saveThen(null, "Saved as a draft. Nobody can see it yet.")} busy={busy} disabled={!!problem || !scopeStillHeld} style={{ flex: 1 }} />
                <Button label="Publish" onPress={() => void saveThen("PUBLISHED", "Published.")} busy={busy} disabled={!!problem || !scopeStillHeld} style={{ flex: 1 }} />
              </View>
            ) : (
              <>
                <Button label="Save Changes" onPress={() => void saveThen(null, "Saved.")} busy={busy} disabled={!dirty || !!problem || !scopeStillHeld} />
                {status === "DRAFT" && <Button label="Publish" variant="secondary" onPress={() => void run(async () => { if (dirty) await save(); await setAnnouncementStatus(supabase, existing!.id, "PUBLISHED") }, "Published.")} busy={busy} disabled={!!problem || !scopeStillHeld} />}
                {status === "PUBLISHED" && <Button label="Unpublish" variant="secondary" onPress={() => void run(() => setAnnouncementStatus(supabase, existing!.id, "DRAFT"), "Unpublished. It is a draft again.")} busy={busy} />}
                {status === "ARCHIVED" && <Button label="Restore" variant="secondary" onPress={() => void run(() => setAnnouncementStatus(supabase, existing!.id, "PUBLISHED"), "Restored and published.")} busy={busy} />}
                {status !== "ARCHIVED" && (
                  <Button
                    label="Archive"
                    variant="quiet"
                    disabled={busy}
                    onPress={() =>
                      setAsk({
                        title: `Archive "${existing!.title}"?`,
                        body: "It stops showing everywhere and is kept as history. You can restore it later.",
                        confirmLabel: "Archive Announcement",
                        destructive: true,
                        reason: "none",
                        onConfirm: async () => {
                          await setAnnouncementStatus(supabase, existing!.id, "ARCHIVED")
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

      <ReasonSheet ask={ask} onClose={() => setAsk(null)} onRefused={() => void load()} errorMessage={(cause) => contentErrorMessage(cause, friendly(cause, "this announcement").message)} />
    </AdminScreen>
  )
}
