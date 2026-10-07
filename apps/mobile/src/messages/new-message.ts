import { useCallback, useEffect, useMemo, useState } from "react"
import { loadContactAvatars, type MessengerRow, type PresenceState } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { useSession } from "../auth/session"
import { useAppContexts } from "../context/contexts"
import { friendly, logDetail } from "../errors/translate"
import { matchesSearch } from "../components/messenger/conversation-row"
import { loadInbox } from "./inbox"
import { useDirectPresence } from "./presence"
import { groupRecipients, loadRecipients, openConversationWith, type Recipient } from "./recipients"

/**
 * WHO YOU CAN WRITE TO -- one model for the New Message screen and the compact messenger's New Message.
 *
 * NOT AN ADDRESS BOOK. People come from `my_direct_message_candidates()` (the canonical recipient authority);
 * RECENT is the people you already talk to; GROUPS are group conversations you are already in. Pictures come from
 * `my_contact_avatars`, presence from `my_direct_presence` -- each answering only for people already in one of
 * those sets. Search filters this set and never looks anybody else up.
 */

export interface ContactEntry {
  key: string
  kind: "person" | "group"
  name: string
  context: string | null
  avatarUrl: string | null
  presence: PresenceState | null
  /** A person to open a direct conversation with. */
  userId?: string
  /** An existing conversation to open. */
  conversationId?: string
  row?: MessengerRow
}

export interface ContactSectionModel {
  title: string | null
  entries: ContactEntry[]
}

const RECENT = 5
const GROUPS = 6

function sectionTitle(label: string): string {
  if (label === "Your team") return "Your Team"
  if (label === "Your club") return "Your Club"
  if (label === "Fixture contact") return "Fixture Contacts"
  return label
}

function contextOf(r: Recipient): string | null {
  return [r.detail, r.club !== r.detail ? r.club : null].filter(Boolean).join(" · ") || null
}

export function useNewMessage() {
  const { session } = useSession()
  const { sessionContext, active } = useAppContexts()
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [recent, setRecent] = useState<{ conversationId: string; userId: string; name: string }[]>([])
  const [groups, setGroups] = useState<MessengerRow[]>([])
  const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
  const [search, setSearch] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const presence = useDirectPresence()

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const [people, direct, inbox] = await Promise.all([
        loadRecipients(supabase),
        supabase.rpc("my_direct_conversations", { p_limit: RECENT }),
        sessionContext && session?.user ? loadInbox(supabase, sessionContext, session.user.id, active) : Promise.resolve([] as MessengerRow[]),
      ])
      const recentPeople = (direct.data ?? []).map((d) => ({ conversationId: d.conversation_id, userId: d.other_user_id, name: d.other_display_name ?? "Ovalball user" }))
      setRecipients(people)
      setRecent(recentPeople)
      setGroups(inbox.filter((row) => row.kind === "fixture" || row.kind === "request" || row.kind === "club"))
      setAvatars(await loadContactAvatars(supabase, [...people.map((p) => p.userId), ...recentPeople.map((p) => p.userId)]))
    } catch (caught) {
      const failure = friendly(caught, "who you can message")
      logDetail("recipients", failure)
      setProblem(failure.message)
    }
  }, [sessionContext, session, active])

  useEffect(() => {
    void load()
  }, [load])

  const needle = search.trim().toLowerCase()
  const sections = useMemo<ContactSectionModel[]>(() => {
    if (!recipients) return []
    const person = (userId: string, name: string, context: string | null, extra: Partial<ContactEntry> = {}): ContactEntry => ({
      key: `person:${userId}`,
      kind: "person",
      name,
      context,
      avatarUrl: avatars.get(userId) ?? null,
      presence: presence.presenceForUser(userId),
      userId,
      ...extra,
    })
    const recentEntries = recent.map((r) => {
      const known = recipients.find((p) => p.userId === r.userId)
      return person(r.userId, r.name, known ? contextOf(known) : null, { conversationId: r.conversationId, key: `recent:${r.conversationId}` })
    })
    const groupEntries = groups.map<ContactEntry>((g) => ({
      key: g.key,
      kind: "group",
      name: g.title,
      context: g.context,
      avatarUrl: g.logoUrl,
      presence: null,
      row: g,
    }))

    // WHILE SEARCHING: one clean list of everything that matches, no section headings.
    if (needle) {
      const seen = new Set<string>()
      const results: ContactEntry[] = []
      for (const entry of [...recentEntries, ...recipients.map((r) => person(r.userId, r.name, contextOf(r))), ...groupEntries]) {
        const id = entry.userId ?? entry.key
        if (seen.has(id)) continue
        const haystack = [entry.name, entry.context].join(" ").toLowerCase()
        const matches = entry.row ? matchesSearch(entry.row, search) : haystack.includes(needle)
        if (!matches) continue
        seen.add(id)
        results.push(entry)
      }
      return results.length ? [{ title: null, entries: results }] : []
    }

    const recentIds = new Set(recent.map((r) => r.userId))
    const list: ContactSectionModel[] = []
    if (recentEntries.length) list.push({ title: "Recent", entries: recentEntries })
    for (const group of groupRecipients(recipients.filter((r) => !recentIds.has(r.userId)), "")) {
      list.push({ title: sectionTitle(group.label), entries: group.people.map((r) => person(r.userId, r.name, contextOf(r))) })
    }
    if (groupEntries.length) list.push({ title: "Groups", entries: groupEntries.slice(0, GROUPS) })
    return list
  }, [recipients, recent, groups, avatars, presence, needle, search])

  /** Open (or start) the conversation for an entry. Resolves to where it is, or null with `problem` set. */
  const open = useCallback(
    async (entry: ContactEntry): Promise<{ kind: string; id: string; title: string; avatarUrl: string | null; row?: MessengerRow } | null> => {
      if (entry.row) {
        const id = entry.row.key.slice(entry.row.key.indexOf(":") + 1)
        return { kind: entry.row.kind, id, title: entry.name, avatarUrl: entry.avatarUrl, row: entry.row }
      }
      if (entry.conversationId) return { kind: "direct", id: entry.conversationId, title: entry.name, avatarUrl: entry.avatarUrl }
      if (!entry.userId || opening) return null
      setOpening(entry.userId)
      setProblem(null)
      const result = await openConversationWith(supabase, entry.userId)
      setOpening(null)
      if (!result.ok) {
        setProblem(result.message)
        return null
      }
      return { kind: "direct", id: result.conversationId, title: entry.name, avatarUrl: entry.avatarUrl }
    },
    [opening]
  )

  const loaded = recipients !== null
  return {
    sections,
    search,
    setSearch,
    searching: needle.length > 0,
    loaded,
    nothingAtAll: loaded && (recipients?.length ?? 0) === 0 && recent.length === 0 && groups.length === 0,
    problem,
    reload: load,
    opening,
    open,
  }
}
