"use client"

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { MoreHorizontal, Plus, Settings, X } from "lucide-react"

import type { ConversationKind } from "../../actions"
import { presenceLabel, PresenceDot, useFixturePresence } from "./fixture-presence"
import { addConversationParticipant, blockUser, leaveConversation, listAddableClubMembers, rejoinConversation, removeConversationParticipant, setConversationMute, type AddableClubMember } from "./participants"

export interface PresenceParticipant {
  userId: string
  name: string
  roleLabel: string
  clubId: string
  clubName: string
  lastActiveAt: string | null
}

/**
 * ONE shared presence subscription for the whole header (not one per
 * sub-component) -- Supabase Realtime's channel registry is keyed by topic,
 * and two independent `.channel(sameTopic)` + `.subscribe()` calls for the
 * same topic collide ("cannot add presence callbacks... after subscribe()").
 * The header badge and participants panel both read from this one hook
 * call and render side by side.
 */
export function FixtureConversationHeader({
  topic,
  myUserId,
  kind,
  id,
  participants,
  canManageParticipants,
  myManageableClubId,
  myMuted,
  myLeft,
  dateStatusLine,
}: {
  topic: string
  myUserId: string
  kind: ConversationKind
  id: string
  participants: PresenceParticipant[]
  canManageParticipants: boolean
  myManageableClubId: string | null
  myMuted: boolean
  myLeft: boolean
  dateStatusLine: React.ReactNode
}) {
  const onlineUserIds = useFixturePresence(topic, myUserId)

  return (
    <div>
      {myLeft && kind !== "club" && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
          <p className="text-sm text-ink/70">You left this conversation. You won&rsquo;t get notifications for new messages here.</p>
          <RejoinButton kind={kind} id={id} />
        </div>
      )}
      {/*
        ONE ROW OF CONVERSATION ACTIONS, not a second header.
        Kick-off negotiation on the left, the people and their controls on the
        right, on the header's own dark ground -- so participant metadata stops
        competing with the name of the club you are talking to.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>{dateStatusLine}</div>
        <div className="flex items-center gap-1.5">
          {participants.length > 0 && (
            <ParticipantsPanel
              participants={participants}
              onlineUserIds={onlineUserIds}
              myUserId={myUserId}
              kind={kind}
              id={id}
              // A club conversation's participant list (both clubs'
              // officials) is read-only display for now -- add/remove is
              // deliberately deferred alongside attachments/documents
              // (see actions.ts), never silently offered then failing.
              canManageParticipants={kind === "club" ? false : canManageParticipants}
              myManageableClubId={myManageableClubId}
            />
          )}
          {kind !== "club" && (
            <>
              <AddParticipantButton kind={kind} id={id} />
              <ConversationSettingsButton kind={kind} id={id} myMuted={myMuted} myLeft={myLeft} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RejoinButton({ kind, id }: { kind: ConversationKind; id: string }) {
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await rejoinConversation(kind, id)
        setPending(false)
      }}
      className="shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-forest-800 outline-none hover:bg-forest-800/5 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
    >
      {pending ? "Rejoining…" : "Rejoin conversation"}
    </button>
  )
}

function ConversationSettingsButton({ kind, id, myMuted, myLeft }: { kind: ConversationKind; id: string; myMuted: boolean; myLeft: boolean }) {
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(myMuted)
  const [muting, setMuting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  if (myLeft) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Conversation settings"
        title="Conversation settings"
        className="flex size-9 items-center justify-center rounded-full text-chalk/70 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Settings className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-ink/10 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1.5 py-1">
            <p className="text-sm font-medium text-ink">Conversation settings</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-ink-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            disabled={muting}
            onClick={async () => {
              setMuting(true)
              const next = !muted
              const result = await setConversationMute(kind, id, next)
              setMuting(false)
              if (result.ok) setMuted(next)
            }}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm text-ink/75 outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03]"
          >
            <span>Mute notifications</span>
            <span className={muted ? "text-forest-800" : "text-ink-muted"}>{muted ? "On" : "Off"}</span>
          </button>
          {!confirmLeave ? (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-destructive-text outline-none hover:bg-destructive/5 focus-visible:bg-destructive/5"
            >
              Leave conversation
            </button>
          ) : (
            <div className="rounded-md bg-chalk p-2.5">
              <p className="text-xs text-ink/60">
                You&rsquo;ll stop receiving message notifications for this fixture. You can rejoin later if your club role still gives
                you access, or an authorised manager can add you again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={leaving}
                  onClick={async () => {
                    setLeaving(true)
                    const result = await leaveConversation(kind, id)
                    setLeaving(false)
                    if (result.ok) setOpen(false)
                  }}
                  className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white outline-none hover:bg-destructive/90 disabled:opacity-50"
                >
                  {leaving ? "Leaving…" : "Leave"}
                </button>
                <button type="button" onClick={() => setConfirmLeave(false)} className="text-xs font-medium text-ink-muted hover:text-ink/75">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AddParticipantButton({ kind, id }: { kind: ConversationKind; id: string }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<AddableClubMember[] | "loading">("loading")
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    listAddableClubMembers(kind, id).then((result) => {
      if (active) setMembers(result)
    })
    return () => {
      active = false
    }
  }, [open, kind, id])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add a participant from your club"
        title="Add a participant"
        className="flex size-9 items-center justify-center rounded-full text-chalk/70 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Plus className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-ink/10 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">Add a participant</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-ink-muted hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">Coaches and club/fixtures officials from your own club can be given access to this fixture conversation.</p>
          <ul className="mt-2 max-h-56 overflow-y-auto">
            {members === "loading" ? (
              <li className="px-1 py-3 text-sm text-ink-muted">Loading…</li>
            ) : members.length === 0 ? (
              <li className="px-1 py-3 text-sm text-ink-muted">No other coaches or officials to add.</li>
            ) : (
              members.map((m) => {
                const added = addedIds.has(m.userId)
                return (
                  <li key={m.userId} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-2 hover:bg-ink/[0.03]">
                    <span className={`truncate text-sm ${m.blockedByMe ? "text-ink-subtle" : "text-ink"}`}>{m.name}</span>
                    {/* "Blocked" reports the viewer's OWN decision, so it is
                        safe to state plainly. Somebody who has blocked the
                        viewer never reaches this list at all -- the server
                        omits them -- so there is no equivalent label in the
                        other direction and no way to infer one. */}
                    <button
                      type="button"
                      disabled={added || m.blockedByMe || addingId === m.userId}
                      onClick={async () => {
                        setAddingId(m.userId)
                        setError(null)
                        const result = await addConversationParticipant(kind, id, m.userId)
                        setAddingId(null)
                        if (!result.ok) {
                          setError(result.error)
                          return
                        }
                        setAddedIds((prev) => new Set(prev).add(m.userId))
                      }}
                      className="shrink-0 rounded-md bg-pitch-600 px-2.5 py-1 text-xs font-medium text-white outline-none hover:bg-pitch-600/90 disabled:bg-ink/15 disabled:text-ink-muted"
                    >
                      {m.blockedByMe ? "Blocked" : added ? "Added" : addingId === m.userId ? "Adding…" : "Add"}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {error && <p className="mt-1.5 text-xs text-destructive-text">{error}</p>}
        </div>
      )}
    </div>
  )
}

function ParticipantRow({
  person,
  status,
  canRemove,
  canBlock,
  kind,
  id,
}: {
  person: PresenceParticipant
  status: { online: boolean; label: string }
  canRemove: boolean
  /**
   * Whether this row is a PERSON the viewer could meaningfully block -- never
   * themselves, and never an organisational identity. Blocking is about one
   * human declining contact from another; there is nobody to decline on a
   * team or a club.
   */
  canBlock: boolean
  kind: ConversationKind
  id: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)

  if (removed) return null

  const hasMenu = canRemove || canBlock

  /**
   * ESCAPE BACKS OUT ONE STEP AT A TIME, and never performs the action.
   * From a confirmation it returns to the menu; from the menu it closes.
   * Without this the only way out of "Block this person?" was to find and
   * click Cancel, which is the wrong thing to ask of somebody who has just
   * realised they opened the wrong row.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLLIElement>) {
    if (event.key !== "Escape") return
    event.stopPropagation()
    if (confirmBlock) {
      setConfirmBlock(false)
      setBlockError(null)
    } else if (confirming) {
      setConfirming(false)
    } else {
      setMenuOpen(false)
    }
  }

  return (
    <li className="relative flex items-center justify-between gap-2 text-sm text-ink/75" onKeyDown={hasMenu ? handleKeyDown : undefined}>
      <span className="min-w-0 truncate">
        {person.name} <span className="text-ink-muted">&middot; {person.roleLabel}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <PresenceDot online={status.online} />
          {status.label}
        </span>
        {hasMenu && (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Manage ${person.name}`}
            className="rounded p-1 text-ink-muted outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        )}
      </span>
      {menuOpen && (
        <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-ink/10 bg-white p-2 shadow-lg">
          {/* THREE DIFFERENT ACTS, kept visually distinct.
              "Remove from conversation" is an administrative act on the
              conversation. "Block" is a personal decision about contact, and
              affects nothing about this fixture. Confusing them would be easy
              and expensive, so blocking sits below a rule with its own
              heading rather than as a fourth item in one undifferentiated
              list of red text. */}
          {canBlock && !confirming && (
            <div className={canRemove ? "mb-1 border-b border-ink/10 pb-1" : ""}>
              {!confirmBlock ? (
                <button
                  type="button"
                  onClick={() => setConfirmBlock(true)}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-ink/75 outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03]"
                >
                  Block {person.name.split(" ")[0]}
                </button>
              ) : (
                <div className="p-1">
                  <p className="text-xs font-medium text-ink">Block {person.name}?</p>
                  {/* The consequence, accurately and in that order: what stops,
                      what does NOT stop, and the fact they are not told. The
                      middle clause is the one people get wrong -- blocking a
                      coach must not read as leaving the team. */}
                  <p className="mt-1 text-xs text-ink/60">
                    They won&rsquo;t be able to message you privately, and you won&rsquo;t be able to message them.
                    You&rsquo;ll still see each other in team conversations, and announcements from a team or club
                    still reach you both. They aren&rsquo;t told.
                  </p>
                  {blockError && <p className="mt-1.5 text-xs text-red-700">{blockError}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={blocking}
                      onClick={async () => {
                        setBlocking(true)
                        setBlockError(null)
                        const result = await blockUser(person.userId)
                        setBlocking(false)
                        if (result.ok) {
                          setConfirmBlock(false)
                          setMenuOpen(false)
                        } else {
                          setBlockError(result.error)
                        }
                      }}
                      className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white outline-none hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
                    >
                      {blocking ? "Blocking…" : "Block"}
                    </button>
                    <button
                      type="button"
                      disabled={blocking}
                      onClick={() => {
                        setConfirmBlock(false)
                        setBlockError(null)
                      }}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-ink/70 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {canRemove && !confirmBlock && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-destructive-text outline-none hover:bg-destructive/5 focus-visible:bg-destructive/5"
            >
              Remove from conversation
            </button>
          ) : confirming ? (
            <div className="p-1">
              <p className="text-xs text-ink/60">
                Remove <span className="font-medium text-ink">{person.name}</span> from this conversation? They will no longer receive
                messages or notifications for this fixture unless added again. This will not remove them from their club or change
                their Ovalball permissions.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={removing}
                  onClick={async () => {
                    setRemoving(true)
                    const result = await removeConversationParticipant(kind, id, person.userId)
                    setRemoving(false)
                    if (result.ok) setRemoved(true)
                  }}
                  className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white outline-none hover:bg-destructive/90 disabled:opacity-50"
                >
                  {removing ? "Removing…" : "Remove"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-xs font-medium text-ink-muted hover:text-ink/75">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </li>
  )
}

function ParticipantsPanel({
  participants,
  onlineUserIds,
  myUserId,
  kind,
  id,
  canManageParticipants,
  myManageableClubId,
}: {
  participants: PresenceParticipant[]
  onlineUserIds: Set<string>
  myUserId: string
  kind: ConversationKind
  id: string
  canManageParticipants: boolean
  myManageableClubId: string | null
}) {
  const byClub = new Map<string, { clubName: string; people: PresenceParticipant[] }>()
  for (const p of participants) {
    const entry = byClub.get(p.clubId) ?? { clubName: p.clubName, people: [] }
    entry.people.push(p)
    byClub.set(p.clubId, entry)
  }
  // A → Z inside every club, regardless of how the rows arrived. Sorted here
  // as well as upstream so any future caller of this panel gets the ordering
  // without having to remember it.
  for (const entry of byClub.values()) {
    entry.people.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }))
  }

  const onlineCount = participants.filter((p) => onlineUserIds.has(p.userId)).length

  return (
    <details className="group relative">
      {/* An avatar stack, not a sentence. "1 participant · 1 online" was a
          large light pill on the header competing with the name of the club
          you are talking to; the people are shown, the counts live inside. */}
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-1.5 text-xs font-medium text-chalk/80 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400">
        <span className="flex -space-x-1.5">
          {participants.slice(0, 4).map((p) => (
            <span
              key={p.userId}
              className="flex size-6 items-center justify-center rounded-full bg-forest-800 text-[9px] font-semibold text-white ring-2 ring-forest-950"
            >
              {p.name.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
        {participants.length} participant{participants.length === 1 ? "" : "s"}
        {onlineCount > 0 && (
          <span className="size-1.5 shrink-0 rounded-full bg-pitch-400" title={`${onlineCount} online`} aria-label={`${onlineCount} online`} />
        )}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-ink/10 bg-white p-3 shadow-lg">
        {[...byClub.values()].map((group) => (
          <div key={group.clubName} className="mb-2 last:mb-0">
            <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{group.clubName}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {group.people.map((p) => (
                <ParticipantRow
                  key={p.userId}
                  person={p}
                  status={presenceLabel(p.userId, onlineUserIds, p.lastActiveAt)}
                  canRemove={canManageParticipants && p.clubId === myManageableClubId && p.userId !== myUserId}
                  // Anyone but yourself. Blocking needs no authority over the
                  // other person -- it is a decision about your own inbox --
                  // so it is offered wherever a real human is named.
                  canBlock={p.userId !== myUserId}
                  kind={kind}
                  id={id}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
