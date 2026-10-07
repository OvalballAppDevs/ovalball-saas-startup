import { useEffect, useMemo, useState } from "react"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { Image } from "expo-image"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { EVENT_TYPES, saveEvent, type EventCentre, type EventPatch, type EventType } from "@ovalball/contracts/events/centre"

import { supabase } from "../auth/supabase"
import { ChoiceSheet } from "../components/field-sheet"
import { DateField, Field, TimeField } from "../components/form"
import { Button } from "../components/ui"
import { Check, ChevronRight, MapPin } from "../components/icons"
import { friendlyAction } from "../errors/translate"
import { readFileBytes } from "../messages/pickers"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { MEDIA_PROVENANCE_WORDS } from "@ovalball/contracts/media/stock-library"
import { coverPhotoSource } from "../media/stock-assets"
import { MediaPickerSheet, chosenStockLabel, type MediaChoice } from "../media/media-picker"
import { Chip, SectionCard, ToggleRow } from "./parts"

type Venue = { id: string; name: string; detail: string | null }
type EventPitch = { id: string; name: string; venueId: string }
type Team = { id: string; name: string }

/**
 * CREATE / EDIT EVENT -- one form for both, and ONE save (`save_event`) whatever changed, so one Save is at
 * most one notice to the people already invited. Who may create or edit, for which teams, at which venue,
 * is the server's answer: a team manager is offered their own sides and refused anything wider.
 */
export function EventEditor({
  clubId,
  event,
  defaultTeamId,
  onClose,
  onSaved,
}: {
  clubId: string
  event: EventCentre | null
  /** Creating from a team's context: that team hosts it and is invited. */
  defaultTeamId?: string | null
  onClose: () => void
  onSaved: (eventId: string) => void
}) {
  const insets = useSafeAreaInsets()
  const today = new Date().toISOString().slice(0, 10)
  const [venues, setVenues] = useState<Venue[]>([])
  const [pitches, setPitches] = useState<EventPitch[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [picker, setPicker] = useState<null | "type" | "venue" | "host">(null)

  const [eventType, setEventType] = useState<EventType>(event?.eventType ?? (defaultTeamId ? "TEAM_EVENT" : "SOCIAL"))
  const [name, setName] = useState(event?.name ?? "")
  const [hostTeamId, setHostTeamId] = useState<string | null>(event?.host.teamId ?? defaultTeamId ?? null)
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? today)
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? today)
  const [startTime, setStartTime] = useState<string | null>(event?.startTime ?? "18:00")
  const [endTime, setEndTime] = useState<string | null>(event ? event.endTime : "21:00")
  const [meetTime, setMeetTime] = useState<string | null>(event?.meetTime ?? null)
  const [kind, setKind] = useState<"VENUE" | "EXTERNAL" | "ONLINE">(event?.location.kind ?? "VENUE")
  const [venueId, setVenueId] = useState<string | null>(event?.location.venue?.id ?? null)
  // THE PITCHES THIS EVENT RESERVES -- only ever at its own ground; Arena shows the event holding exactly these.
  const [pitchIds, setPitchIds] = useState<string[]>(event?.location.pitches?.map((p) => p.id) ?? [])
  const [detail, setDetail] = useState(event?.location.detail ?? "")
  const [extName, setExtName] = useState(event?.location.external?.name ?? "")
  const [extAddress, setExtAddress] = useState(event?.location.external?.address ?? "")
  const [extPostcode, setExtPostcode] = useState(event?.location.external?.postcode ?? "")
  const [onlineUrl, setOnlineUrl] = useState(event?.location.onlineUrl ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [catering, setCatering] = useState(event?.catering.required ?? false)
  const [maxGuests, setMaxGuests] = useState(event?.maxGuests ?? 0)
  const [capacityOn, setCapacityOn] = useState(event?.capacity.limit !== null && event?.capacity.limit !== undefined)
  const [capacity, setCapacity] = useState(String(event?.capacity.limit ?? 100))
  const [waitingList, setWaitingList] = useState(event?.capacity.waitingList ?? false)
  const [deadlineOn, setDeadlineOn] = useState(!!event?.rsvp.deadline)
  const [deadline, setDeadline] = useState(event?.rsvp.deadline ? event.rsvp.deadline.slice(0, 10) : today)
  const [paid, setPaid] = useState(event?.payment.mode === "PAID_EXTERNALLY")
  const [priceNote, setPriceNote] = useState(event?.payment.note ?? "")
  const [coverKey, setCoverKey] = useState<string | null>(event?.cover.stockKey ?? null)
  const [coverPath, setCoverPath] = useState<string | null>(event?.cover.path ?? null)
  const [uploading, setUploading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([
      supabase.from("venues").select("id, name, town, postcode, is_default_home").eq("club_id", clubId).eq("active", true).order("is_default_home", { ascending: false }).order("name"),
      supabase.from("teams").select("id, display_name").eq("club_id", clubId).eq("active", true).is("archived_at", null).order("display_name"),
      supabase.from("club_pitches").select("id, display_name, venue_id, sort_order").eq("club_id", clubId).eq("active", true).order("sort_order").order("display_name"),
    ]).then(([v, t, p]) => {
      if (!live) return
      setPitches((p.data ?? []).filter((r) => !!r.venue_id).map((r) => ({ id: r.id, name: r.display_name, venueId: r.venue_id as string })))
      const vs = (v.data ?? []).map((r) => ({ id: r.id, name: r.name, detail: [r.town, r.postcode].filter(Boolean).join(", ") || null }))
      setVenues(vs)
      setTeams((t.data ?? []).map((r) => ({ id: r.id, name: r.display_name })))
      if (!event && !venueId && vs[0]) setVenueId(vs[0].id)
    })
    return () => {
      live = false
    }
  }, [clubId, event, venueId])

  const venue = venues.find((v) => v.id === venueId) ?? null
  const venuePitches = pitches.filter((p) => p.venueId === venueId)
  const host = teams.find((t) => t.id === hostTeamId) ?? null
  const typeHint = useMemo(() => EVENT_TYPES.find((t) => t.value === eventType)?.hint ?? "", [eventType])

  /** A choice from the one media picker: a library key, a file to upload to this event, or back to the default. */
  async function chooseCover(choice: MediaChoice) {
    setPickerOpen(false)
    if (choice === null) {
      setCoverKey(null)
      setCoverPath(null)
      return
    }
    if (choice.kind === "stock") {
      setCoverKey(choice.key)
      setCoverPath(null)
      return
    }
    if (!event) return
    setUploading(true)
    try {
      const bytes = await readFileBytes(choice.uri)
      if (!bytes) throw new Error("That photo could not be read.")
      const path = `${event.id}/${Date.now()}.jpg`
      const { error } = await supabase.storage.from("event-covers").upload(path, bytes, { contentType: choice.mimeType || "image/jpeg", upsert: false })
      if (error) throw error
      setCoverPath(path)
      setCoverKey(null)
    } catch (caught) {
      setProblem(friendlyAction(caught, "upload", "the picture").message)
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setSaving(true)
    setProblem(null)
    const patch: EventPatch = {
      name: name.trim(),
      event_type: eventType,
      description: description.trim() || null,
      starts_on: startsOn,
      ends_on: endsOn < startsOn ? startsOn : endsOn,
      start_time: startTime,
      end_time: endTime,
      meet_time: meetTime,
      host_team_id: hostTeamId,
      location_kind: kind,
      location_detail: kind === "VENUE" ? detail.trim() || null : null,
      venue_id: kind === "VENUE" ? venueId : null,
      // A set, at this ground only; another kind of place holds none (the server says so too).
      ...(kind === "VENUE" ? { pitch_ids: pitchIds.filter((id) => venuePitches.some((p) => p.id === id)) } : {}),
      external: kind === "EXTERNAL" ? { name: extName.trim(), address_line_1: extAddress.trim(), postcode: extPostcode.trim() } : undefined,
      online_url: kind === "ONLINE" ? onlineUrl.trim() : null,
      catering_required: catering,
      max_guests: maxGuests,
      capacity: capacityOn ? Number(capacity) || null : null,
      waiting_list_enabled: capacityOn && waitingList,
      rsvp_deadline: deadlineOn ? `${deadline}T23:59:00+00:00` : null,
      payment_mode: paid ? "PAID_EXTERNALLY" : "FREE",
      price_note: paid ? priceNote.trim() || null : null,
      cover_stock_key: coverPath ? null : coverKey,
      cover_image_path: coverPath,
    }
    if (!event) {
      // A new event starts with its natural audience: the hosting side, or the whole club.
      Object.assign(patch, hostTeamId ? { team_ids: [hostTeamId], is_club_wide: false } : { is_club_wide: true, team_ids: [] })
    }
    try {
      const r = await saveEvent(supabase, event?.id ?? null, event ? null : clubId, patch)
      onSaved(r.eventId)
      onClose()
    } catch (caught) {
      setProblem(friendlyAction(caught, "save", "the event").message)
    } finally {
      setSaving(false)
    }
  }

  const valid = name.trim().length > 0 && (kind !== "VENUE" || !!venueId) && (kind !== "EXTERNAL" || extName.trim().length > 0) && (kind !== "ONLINE" || /^https:\/\//i.test(onlineUrl.trim()))

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>{event ? "Edit Event" : "Create Event"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close without saving" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <Field label="Event Type" hint={typeHint ? `e.g. ${typeHint}` : undefined}>
            <Trigger label={EVENT_TYPES.find((t) => t.value === eventType)?.label ?? "Event"} onPress={() => setPicker("type")} />
          </Field>
          <Field label="Event Title">
            <Input value={name} onChange={setName} placeholder="Christmas Party" max={100} label="Event title" />
          </Field>
          <Field label="Hosted By" hint="A team's own event is hosted by that team; everything else by the club.">
            <Trigger label={host ? host.name : "The club"} onPress={() => setPicker("host")} />
          </Field>

          <Field label="Date">
            <DateField label="Date" value={startsOn} onChange={(d) => { setStartsOn(d); if (endsOn < d) setEndsOn(d) }} />
          </Field>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Field label="Start Time">
                <TimeField label="Start Time" value={startTime} onChange={setStartTime} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="End Time" hint={endTime ? undefined : "Not set"}>
                <TimeField label="End Time" value={endTime} onChange={setEndTime} />
              </Field>
            </View>
          </View>
          <Field label="Arrival Time (Optional)" hint={meetTime ? "When people should arrive." : "Not set. For a trip, a run or anything people need to be early for."}>
            <TimeField label="Arrival Time" value={meetTime} onChange={setMeetTime} />
          </Field>
          <Field label="Finishes On" hint="Only for an event over more than one day.">
            <DateField label="Finishes On" value={endsOn} onChange={setEndsOn} />
          </Field>

          <Field label="Location">
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {(
                [
                  ["VENUE", "Club Venue"],
                  ["EXTERNAL", "External Address"],
                  ["ONLINE", "Online"],
                ] as const
              ).map(([k, l]) => (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} onPress={() => setKind(k)} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: kind === k ? colour.forest800 : colour.lineStrong, backgroundColor: kind === k ? colour.mint100 : colour.surface, opacity: pressed ? 0.85 : 1 })}>
                  {kind === k && <Check size={14} color={colour.forest800} strokeWidth={2.6} />}
                  <Text numberOfLines={1} style={[type.smallMedium, { color: kind === k ? colour.forest800 : colour.ink, fontSize: 13 }]}>{l}</Text>
                </Pressable>
              ))}
            </View>
          </Field>
          {kind === "VENUE" && (
            <>
              <Field label="Venue">
                <Trigger label={venue?.name ?? "Choose a venue"} sub={venue?.detail} icon onPress={() => setPicker("venue")} />
              </Field>
              {venuePitches.length > 0 && (
                <Field label="Pitches Reserved (Optional)" hint="Only a pitch the event uses. Arena then shows it as held, and nothing else can be put on it.">
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                    {venuePitches.map((p) => {
                      const on = pitchIds.includes(p.id)
                      return (
                        <Pressable key={p.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Reserve ${p.name}`}
                          onPress={() => setPitchIds((ids) => (on ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
                          style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, opacity: pressed ? 0.85 : 1 })}>
                          {on && <Check size={14} color={colour.forest800} strokeWidth={2.6} />}
                          <Text style={[type.smallMedium, { color: on ? colour.forest800 : colour.ink }]}>{p.name}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </Field>
              )}
              <Field label="Room or Area (Optional)" hint="Function Room, Bar, Outdoor Area…">
                <Input value={detail} onChange={setDetail} placeholder="Function Room" max={80} label="Room or area" />
              </Field>
            </>
          )}
          {kind === "EXTERNAL" && (
            <>
              <Field label="Place Name">
                <Input value={extName} onChange={setExtName} placeholder="Walton Gardens" max={160} label="Place name" />
              </Field>
              <Field label="Address">
                <Input value={extAddress} onChange={setExtAddress} placeholder="Walton Lea Road, Warrington" max={200} label="Address" />
              </Field>
              <Field label="Postcode">
                <Input value={extPostcode} onChange={setExtPostcode} placeholder="WA4 6SN" max={10} label="Postcode" caps="characters" />
              </Field>
            </>
          )}
          {kind === "ONLINE" && (
            <Field label="Meeting Link" hint="Only the people invited and the organisers ever see this.">
              <Input value={onlineUrl} onChange={setOnlineUrl} placeholder="https://" max={500} label="Meeting link" caps="none" />
            </Field>
          )}

          <Field label="Description">
            <TextInput accessibilityLabel="Description" value={description} onChangeText={setDescription} maxLength={500} multiline placeholder="Food, music and a chance for everyone to celebrate the year." placeholderTextColor={colour.inkSubtle} style={[type.body, { minHeight: 96, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink, textAlignVertical: "top" }]} />
            <Text style={[type.caption, { color: colour.inkSubtle, alignSelf: "flex-end" }]}>{description.length}/500</Text>
          </Field>

          <SectionCard title="Responses">
            <ToggleRow title="Catering Required" detail="Ask how many people need food and any dietary requirements." value={catering} onChange={setCatering} />
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Guests Each Person May Bring</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <Chip key={n} label={n === 0 ? "None" : String(n)} selected={maxGuests === n} onPress={() => setMaxGuests(n)} />
                ))}
              </View>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{maxGuests === 0 ? "Invited people only." : `Each answer can include up to ${maxGuests} family members or guests.`}</Text>
            </View>
            <ToggleRow title="Reply Deadline" value={deadlineOn} onChange={setDeadlineOn} />
            {deadlineOn && <DateField label="Reply Deadline" value={deadline} onChange={setDeadline} />}
            <ToggleRow title="Limit Places" detail="Nobody can confirm beyond the limit." value={capacityOn} onChange={setCapacityOn} />
            {capacityOn && (
              <>
                <Input value={capacity} onChange={(t) => setCapacity(t.replace(/[^0-9]/g, ""))} placeholder="100" max={6} label="Maximum attendees" keyboard="number-pad" />
                <ToggleRow title="Waiting List" detail="When full, people can join a waiting list and are confirmed in order as places free up." value={waitingList} onChange={setWaitingList} />
              </>
            )}
            <ToggleRow title="Paid Event" detail="Ovalball does not take event payments; say how people pay." value={paid} onChange={setPaid} />
            {paid && <Input value={priceNote} onChange={setPriceNote} placeholder="£10 adults, £5 children, paid at the bar" max={200} label="Price" />}
          </SectionCard>

          <SectionCard title="Cover Picture">
            {coverPath ? (
              <View style={{ height: 120, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>Your own picture is set.</Text>
              </View>
            ) : (
              <Image
                source={coverPhotoSource("EVENT", coverKey ? { kind: "stock", key: coverKey } : { kind: "none" }, event?.id ?? null, { eventType, startsOn })}
                accessible
                accessibilityLabel={coverKey ? `Cover picture: ${chosenStockLabel(coverKey) ?? "chosen from the Ovalball library"}` : "Cover picture: picked to suit the event type"}
                style={{ width: "100%", height: 120, borderRadius: radius.md }}
                contentFit="cover"
              />
            )}
            <Text style={[type.caption, { color: colour.inkMuted }]}>{coverPath ? MEDIA_PROVENANCE_WORDS.UPLOADED : coverKey ? MEDIA_PROVENANCE_WORDS.STOCK : "None chosen: one is picked to suit the event type."}</Text>
            <Button label={uploading ? "Uploading…" : "Change Picture"} variant="secondary" busy={uploading} onPress={() => setPickerOpen(true)} />
            {!event && <Text style={[type.caption, { color: colour.inkMuted }]}>You can upload a photo of your own once the event is created.</Text>}
            <MediaPickerSheet
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              domain="EVENT"
              title="Cover Picture"
              intro="Choose a picture from the Ovalball library, or upload one of your own."
              allowUpload={!!event}
              uploadAspect={[16, 9]}
              showReset={!!(coverKey || coverPath)}
              selectedKey={coverKey}
              onChoose={(choice) => void chooseCover(choice)}
            />
          </SectionCard>

          {!!problem && <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>{problem}</Text>}
          <Button label={event ? "Save Changes" : "Create Event"} busy={saving} disabled={!valid} onPress={() => void save()} />
          {!event && <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>The event is a draft until you send the invitations.</Text>}
        </ScrollView>

        <ChoiceSheet visible={picker === "type"} title="Event Type" options={EVENT_TYPES.map((t) => ({ id: t.value, name: t.label, detail: t.hint }))} value={eventType} emptyMessage="" onClose={() => setPicker(null)} saving={false} problem={null} onSave={(v) => { if (v) setEventType(v as EventType); setPicker(null) }} />
        <ChoiceSheet visible={picker === "venue"} title="Venue" hint="The club's own venues." options={venues.map((v) => ({ id: v.id, name: v.name, detail: v.detail }))} value={venueId} emptyMessage="The club has no venues recorded. Add them in Venues, or use an external address." onClose={() => setPicker(null)} saving={false} problem={null} onSave={(v) => { if (v) { setVenueId(v); setPitchIds((ids) => ids.filter((id) => pitches.find((p) => p.id === id)?.venueId === v)) } setPicker(null) }} />
        <ChoiceSheet visible={picker === "host"} title="Hosted By" hint="Not set means the club hosts it." options={teams.map((t) => ({ id: t.id, name: t.name }))} value={hostTeamId ?? ""} emptyMessage="No teams." onClose={() => setPicker(null)} saving={false} problem={null} onSave={(v) => { setHostTeamId(v || null); setPicker(null) }} />
      </View>
    </Modal>
  )
}

function Trigger({ label, sub, icon, onPress }: { label: string; sub?: string | null; icon?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Change`} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}>
      {icon && <MapPin size={17} color={colour.forest800} />}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: colour.ink }]} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>{sub}</Text>}
      </View>
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

function Input({ value, onChange, placeholder, max, label, keyboard, caps }: { value: string; onChange: (v: string) => void; placeholder: string; max: number; label: string; keyboard?: "number-pad"; caps?: "none" | "characters" }) {
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colour.inkSubtle}
      maxLength={max}
      keyboardType={keyboard ?? "default"}
      autoCapitalize={caps ?? "sentences"}
      style={[type.body, { minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
    />
  )
}
