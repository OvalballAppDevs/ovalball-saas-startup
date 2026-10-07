import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"

import {
  answerLabel,
  previewEventInvitations,
  readEventGuestList,
  removeEventGuest,
  saveEvent,
  saveEventGuest,
  searchInvitablePeople,
  sendEventInvitations,
  type EventCentre,
  type EventExternalGuest,
  type EventGuestList,
} from "@ovalball/contracts/events/centre"

import { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability/vocabulary"
import { supabase } from "../auth/supabase"
import { Button, CardSkeleton } from "../components/ui"
import { Check, Search, UserPlus, Users, X } from "../components/icons"
import { friendly, friendlyAction } from "../errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { AnswerChip } from "./event-card"
import { Chip, SectionCard, ToggleRow } from "./parts"

type Pane = "invite" | "responses" | "external"

/**
 * MANAGE GUESTS -- who is invited, who has answered, and the guests without an account. Everything here
 * is the organiser's; the server refuses all of it to anybody else.
 */
export function ManageGuests({ event, teams, onChanged }: { event: EventCentre; teams: { id: string; name: string }[]; onChanged: () => void }) {
  const [pane, setPane] = useState<Pane>(event.invitationsSentAt ? "responses" : "invite")
  const [list, setList] = useState<EventGuestList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setList(await readEventGuestList(supabase, event.id))
    } catch (caught) {
      setProblem(friendly(caught, "the guest list").message)
    }
  }, [event.id])
  useEffect(() => {
    void load()
  }, [load, event])

  const changed = () => {
    void load()
    onChanged()
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Chip label="Invite" selected={pane === "invite"} onPress={() => setPane("invite")} />
        <Chip label="Responses" selected={pane === "responses"} onPress={() => setPane("responses")} count={event.summary?.invited ?? null} />
        <Chip label="External" selected={pane === "external"} onPress={() => setPane("external")} count={list?.external.length ?? null} />
      </View>
      {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
      {pane === "invite" && <InvitePane event={event} teams={teams} list={list} onChanged={changed} />}
      {pane === "responses" && (list ? <ResponsesPane list={list} /> : <CardSkeleton lines={4} />)}
      {pane === "external" && (list ? <ExternalPane event={event} guests={list.external} onChanged={changed} /> : <CardSkeleton lines={3} />)}
    </View>
  )
}

function InvitePane({ event, teams, list, onChanged }: { event: EventCentre; teams: { id: string; name: string }[]; list: EventGuestList | null; onChanged: () => void }) {
  const [wholeClub, setWholeClub] = useState(event.isClubWide)
  const [teamIds, setTeamIds] = useState<string[]>(event.teams.map((t) => t.id))
  const [players, setPlayers] = useState(event.invites.players)
  const [staff, setStaff] = useState(event.invites.staff)
  const [members, setMembers] = useState(event.invites.members)
  const [people, setPeople] = useState<{ userId: string; name: string | null }[]>(list?.individuals ?? [])
  const [query, setQuery] = useState("")
  const [found, setFound] = useState<{ userId: string; name: string | null; detail: string }[]>([])
  const [teamQuery, setTeamQuery] = useState("")
  const [message, setMessage] = useState(event.invitationMessage ?? "")
  const [preview, setPreview] = useState<{ recipients: number; alreadyInvited: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => setPeople(list?.individuals ?? []), [list])
  const refreshPreview = useCallback(async () => {
    try {
      setPreview(await previewEventInvitations(supabase, event.id))
    } catch {
      setPreview(null)
    }
  }, [event.id])
  useEffect(() => {
    void refreshPreview()
  }, [refreshPreview, event])

  useEffect(() => {
    let live = true
    if (query.trim().length < 2) {
      setFound([])
      return
    }
    const t = setTimeout(() => {
      void searchInvitablePeople(supabase, event.id, query).then((r) => live && setFound(r)).catch(() => live && setFound([]))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, event.id])

  const savedPeople = (list?.individuals ?? []).map((p) => p.userId).sort().join(",")
  const dirty =
    wholeClub !== event.isClubWide ||
    teamIds.slice().sort().join(",") !== event.teams.map((t) => t.id).sort().join(",") ||
    players !== event.invites.players ||
    staff !== event.invites.staff ||
    members !== event.invites.members ||
    people.map((p) => p.userId).sort().join(",") !== savedPeople

  const shownTeams = useMemo(() => teams.filter((t) => !teamQuery || t.name.toLowerCase().includes(teamQuery.toLowerCase())), [teams, teamQuery])

  async function saveAudience() {
    setBusy(true)
    setProblem(null)
    try {
      await saveEvent(supabase, event.id, null, {
        is_club_wide: wholeClub,
        team_ids: wholeClub ? [] : teamIds,
        individual_user_ids: people.map((p) => p.userId),
        invite_players: players,
        invite_staff: staff,
        invite_members: wholeClub && members,
      })
      onChanged()
      await refreshPreview()
    } catch (caught) {
      setProblem(friendlyAction(caught, "save", "who is invited").message)
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      if (dirty) await saveAudience()
      const r = await sendEventInvitations(supabase, event.id, message.trim() || null)
      setDone(r.newlyInvited === 0 ? "Everybody invited has already been sent this invitation." : `Invitations sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`)
      onChanged()
      await refreshPreview()
    } catch (caught) {
      setProblem(friendlyAction(caught, "send", "the invitations").message)
    } finally {
      setBusy(false)
    }
  }

  const toSend = preview ? preview.recipients - preview.alreadyInvited : null
  return (
    <>
      <SectionCard title="Who do you want to invite?">
        <InviteOption icon={<Users size={20} color={colour.forest800} />} title="All Club Members" detail="Players, families, coaches and staff" selected={wholeClub} onPress={() => setWholeClub(true)} />
        <InviteOption icon={<Users size={20} color={colour.forest800} />} title="Select Teams" detail="Choose specific age groups or teams" selected={!wholeClub} onPress={() => setWholeClub(false)} />
        {!wholeClub && (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {teamIds.map((id) => (
                <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Remove ${teams.find((t) => t.id === id)?.name ?? "team"}`} onPress={() => setTeamIds((x) => x.filter((y) => y !== id))} style={{ minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.lineStrong }}>
                  <Text style={[type.small, { color: colour.ink }]}>{teams.find((t) => t.id === id)?.name ?? "Team"}</Text>
                  <X size={14} color={colour.inkMuted} />
                </Pressable>
              ))}
            </View>
            <SearchBox value={teamQuery} onChange={setTeamQuery} placeholder="Search for a team…" />
            {shownTeams.filter((t) => !teamIds.includes(t.id)).slice(0, 8).map((t) => (
              <Pressable key={t.id} accessibilityRole="button" onPress={() => setTeamIds((x) => [...x, t.id])} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.6 : 1 })}>
                <UserPlus size={16} color={colour.forest800} />
                <Text style={[type.small, { color: colour.ink }]}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <ToggleRow title="Players and their families" detail="Each player's guardians answer for them." value={players} onChange={setPlayers} />
        <ToggleRow title="Coaches and staff" value={staff} onChange={setStaff} />
        {wholeClub && <ToggleRow title="Every club member" detail="Members with no team, such as volunteers and supporters." value={members} onChange={setMembers} />}
      </SectionCard>

      <SectionCard title="Individual People">
        {people.map((p) => (
          <View key={p.userId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET }}>
            <Check size={16} color={colour.forest800} />
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{p.name ?? "Name not recorded"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${p.name ?? "this person"}`} onPress={() => setPeople((x) => x.filter((y) => y.userId !== p.userId))} hitSlop={8}>
              <X size={16} color={colour.inkMuted} />
            </Pressable>
          </View>
        ))}
        <SearchBox value={query} onChange={setQuery} placeholder="Search the club's members…" />
        {found.filter((f) => !people.some((p) => p.userId === f.userId)).map((f) => (
          <Pressable key={f.userId} accessibilityRole="button" accessibilityLabel={`Invite ${f.name}`} onPress={() => { setPeople((x) => [...x, { userId: f.userId, name: f.name }]); setQuery("") }} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.6 : 1 })}>
            <UserPlus size={16} color={colour.forest800} />
            <View style={{ flex: 1 }}>
              <Text style={[type.small, { color: colour.ink }]}>{f.name}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{f.detail}</Text>
            </View>
          </Pressable>
        ))}
      </SectionCard>

      {dirty && <Button label="Save Who Is Invited" variant="secondary" busy={busy} onPress={() => void saveAudience()} />}

      <SectionCard title="Add a Personal Message (Optional)">
        <TextInput
          accessibilityLabel="Personal message"
          value={message}
          onChangeText={setMessage}
          maxLength={500}
          multiline
          placeholder="We'd love you to join us. Please let us know if you can come."
          placeholderTextColor={colour.inkSubtle}
          style={[type.body, { minHeight: 88, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, textAlignVertical: "top" }]}
        />
        <Text style={[type.caption, { color: colour.inkSubtle, alignSelf: "flex-end" }]}>{message.length}/500</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Invitations arrive in the app with the event details and a link to respond. A child is reached through their guardians.</Text>
      </SectionCard>

      {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
      {!!done && <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>{done}</Text>}
      <Button
        label={toSend === null ? "Send Invitations" : toSend === 0 ? "Everyone Has Been Invited" : `Send Invitations (${toSend} ${toSend === 1 ? "Person" : "People"})`}
        busy={busy}
        disabled={toSend === 0 && !dirty}
        onPress={() => void send()}
      />
    </>
  )
}

function InviteOption({ icon, title, detail, selected, onPress }: { icon: React.ReactNode; title: string; detail: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: selected ? colour.forest800 : colour.line, backgroundColor: selected ? colour.mint100 : colour.surface, opacity: pressed ? 0.85 : 1 })}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{detail}</Text>
      </View>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: selected ? colour.forest800 : colour.lineStrong, backgroundColor: selected ? colour.forest800 : colour.surface, alignItems: "center", justifyContent: "center" }}>
        {selected && <Check size={14} color={colour.onForest} strokeWidth={3} />}
      </View>
    </Pressable>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
      <Search size={16} color={colour.inkSubtle} />
      <TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colour.inkSubtle} style={[type.body, { flex: 1, color: colour.ink }]} />
    </View>
  )
}

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "ATTENDING", label: ATTENDANCE_STATE_WORDS.ATTENDING },
  { key: "CANNOT_ATTEND", label: ATTENDANCE_STATE_WORDS.CANNOT_ATTEND },
  { key: "UNSURE", label: ATTENDANCE_STATE_WORDS.UNSURE },
  { key: "AWAITING", label: ATTENDANCE_STATE_WORDS.AWAITING },
] as const

function ResponsesPane({ list }: { list: EventGuestList }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL")
  const count = (k: string) => list.people.filter((p) => (k === "ALL" ? true : k === "AWAITING" ? !p.status : p.status === k)).length
  const shown = list.people.filter((p) => (filter === "ALL" ? true : filter === "AWAITING" ? !p.status : p.status === filter))
  return (
    <SectionCard title="Invitees">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} count={count(f.key)} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
      {shown.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>Nobody here.</Text>}
      {shown.map((p) => (
        <View key={`${p.kind}:${p.playerId ?? p.userId}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{p.name}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {[p.category === "PLAYER" ? p.teamName ?? "Player" : p.category === "STAFF" ? "Staff" : p.category === "INVITEE" ? "Invited" : "Member", p.status === "ATTENDING" ? `${p.guests + 1} ${p.guests === 0 ? "person" : "people"}` : null].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <AnswerChip status={p.status} waitlisted={p.waitlisted} />
        </View>
      ))}
    </SectionCard>
  )
}

function ExternalPane({ event, guests, onChanged }: { event: EventCentre; guests: EventExternalGuest[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setProblem(null)
    try {
      await saveEventGuest(supabase, event.id, null, { name, email: email || null, phone: phone || null, status: "ATTENDING", guests: count })
      setName("")
      setEmail("")
      setPhone("")
      setCount(0)
      setAdding(false)
      onChanged()
    } catch (caught) {
      setProblem(friendlyAction(caught, "add", "the guest").message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="External Guests">
      <Text style={[type.caption, { color: colour.inkMuted }]}>People without an Ovalball account, such as sponsors or speakers. You answer for them; they are never sent the guest list.</Text>
      {guests.length === 0 && !adding && <Text style={[type.small, { color: colour.inkMuted }]}>No external guests yet.</Text>}
      {guests.map((g) => (
        <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{g.name}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{[g.status ? answerLabel(g.status, g.waitlisted) : "No answer", g.guests > 0 ? `+${g.guests}` : null, g.email].filter(Boolean).join(" · ")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${g.name}`} onPress={() => void removeEventGuest(supabase, event.id, g.id).then(onChanged)} hitSlop={8}>
            <X size={16} color={colour.inkMuted} />
          </Pressable>
        </View>
      ))}
      {adding ? (
        <View style={{ gap: space.sm }}>
          <Labelled label="Name" value={name} onChange={setName} />
          <Labelled label="Email (Optional)" value={email} onChange={setEmail} keyboard="email-address" />
          <Labelled label="Mobile (Optional)" value={phone} onChange={setPhone} keyboard="phone-pad" />
          {event.maxGuests > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={[type.small, { color: colour.ink, flex: 1 }]}>Guests with them</Text>
              {[0, 1, 2, 3].filter((n) => n <= event.maxGuests).map((n) => (
                <Chip key={n} label={String(n)} selected={count === n} onPress={() => setCount(n)} />
              ))}
            </View>
          )}
          {!!problem && <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button label="Add Guest" busy={busy} disabled={name.trim().length === 0} onPress={() => void add()} />
        </View>
      ) : (
        <Button label="Add External Guest" variant="secondary" onPress={() => setAdding(true)} />
      )}
    </SectionCard>
  )
}

function Labelled({ label, value, onChange, keyboard }: { label: string; value: string; onChange: (v: string) => void; keyboard?: "email-address" | "phone-pad" }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType={keyboard ?? "default"} autoCapitalize={keyboard ? "none" : "words"} style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, color: colour.ink, backgroundColor: colour.surface }]} />
    </View>
  )
}
