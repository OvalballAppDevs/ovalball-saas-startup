"use client"

import { useEffect, useState } from "react"
import { MoreHorizontal, Plus, Settings, X } from "lucide-react"

import type { ConversationKind } from "../../actions"
import { presenceLabel, PresenceDot, useFixturePresence } from "./fixture-presence"
import {
  addConversationParticipant,
  leaveConversation,
  listAddableClubMembers,
  rejoinConversation,
  removeConversationParticipant,
  setConversationMute,
  type AddableClubMember,
} from "./participants"

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-3">
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
        className="flex size-7 items-center justify-center rounded-full border border-ink/12 bg-white text-ink/50 outline-none transition-colors hover:border-forest-800/30 hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Settings className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-ink/10 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1.5 py-1">
            <p className="text-sm font-medium text-ink">Conversation settings</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-ink/40 hover:text-ink">
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
            <span className={muted ? "text-forest-800" : "text-ink/30"}>{muted ? "On" : "Off"}</span>
          </button>
          {!confirmLeave ? (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-destructive outline-none hover:bg-destructive/5 focus-visible:bg-destructive/5"
            >
              Leave conversation
            </button>
          ) : (
            <div className="rounded-md bg-chalk p-2.5">
              <p className="text-xs text-ink/60">
                You&rsquo;ll stop receiving message notifications for this fixture. You can rejoin later if your club role still gives
                you access, or an authorized manager can add you again.
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
                <button type="button" onClick={() => setConfirmLeave(false)} className="text-xs font-medium text-ink/50 hover:text-ink/75">
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
        className="flex size-7 items-center justify-center rounded-full border border-ink/12 bg-white text-ink/50 outline-none transition-colors hover:border-forest-800/30 hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Plus className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-ink/10 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">Add a participant</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-0.5 text-ink/40 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-ink/45">Coaches and club/fixtures officials from your own club can be given access to this fixture conversation.</p>
          <ul className="mt-2 max-h-56 overflow-y-auto">
            {members === "loading" ? (
              <li className="px-1 py-3 text-sm text-ink/40">Loading…</li>
            ) : members.length === 0 ? (
              <li className="px-1 py-3 text-sm text-ink/40">No other coaches or officials to add.</li>
            ) : (
              members.map((m) => {
                const added = addedIds.has(m.userId)
                return (
                  <li key={m.userId} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-2 hover:bg-ink/[0.03]">
                    <span className="truncate text-sm text-ink">{m.name}</span>
                    <button
                      type="button"
                      disabled={added || addingId === m.userId}
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
                      className="shrink-0 rounded-md bg-pitch-600 px-2.5 py-1 text-xs font-medium text-white outline-none hover:bg-pitch-600/90 disabled:bg-ink/15 disabled:text-ink/40"
                    >
                      {added ? "Added" : addingId === m.userId ? "Adding…" : "Add"}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}

function ParticipantRow({
  person,
  status,
  canRemove,
  kind,
  id,
}: {
  person: PresenceParticipant
  status: { online: boolean; label: string }
  canRemove: boolean
  kind: ConversationKind
  id: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)

  if (removed) return null

  return (
    <li className="relative flex items-center justify-between gap-2 text-sm text-ink/75">
      <span className="min-w-0 truncate">
        {person.name} <span className="text-ink/40">&middot; {person.roleLabel}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs text-ink/45">
          <PresenceDot online={status.online} />
          {status.label}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Manage ${person.name}`}
            className="rounded p-1 text-ink/35 outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        )}
      </span>
      {menuOpen && (
        <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-ink/10 bg-white p-2 shadow-lg">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-destructive outline-none hover:bg-destructive/5 focus-visible:bg-destructive/5"
            >
              Remove from conversation
            </button>
          ) : (
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
                <button type="button" onClick={() => setConfirming(false)} className="text-xs font-medium text-ink/50 hover:text-ink/75">
                  Cancel
                </button>
              </div>
            </div>
          )}
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

  const onlineCount = participants.filter((p) => onlineUserIds.has(p.userId)).length

  return (
    <details className="group relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-ink/12 bg-white py-1 pr-3 pl-1 text-xs font-medium text-forest-800 outline-none transition-colors hover:border-forest-800/30 focus-visible:ring-2 focus-visible:ring-pitch-400">
        <span className="flex -space-x-1.5">
          {participants.slice(0, 4).map((p) => (
            <span
              key={p.userId}
              className="flex size-5 items-center justify-center rounded-full border-2 border-white bg-forest-800 text-[9px] font-semibold text-white"
            >
              {p.name.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
        {participants.length} participant{participants.length === 1 ? "" : "s"}
        {onlineCount > 0 && <span className="text-pitch-700">&middot; {onlineCount} online</span>}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-ink/10 bg-white p-3 shadow-lg">
        {[...byClub.values()].map((group) => (
          <div key={group.clubName} className="mb-2 last:mb-0">
            <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{group.clubName}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {group.people.map((p) => (
                <ParticipantRow
                  key={p.userId}
                  person={p}
                  status={presenceLabel(p.userId, onlineUserIds, p.lastActiveAt)}
                  canRemove={canManageParticipants && p.clubId === myManageableClubId && p.userId !== myUserId}
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
