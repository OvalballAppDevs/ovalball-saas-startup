import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { readArenaDay, saveArenaSettings, type ArenaPitch, type ArenaPolicy, type ArenaVenue } from "@ovalball/contracts/arena"
import { setVenueCover, uploadVenueCoverPhoto } from "@ovalball/contracts/venue-media"

import { useAdminCentreAccess } from "../admin/access"
import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, Card, CardSkeleton, ErrorState } from "../components/ui"
import { Camera, ChevronRight } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"
import { friendly, friendlyAction, logDetail } from "../errors/translate"
import { IllustrativeTag, MediaPickerSheet, type MediaChoice } from "../media/media-picker"
import { todayIso } from "../pitch-allocation/model"
import { applyCoverWrite } from "../venue/photo-picker"
import type { CoverWrite } from "../venue/create-venue-logic"
import { useArenaHeroPhoto, type ArenaHeroPhoto } from "./hero-photo"
import { HERO_MINIMUM, heroDescription, primaryVenue } from "./hero-photo-choice"

/**
 * ARENA SETTINGS -- the club's own time rules and preferences, in one place.
 *
 * Changing rooms have their own times, separate from the pitch's warm-up and clearing: when a team gets
 * its room before kick-off, how long it keeps it after the final whistle, and how long the room takes to
 * turn round. Ovalball configuration, not a governing-body rule; a club that has not set its own uses
 * Ovalball's defaults, and is told so.
 */
export function ArenaSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const [policy, setPolicy] = useState<ArenaPolicy | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [access, setAccess] = useState(60)
  const [release, setRelease] = useState(30)
  const [turnaround, setTurnaround] = useState(15)
  const [problem, setProblem] = useState<string | null>(null)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  // The venues and pitches the Arena picture is chosen from -- the same projection the banner reads.
  const [estate, setEstate] = useState<{ venues: ArenaVenue[]; pitches: ArenaPitch[] } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoProblem, setPhotoProblem] = useState<string | null>(null)
  const heroPhoto = useArenaHeroPhoto(estate)
  const primary = estate ? primaryVenue(estate.venues) : null

  const load = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const day = await readArenaDay(supabase, clubId, todayIso())
      setEstate({ venues: day.venues, pitches: day.pitches })
      setPolicy(day.policy)
      setCanManage(day.canManage)
      setAccess(day.policy.roomAccess)
      setRelease(day.policy.roomRelease)
      setTurnaround(day.policy.roomTurnaround)
    } catch (cause) {
      const failure = friendly(cause, "the Arena settings")
      logDetail("arena settings", failure)
      setProblem(failure.message)
    }
  }, [clubId])

  useEffect(() => { void load() }, [load])

  const dirty = policy !== null && (access !== policy.roomAccess || release !== policy.roomRelease || turnaround !== policy.roomTurnaround)

  /**
   * THE ARENA PICTURE IS THE PRIMARY VENUE'S PICTURE: a choice here is written straight to that venue's own cover
   * through the venue's own governed upload and `set_venue_cover` (`applyCoverWrite`, exactly as the venue's edit
   * screen saves it), so the venue and every surface that shows the ground change with it.
   */
  async function choosePhoto(choice: MediaChoice) {
    if (!clubId || !primary) return
    setPhotoBusy(true)
    setPhotoProblem(null)
    const write: CoverWrite =
      choice === null ? { kind: "clear" } : choice.kind === "stock" ? { kind: "stock", key: choice.key } : { kind: "upload", localUri: choice.uri, mimeType: choice.mimeType }
    const failed = await applyCoverWrite(write, {
      set: (selection) => setVenueCover(supabase, primary.id, selection),
      upload: (bytes, mimeType) => uploadVenueCoverPhoto(supabase, clubId, primary.id, bytes, mimeType),
    })
    setPhotoBusy(false)
    if (failed) {
      setPhotoProblem(failed)
      return
    }
    await load()
  }

  async function save() {
    if (!clubId) return
    setBusy(true)
    setSaveProblem(null)
    setSaved(null)
    try {
      const result = await saveArenaSettings(supabase, clubId, { roomAccessMinutes: access, roomReleaseMinutes: release, roomTurnaroundMinutes: turnaround })
      setPolicy((p) => (p ? { ...p, roomAccess: result.roomAccess, roomRelease: result.roomRelease, roomTurnaround: result.roomTurnaround, roomSource: result.roomSource } : p))
      setSaved("Saved.")
    } catch (cause) {
      const failure = friendlyAction(cause, "save", "the room times")
      logDetail("arena settings save", failure)
      setSaveProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: surface.page }}>
      <OvalballDetailHeader title="Arena Settings" onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/arena" as never))} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}>
        {problem && <ErrorState message={problem} onRetry={() => void load()} />}
        {!problem && !policy && <CardSkeleton lines={4} />}
        {policy && (
          <>
            <ArenaPhotograph
              photo={heroPhoto}
              venue={primary}
              canManage={canManage}
              busy={photoBusy}
              problem={photoProblem}
              onChoose={(choice) => void choosePhoto(choice)}
            />
            <LinkRow
              title="Team Preferences"
              body="The venue, pitches and changing rooms each team likes to use, for automatic allocation."
              onPress={() => router.push("/admin/arena/preferences" as never)}
            />
            <LinkRow
              title="Pitch Times"
              body={`Warm-up ${policy.warmUp} min before kick-off, clear by ${policy.packUp} min after the final whistle${policy.bufferSource === "platform" ? " (Ovalball's defaults)" : ""}.`}
              onPress={() => router.push("/admin/pitch-allocation/settings" as never)}
            />
            <Card style={{ gap: space.md }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Changing Room Times</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                {policy.roomSource === "club" ? "These are the club's own numbers." : "The club has not set its own numbers, so these are Ovalball's defaults."} A changing room is planned for the whole time a team needs it, and for the time it takes to get ready for the next team.
              </Text>
              <Stepper label="Room before kick-off" value={access} min={0} max={120} onChange={setAccess} disabled={!canManage} />
              <Stepper label="Room after the final whistle" value={release} min={0} max={120} onChange={setRelease} disabled={!canManage} />
              <Stepper label="Turnaround between teams" value={turnaround} min={0} max={60} onChange={setTurnaround} disabled={!canManage} />
              <Text style={[type.caption, { color: colour.inkMuted }]}>The home side gets its room from its meet time when that is earlier.</Text>
            </Card>
            {saveProblem && <Text style={[type.caption, { color: colour.danger }]}>{saveProblem}</Text>}
            {canManage && <Button label="Save Room Times" onPress={() => void save()} busy={busy} disabled={!dirty} />}
            {!canManage && <Text style={[type.caption, { color: colour.inkMuted }]}>Changing these is not part of your job here; they are shown as they are.</Text>}
            {!!saved && <Text accessibilityLiveRegion="polite" style={[type.caption, { color: colour.forest800 }]}>{saved}</Text>}
          </>
        )}
      </ScrollView>
    </View>
  )
}

/**
 * THE ARENA PHOTOGRAPH -- the picture Arena Home opens on, which is the primary venue's own picture. The current
 * photograph is the control (the rule a tournament's photo, a profile picture and a club crest already follow):
 * tapping it opens the one media picker -- the Ovalball library, an upload of the club's own, or back to the
 * default. Ovalball's pictures are marked Illustrative here exactly as they are on the banner. For somebody
 * without the authority to change it, it is a plain picture.
 */
function ArenaPhotograph({ photo, venue, canManage, busy, problem, onChoose }: {
  photo: ArenaHeroPhoto | null
  venue: ArenaVenue | null
  canManage: boolean
  busy: boolean
  problem: string | null
  onChoose: (choice: MediaChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const editable = canManage && !!venue
  const showing = photo ? heroDescription(photo.candidate) : null
  const state = !photo
    ? null
    : photo.candidate.origin === "VENUE_PHOTO"
      ? "It is showing your own photograph."
      : photo.candidate.origin === "PITCH_PHOTO"
        ? `The venue has no picture of its own yet, so it is showing your photograph of ${photo.candidate.pitchName}.`
        : photo.candidate.origin === "VENUE_LIBRARY"
          ? "It is showing the Ovalball library picture chosen for the venue, marked Illustrative. A photograph of your own ground replaces it."
          : "Until there is a photograph of your own ground, Arena shows Ovalball's picture, marked Illustrative."
  // The club's own pictures that could not be used, said plainly, so a photo that "did not work" is explained.
  const passedOver = (photo?.passedOver ?? []).filter((p) => p.candidate.origin !== "ARENA_LIBRARY")
  return (
    <Card style={{ gap: space.md }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>Arena Photograph</Text>
      <Pressable
        accessibilityRole={editable ? "button" : "image"}
        accessibilityLabel={`${showing ?? "The Arena photograph"}.${editable ? " Change photo" : ""}`}
        onPress={() => setOpen(true)}
        disabled={!editable || busy}
        style={({ pressed }) => ({ height: 180, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colour.forest950, opacity: pressed ? 0.92 : 1 })}
      >
        {photo && <Image source={photo.source} accessible={false} contentFit="cover" contentPosition={photo.contentPosition} transition={150} style={{ width: "100%", height: "100%" }} />}
        {photo?.illustrative && <IllustrativeTag placement="top" />}
        {/* The affordance sits ON the picture, because the picture is the button. */}
        {editable && (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingVertical: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: "rgba(7,28,20,0.62)" }}>
            <Camera size={15} color={colour.onForest} strokeWidth={2} />
            <Text style={[type.caption, { flex: 1, color: colour.onForest, fontFamily: type.heading.fontFamily }]}>Change Photo</Text>
          </View>
        )}
        {busy && (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,28,20,0.45)" }}>
            <ActivityIndicator color={colour.onForest} />
          </View>
        )}
      </Pressable>
      <Text style={[type.small, { color: colour.inkMuted }]}>
        {venue
          ? `Arena opens on the photograph of your primary venue, ${venue.name}. It is the same picture the venue shows. ${state ?? ""}`
          : "Arena opens on a photograph of your primary venue. Until the club has a venue, it shows Ovalball's picture, marked Illustrative."}
      </Text>
      {passedOver.map((p, i) => (
        <Text key={i} style={[type.caption, { color: colour.warning }]}>
          {p.reason === "could not be loaded"
            ? `${heroDescription(p.candidate)} could not be loaded, so Arena is not using it.`
            : `${heroDescription(p.candidate)} is ${p.reason === "too small" ? "too small" : "not landscape"} for the banner, so Arena is not using it. A photograph at least ${HERO_MINIMUM.width.toLocaleString("en-GB")} pixels wide and wider than it is tall works best.`}
        </Text>
      ))}
      {!!problem && <Text style={[type.caption, { color: colour.danger }]}>{problem}</Text>}
      {!canManage && <Text style={[type.caption, { color: colour.inkMuted }]}>Changing the photograph is not part of your job here.</Text>}

      {/* THE ONE MEDIA PICKER, for a ground: the library's venue pictures, an upload cropped to the 4:3 the
          venue's own photo picker uses, or back to the default. */}
      <MediaPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        domain="VENUE"
        title="Arena Photograph"
        intro="Arena opens on your primary venue's photograph. A landscape photo of your own ground, at least 1,200 pixels wide, works best."
        uploadAspect={[4, 3]}
        showReset={!!(venue?.coverImagePath || venue?.coverStockKey)}
        selectedKey={venue?.coverStockKey ?? null}
        onChoose={(choice) => {
          setOpen(false)
          onChoose(choice)
        }}
      />
    </Card>
  )
}

function LinkRow({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.heading, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{body}</Text>
      </View>
      <ChevronRight size={18} color={colour.inkSubtle} />
    </Pressable>
  )
}

function Stepper({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled: boolean }) {
  const control = (glyph: string, delta: number, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onChange(Math.max(min, Math.min(max, value + delta)))} disabled={disabled || (delta < 0 ? value <= min : value >= max)}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={[type.heading, { color: colour.ink }]}>{glyph}</Text>
    </Pressable>
  )
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{label}</Text>
      {control("−", -5, `${label}: five minutes less`)}
      <Text accessibilityLiveRegion="polite" style={[type.bodyMedium, { color: colour.ink, minWidth: 64, textAlign: "center" }]}>{value} min</Text>
      {control("+", 5, `${label}: five minutes more`)}
    </View>
  )
}
