"use client"

import { MessageSquare } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { openDirectConversation } from "@/app/(app)/messages/direct/[id]/actions"
import type { OppositionContact } from "@/app/(app)/fixtures/[fixtureId]/opposition-contacts"

/**
 * MESSAGE OPPOSITION, from the fixture.
 *
 * Rendered ONLY when the server returned somebody. Most fixtures name their
 * opponent from the Club Directory, where there is no account to message, and
 * an action that appears everywhere but works occasionally is worse than one
 * that appears exactly where it works.
 *
 * It opens a person-to-person conversation rather than a group thread: the
 * product decision is that contacting the opposition means reaching a named
 * human who can answer about the pitch, not posting somewhere nobody owns.
 *
 * Match Centre keeps running the fixture; this only hands the conversation
 * over to Messages, which is where every other conversation already lives.
 */
export function MessageOpposition({ contacts }: { contacts: OppositionContact[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (contacts.length === 0) return null

  // One contact is the common case: go straight there rather than making
  // somebody choose from a list of one.
  function contact(userId: string) {
    setError(null)
    startTransition(async () => {
      const result = await openDirectConversation(userId)
      if (result.ok) router.push(`/messages/direct/${result.conversationId}`)
      else setError(result.error)
    })
  }

  return (
    <div className="mt-3">
      {contacts.length === 1 ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => contact(contacts[0].userId)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          {pending ? "Opening…" : `Message ${contacts[0].displayName}`}
          <span className="text-xs font-normal text-ink-muted">{contacts[0].teamLabel}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            Message Opposition
          </button>

          {open && (
            <ul className="mt-2 divide-y divide-ink/10 overflow-hidden rounded-lg border border-ink/12 bg-white">
              {contacts.map((person) => (
                <li key={person.userId}>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Message ${person.displayName}`}
                    onClick={() => contact(person.userId)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] disabled:opacity-60"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-forest-800 text-[11px] font-semibold text-white">
                      {person.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{person.displayName}</span>
                      {/* WHY THIS PERSON IS HERE. A name alone from another
                          club is a stranger; the team and club make it a
                          fixture contact. */}
                      <span className="block truncate text-xs text-ink-muted">
                        {person.teamLabel} · {person.clubLabel}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-ink">{error}</p>}
    </div>
  )
}
