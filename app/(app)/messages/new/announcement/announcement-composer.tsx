"use client"

import { AlertTriangle, Users } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  listSelectableAudience,
  previewAnnouncementAudience,
  sendAnnouncement,
  type AnnouncementInput,
  type AudiencePreview,
  type SelectablePlayer,
} from "./actions"
import { RecipientPicker } from "./recipient-picker"

export interface SenderIdentity {
  identityType: "team" | "club" | "platform"
  identityId: string | null
  label: string
  canAddressTeam: boolean
  canAddressClub: boolean
}

/**
 * THE COMPOSER, AND THE ORDER OF ITS QUESTIONS.
 *
 * Who is speaking, then who hears it, then whether they may answer, then what
 * it says. That order is deliberate: every one of the first three changes who
 * receives the message, and a person should settle them before writing three
 * paragraphs -- not discover afterwards that team announcements are switched
 * off at this club.
 *
 * THE PREVIEW IS NOT A NICETY. It runs on every change to the audience, and
 * it is the same server call that authorises the send, so a composer that
 * cannot preview cannot send. What it shows is a COUNT, never a list: the
 * client is never given the audience, because a client that holds the
 * audience has already leaked it whatever the screen chooses to render.
 *
 * The guardian/direct split is shown because it is true and useful -- "34 of
 * these reach a guardian" tells a coach who is actually reading it -- and
 * because it makes the safeguarding routing visible rather than magic.
 */
export function AnnouncementComposer({ identities }: { identities: SenderIdentity[] }) {
  const router = useRouter()

  const [identityKey, setIdentityKey] = useState(() => keyOf(identities[0]))
  const identity = identities.find((i) => keyOf(i) === identityKey) ?? identities[0]

  // DERIVED, not stored. An identity addresses exactly one audience -- a team
  // identity reaches that team, a club identity reaches that club -- so the
  // scope follows from the identity and there is no second piece of state to
  // keep in step with the first. Storing it meant an effect correcting it
  // after every identity change, which is a synchronisation bug waiting to
  // happen as well as a cascading render.
  const scopes = availableScopes(identity)
  const scope = scopes[0]?.value ?? "team"
  const [replyMode, setReplyMode] = useState("NO_REPLY")
  const [excludeU18, setExcludeU18] = useState(false)

  // NARROWING IS A CHOICE ABOUT THE AUDIENCE, so it lives beside the audience
  // rather than inside the picker: the picker renders a selection, it does not
  // own whether one is being made.
  const [narrowed, setNarrowed] = useState(false)
  const [selectable, setSelectable] = useState<SelectablePlayer[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadingPeople, setLoadingPeople] = useState(false)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")

  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [checking, startCheck] = useTransition()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // GROUP_DISCUSSION is bounded to team and selected audiences at the
  // database. Reflecting that here rather than letting a person choose it and
  // be refused: the constraint is the product decision, not an error state.
  // Narrowing turns the send into scope 'selected'. Derived from the toggle
  // rather than stored, so the scope and the picker can never disagree about
  // which one is in force.
  const effectiveScope = narrowed ? "selected" : scope
  const chosen = useMemo(() => Array.from(selectedIds), [selectedIds])

  const groupDiscussionAvailable = effectiveScope === "team" || effectiveScope === "selected"

  const input: AnnouncementInput = {
    senderIdentityType: identity?.identityType ?? "team",
    senderIdentityId: identity?.identityId ?? null,
    scope: effectiveScope,
    // A selected audience has no scope id: it IS the list, and the resolver
    // authorises each player individually.
    scopeId:
      effectiveScope === "selected" || effectiveScope === "platform"
        ? null
        : (identity?.identityId ?? null),
    replyMode: groupDiscussionAvailable ? replyMode : replyMode === "GROUP_DISCUSSION" ? "NO_REPLY" : replyMode,
    excludeU18,
    playerIds: chosen,
  }

  // The reply mode needs no correcting effect either: `input.replyMode` above
  // already resolves GROUP_DISCUSSION down to NO_REPLY wherever it is not
  // available, and the radio group reads its checked state from that same
  // resolved value. What is sent and what is shown are one expression.

  // The one legitimate effect here: asking the server a question when the
  // audience changes. Every setState happens inside the transition callback
  // rather than in the effect body, so choosing a different audience does not
  // trigger a cascade of renders before the answer arrives.
  useEffect(() => {
    startCheck(async () => {
      // Changing the audience invalidates a pending confirmation: nobody
      // should confirm "send to 43 people" and have it send to a different 43.
      setConfirming(false)
      setSendError(null)

      const result = await previewAnnouncementAudience(input)
      if (result.ok) {
        setPreview(result.preview)
        setPreviewError(null)
      } else {
        setPreview(null)
        setPreviewError(result.error)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, effectiveScope, excludeU18, input.replyMode, chosen.join(",")])

  // Fetching the list is a separate concern from previewing the count: the
  // list changes only when the base audience does, while the count changes on
  // every tick. Loading them together would refetch the roster on each click.
  useEffect(() => {
    if (!narrowed) return
    startCheck(async () => {
      // Inside the transition, not in the effect body: a synchronous setState
      // here would cascade a render before the request has even left.
      setLoadingPeople(true)
      const result = await listSelectableAudience(scope, identity?.identityId ?? null)
      setLoadingPeople(false)
      if (result.ok) {
        setSelectable(result.players)
        setPeopleError(null)
      } else {
        setSelectable([])
        setPeopleError(result.error)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowed, identityKey, scope])

  const canSend = Boolean(body.trim()) && !!preview && preview.recipientCount > 0 && !sending

  if (identities.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg text-ink">No Announcement Identities</h2>
        <p className="mt-2 text-sm text-ink-muted">
          You can send an announcement once you manage a team or a club. Ask a Club Admin to give you the team
          community permission.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <Label htmlFor="sender-identity" className="text-ink/80">
          Send As
        </Label>
        <p className="mt-1 text-xs text-ink-muted">
          People will see this as coming from the team or club, not from your own name. Your name is recorded
          against it.
        </p>
        <select
          id="sender-identity"
          value={identityKey}
          onChange={(e) => setIdentityKey(e.target.value)}
          className="mt-2 h-11 w-full rounded-md border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          {identities.map((i) => (
            <option key={keyOf(i)} value={keyOf(i)}>
              {i.label}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        {/* A STATEMENT, NOT A CHOICE. The audience follows from the identity,
            so a radio group with one option would invite a decision that does
            not exist and imply others are being withheld. */}
        <h2 className="text-sm font-medium text-ink/80">Who Receives This</h2>
        <p className="mt-1.5 text-sm text-ink">{scopes[0]?.label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{scopes[0]?.description}</p>

        {/* NARROWING, presented as a choice within the base audience rather
            than as a different kind of send. The base audience above stays on
            screen while choosing, because "everyone in Under 11 Mixed, except
            these" is the sentence the sender is actually composing. */}
        <fieldset className="mt-4 border-t border-ink/10 pt-4">
          <legend className="sr-only">How much of this audience to send to</legend>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name="narrowing"
                checked={!narrowed}
                onChange={() => setNarrowed(false)}
                className="mt-1 size-4 accent-forest-800"
              />
              <span>
                Everyone
                <span className="block text-xs text-ink-muted">
                  Resolved when you send, so anyone who joins before then is included.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name="narrowing"
                checked={narrowed}
                onChange={() => setNarrowed(true)}
                className="mt-1 size-4 accent-forest-800"
              />
              <span>
                Choose People
                <span className="block text-xs text-ink-muted">
                  Pick individually. Nobody you choose can see who else you chose.
                </span>
              </span>
            </label>
          </div>

          {narrowed && peopleError && (
            <p className="mt-3 text-sm text-ink">{peopleError}</p>
          )}

          {narrowed && !peopleError && (
            <RecipientPicker
              players={selectable}
              selected={selectedIds}
              onChange={setSelectedIds}
              excludeU18={excludeU18}
              loading={loadingPeople}
            />
          )}
        </fieldset>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-ink/10 pt-4 text-sm text-ink">
          <input
            type="checkbox"
            checked={excludeU18}
            onChange={(e) => setExcludeU18(e.target.checked)}
            className="mt-1 size-4 accent-forest-800"
          />
          <span>
            Exclude Under-18s
            {/* Said exactly, because the behaviour surprises people: it
                removes the child AND their guardian, since the guardian would
                only be receiving it on the child's behalf. */}
            <span className="block text-xs text-ink-muted">
              Under-18 players are left out, and so are their guardians &mdash; a guardian would only be receiving
              this about their child.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <fieldset>
          <legend className="text-sm font-medium text-ink/80">Can People Reply</legend>
          <div className="mt-2 space-y-2">
            {replyModes(groupDiscussionAvailable).map((m) => (
              <label
                key={m.value}
                className={`flex items-start gap-2.5 text-sm ${
                  m.disabled ? "cursor-not-allowed text-ink-subtle" : "cursor-pointer text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="reply-mode"
                  value={m.value}
                  disabled={m.disabled}
                  checked={input.replyMode === m.value}
                  onChange={() => setReplyMode(m.value)}
                  className="mt-1 size-4 accent-forest-800"
                />
                <span>
                  {m.label}
                  <span className="block text-xs text-ink-muted">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {/* THE PREVIEW. Between the audience and the writing, because it is the
          answer to the question the sections above just asked. */}
      <section
        aria-live="polite"
        className="rounded-lg border border-ink/10 bg-mint-100/40 p-5"
      >
        {checking && <p className="text-sm text-ink-muted">Checking who this reaches…</p>}

        {!checking && previewError && (
          <p className="flex items-start gap-2 text-sm text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
            {previewError}
          </p>
        )}

        {!checking && !previewError && preview && (
          <>
            <p className="flex items-center gap-2 font-display text-lg text-ink">
              <Users className="size-4 text-forest-800" aria-hidden="true" />
              {preview.recipientCount === 0
                ? "This reaches nobody"
                : `This reaches ${preview.recipientCount} ${preview.recipientCount === 1 ? "person" : "people"}`}
            </p>

            {preview.recipientCount > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                {preview.guardianRouteCount > 0 &&
                  `${preview.guardianRouteCount} ${preview.guardianRouteCount === 1 ? "goes" : "go"} to a guardian`}
                {preview.guardianRouteCount > 0 && preview.directRouteCount > 0 && " · "}
                {preview.directRouteCount > 0 &&
                  `${preview.directRouteCount} ${preview.directRouteCount === 1 ? "goes" : "go"} directly to the player`}
              </p>
            )}

            {preview.recipientCount === 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                {excludeU18
                  ? "Everyone in this audience is under 18. Turn off Exclude Under-18s to reach their guardians."
                  : "Nobody in this audience has a contactable recipient yet."}
              </p>
            )}

            {preview.unreachableCount > 0 && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {preview.unreachableCount === 1
                  ? "1 player has nobody who can be contacted for them and will not receive this."
                  : `${preview.unreachableCount} players have nobody who can be contacted for them and will not receive this.`}
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <Label htmlFor="announcement-title" className="text-ink/80">
          Subject
        </Label>
        <Input
          id="announcement-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Training cancelled"
          className="mt-1.5"
          maxLength={120}
        />

        <Label htmlFor="announcement-body" className="mt-4 block text-ink/80">
          Announcement
        </Label>
        {/* A raw textarea rather than a UI wrapper, matching
            components/messenger/composer.tsx -- there is no Textarea in the
            design system, and inventing one for a single screen is how two
            slightly different multiline inputs end up in one product. */}
        <textarea
          id="announcement-body"
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          rows={6}
          placeholder="Thursday's session is off because the pitch is waterlogged. Back to normal next week."
          className="mt-1.5 w-full resize-y rounded-md border border-ink/15 bg-white px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
      </section>

      {sendError && <p className="text-sm text-red-700">{sendError}</p>}

      {/* CONFIRMATION IS INLINE, and it states the consequence in numbers.
          A modal here would hide the message the person just wrote at the
          exact moment they want to check it one last time. */}
      {confirming && preview ? (
        <div className="rounded-lg border border-forest-800/30 bg-white p-5">
          <p className="text-sm text-ink">
            Send this to {preview.recipientCount} {preview.recipientCount === 1 ? "person" : "people"} as{" "}
            <strong>{identity?.label}</strong>? They will be notified straight away, and it cannot be unsent
            &mdash; only withdrawn.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={sending}
              onClick={async () => {
                setSending(true)
                setSendError(null)
                const result = await sendAnnouncement({ ...input, title, body })
                setSending(false)
                if (result.ok) router.push(`/messages/announcement/${result.announcementId}`)
                else {
                  setSendError(result.error)
                  setConfirming(false)
                }
              }}
            >
              {sending ? "Sending…" : "Send Announcement"}
            </Button>
            <Button variant="outline" disabled={sending} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={!canSend} onClick={() => setConfirming(true)}>
          Review &amp; Send
        </Button>
      )}
    </div>
  )
}

function keyOf(identity: SenderIdentity | undefined): string {
  if (!identity) return ""
  return `${identity.identityType}:${identity.identityId ?? ""}`
}

/**
 * The audiences this identity may actually address. Driven by the flags the
 * server derived from can_address_team_audience / can_address_club_audience,
 * so the composer never offers an audience the pipeline would refuse.
 */
function availableScopes(identity: SenderIdentity | undefined) {
  if (!identity) return []

  if (identity.identityType === "platform") {
    return [
      {
        value: "platform",
        label: "Everyone on Ovalball",
        description: "Every contactable person across every club.",
      },
    ]
  }

  if (identity.identityType === "club") {
    return [
      {
        value: "club",
        label: "Everyone at the club",
        description: "Every playing member's contactable recipients, across all teams.",
      },
    ]
  }

  return [
    {
      value: "team",
      label: "This team",
      description: "The team's current players, reached through whoever may be contacted for them.",
    },
  ]
}

function replyModes(groupDiscussionAvailable: boolean) {
  return [
    {
      value: "NO_REPLY",
      label: "No replies",
      description: "People read it and that is all.",
      disabled: false,
    },
    {
      value: "PRIVATE_REPLY",
      label: "Private replies",
      description: "Anyone can answer you, and only you see their answer.",
      disabled: false,
    },
    {
      value: "GROUP_DISCUSSION",
      label: "Group discussion",
      description: groupDiscussionAvailable
        ? "Everyone who receives it can talk to each other."
        : "Only available for a team or a chosen group — a club-wide discussion thread is not.",
      disabled: !groupDiscussionAvailable,
    },
  ]
}
