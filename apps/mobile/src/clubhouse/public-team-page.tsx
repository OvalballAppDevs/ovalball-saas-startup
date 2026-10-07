import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"

import { positionLabel, readPublicTeamProfile, type PublicTeamProfile } from "@ovalball/contracts/match-centre/public-profiles"
import { resolveTeamCover } from "@ovalball/contracts/team-cover"
import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"

import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { ExternalLink, MessageSquare, Phone, Users } from "../components/icons"
import { ClubCrest } from "../clubhouse/components"
import { friendly } from "../errors/translate"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"
import { SquadEditor } from "./squad-editor"
import { mediaIsIllustrative, teamCoverMedia, teamCoverSource } from "../media/stock-assets"
import { IllustrativeTag } from "../media/media-picker"

type Tab = "overview" | "staff" | "squad" | "media"

/**
 * THE PUBLIC TEAM PAGE -- what anybody may know about a team, reached from a team name in the Match
 * Centre (and wherever else a team is named to somebody outside it).
 *
 * A PROJECTION, NOT A SECOND TEAM RECORD. Everything here is `get_public_team_profile`'s answer about
 * the one canonical team, shaped by the club's defaults and the team's own overrides. What a setting
 * keeps private is never sent to this screen to be hidden.
 *
 * MESSAGE STAFF AND CALL are for the staff of a club this team is playing, and only as the team allows.
 * The server sends the contact block to them alone; a parent, a player, a member or a signed-out visitor
 * receives no contact field at all, so there is nothing here to hide. Message Staff opens the shared
 * match's staff conversation; Call dials the team's or club's operational number, never a coach's own.
 */
export function PublicTeamPage({ clubPath = "/clubhouse/club/[directoryId]" }: { clubPath?: string }) {
  const { teamId } = useLocalSearchParams<{ teamId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [profile, setProfile] = useState<PublicTeamProfile | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading")
  const [problem, setProblem] = useState<string | null>(null)
  const [media, setMedia] = useState<{ id: string; url: string; caption: string | null }[]>([])
  const [tab, setTab] = useState<Tab>("overview")
  const [editingSquad, setEditingSquad] = useState(false)

  const load = useCallback(async () => {
    if (!teamId) return
    setState((s) => (s === "ready" ? s : "loading"))
    try {
      const found = await readPublicTeamProfile(supabase, String(teamId))
      setProfile(found)
      setState(found ? "ready" : "missing")
      const paths = (found?.media ?? []).map((m) => m.path)
      if (paths.length > 0) {
        const { data } = await supabase.storage.from("team-gallery-media").createSignedUrls(paths, 3600)
        const byPath = new Map((data ?? []).filter((r) => r.signedUrl && !r.error).map((r) => [r.path, r.signedUrl]))
        setMedia((found?.media ?? []).flatMap((m) => (byPath.get(m.path) ? [{ id: m.id, url: byPath.get(m.path)!, caption: m.caption }] : [])))
      } else {
        setMedia([])
      }
    } catch (caught) {
      setProblem(friendly(caught, "this team").message)
      setState("error")
    }
  }, [teamId])

  useEffect(() => {
    void load()
  }, [load])

  // BACK GOES WHERE THE PERSON CAME FROM. Opened from a Match Centre, this page sits in that tab's own
  // stack (see the route files), so there is a screen beneath to pop to; reached any other way, it
  // falls back to the Clubhouse rather than to whichever tab the router remembers.
  const navigation = useNavigation()
  const back = () => {
    const navState = navigation.getState()
    if (navState && navState.index > 0) router.back()
    else router.replace("/clubhouse")
  }

  const tabs: { key: Tab; label: string }[] = profile
    ? [
        { key: "overview", label: "Overview" },
        ...(profile.staffShown ? [{ key: "staff" as const, label: "Staff" }] : []),
        ...(profile.squadShared || profile.canEditSquad ? [{ key: "squad" as const, label: "Squad" }] : []),
        ...(profile.mediaShared ? [{ key: "media" as const, label: "Media" }] : []),
      ]
    : []

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Team" onBack={back} />
      {state === "loading" && (
        <View style={{ padding: space.lg, gap: space.md }}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      )}
      {state === "error" && (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem ?? "This team couldn't be loaded. Try again in a moment."} onRetry={() => void load()} />
        </View>
      )}
      {state === "missing" && (
        <View style={{ padding: space.xl, gap: space.sm }}>
          <Text style={[type.heading, { color: colour.ink }]}>Team Unavailable</Text>
          <Text style={[type.body, { color: colour.inkMuted }]}>This team's page isn't public, or the team is no longer active.</Text>
        </View>
      )}
      {state === "ready" && profile && (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }} stickyHeaderIndices={[1]}>
          <Cover profile={profile} />

          <View style={{ backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
            <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingHorizontal: space.sm }}>
              {tabs.map((t) => {
                const selected = t.key === tab
                return (
                  <Pressable
                    key={t.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setTab(t.key)}
                    style={{ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: selected ? colour.forest800 : "transparent" }}
                  >
                    <Text style={[type.smallMedium, { color: selected ? colour.forest800 : colour.inkMuted }]}>{t.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View style={{ padding: space.lg, gap: space.lg }}>
            {!!profile.contact && <ContactBar contact={profile.contact} onMessage={(fixtureId) => router.push({ pathname: "/messages/[kind]/[id]", params: { kind: "fixture", id: fixtureId } } as never)} />}

            {profile.viewerIsMember && tab === "overview" && (
              <Button label="Open Team" variant="secondary" onPress={() => router.push({ pathname: "/teams/[teamId]", params: { teamId: profile.teamId } } as never)} />
            )}

            {tab === "overview" && (
              <>
                {!!profile.description && (
                  <Section title="About">
                    <Text style={[type.body, { color: colour.ink }]}>{profile.description}</Text>
                  </Section>
                )}
                {profile.staffShown && (
                  <Section title="Coaches & Staff">
                    <StaffList staff={profile.staff.slice(0, 3)} />
                    {profile.staff.length > 3 && (
                      <Pressable accessibilityRole="button" onPress={() => setTab("staff")} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
                        <Text style={[type.smallMedium, { color: colour.forest800 }]}>See All {profile.staff.length}</Text>
                      </Pressable>
                    )}
                  </Section>
                )}
                <Section title="Team Information">
                  <InfoRow label="Team" value={profile.name} />
                  <InfoRow label="Club" value={profile.club.name} onPress={() => router.push({ pathname: clubPath, params: { directoryId: profile.club.directoryId } } as never)} />
                  {!!profile.club.homeGround && <InfoRow label="Home Ground" value={profile.club.homeGround} />}
                  {!!profile.club.website && <InfoRow label="Website" value={profile.club.website.replace(/^https?:\/\//, "")} link onPress={() => void Linking.openURL(withScheme(profile.club.website!))} />}
                </Section>
              </>
            )}

            {tab === "staff" && (
              <Section title="Coaches & Staff">
                <StaffList staff={profile.staff} />
              </Section>
            )}

            {tab === "squad" && (
              <Section title="Squad">
                {profile.canEditSquad && <Button label="Edit Numbers & Positions" variant="secondary" onPress={() => setEditingSquad(true)} />}
                {!profile.squadShared ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>This squad is not on the public page. Numbers and positions you set appear here once the club shares the squad.</Text>
                ) : (profile.squad ?? []).length === 0 ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>No players are listed yet.</Text>
                ) : (
                  (profile.squad ?? []).map((p) => (
                    <View key={p.playerId} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET }}>
                      <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: p.shirtNumber !== null ? colour.forest800 : colour.chalk, alignItems: "center", justifyContent: "center" }}>
                        <Text style={[type.smallMedium, { color: p.shirtNumber !== null ? colour.onForest : colour.inkSubtle, fontVariant: ["tabular-nums"] }]}>{p.shirtNumber ?? "–"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.smallMedium, { color: colour.ink }]}>{p.name}</Text>
                        {!!positionLabel(p.positionKey) && <Text style={[type.caption, { color: colour.inkMuted }]}>{positionLabel(p.positionKey)}</Text>}
                      </View>
                    </View>
                  ))
                )}
              </Section>
            )}

            {tab === "media" && (
              <Section title="Media">
                {media.length === 0 ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>No photos have been shared yet.</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                    {media.map((m) => (
                      // The tile carries the size; an image sized by percentage alone collapses to nothing.
                      <View key={m.id} style={{ width: "32%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colour.chalk }}>
                        <Image source={{ uri: m.url }} style={{ width: "100%", height: "100%" }} contentFit="cover" accessibilityLabel={m.caption ?? "Team photo"} />
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            )}
          </View>
        </ScrollView>
      )}
      {editingSquad && profile && <SquadEditor teamId={profile.teamId} onClose={() => setEditingSquad(false)} onSaved={() => void load()} />}
    </View>
  )
}

function ContactBar({ contact, onMessage }: { contact: NonNullable<PublicTeamProfile["contact"]>; onMessage: (fixtureId: string) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {contact.canMessage && !!contact.fixtureId && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Message staff about your match"
            onPress={() => onMessage(contact.fixtureId!)}
            style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, backgroundColor: colour.forest800, opacity: pressed ? 0.85 : 1 })}
          >
            <MessageSquare size={18} color={colour.onForest} />
            <Text style={[type.smallMedium, { color: colour.onForest }]}>Message Staff</Text>
          </Pressable>
        )}
        {contact.canCall && !!contact.phone && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${contact.phoneLabel ?? "the club"}, ${contact.phone}`}
            onPress={() => void Linking.openURL(`tel:${contact.phone!.replace(/[^\d+]/g, "")}`)}
            style={({ pressed }) => ({ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colour.forest800, backgroundColor: colour.surface, opacity: pressed ? 0.85 : 1 })}
          >
            <Phone size={18} color={colour.forest800} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>{`Call ${shortLabel(contact.phoneLabel ?? "")}`}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Only shown to staff of a club playing this team.</Text>
    </View>
  )
}

function StaffList({ staff }: { staff: PublicTeamProfile["staff"] }) {
  if (staff.length === 0) return <Text style={[type.small, { color: colour.inkMuted }]}>No coaches or staff are listed yet.</Text>
  return (
    <>
      {staff.map((person, index) => (
        <View key={`${person.name}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colour.forest800, alignItems: "center", justifyContent: "center" }}>
            <Text style={[type.smallMedium, { color: colour.onForest }]}>{initials(person.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{person.name ?? "Name not recorded"}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{person.role}</Text>
          </View>
        </View>
      ))}
    </>
  )
}

function InfoRow({ label, value, onPress, link }: { label: string; value: string; onPress?: () => void; link?: boolean }) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 36, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.xs }}>
      <Text style={[type.small, { color: colour.inkMuted, width: 110 }]}>{label}</Text>
      <Text style={[type.small, { color: link || onPress ? colour.forest800 : colour.ink, flex: 1 }]} numberOfLines={2}>{value}</Text>
      {link && <ExternalLink size={15} color={colour.forest800} />}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole={link ? "link" : "button"} accessibilityLabel={`${label}: ${value}`} onPress={onPress}>
      {body}
    </Pressable>
  )
}

const COVER_HEIGHT = 230
const CREST = 76

function Cover({ profile }: { profile: PublicTeamProfile }) {
  const crestUrl = clubLogoUrlFromPath(supabase, profile.club.logoPath)
  const cover = resolveTeamCover({ supabase, coverImagePath: profile.coverImagePath, coverStockKey: profile.coverStockKey, crestUrl: null })
  const team = { category: profile.category ?? "", ageGroup: profile.ageGroup, gender: null, active: true }
  const source = teamCoverSource(cover, team)
  // A library picture under a real club's crest must not read as that team's own photograph.
  const illustrative = mediaIsIllustrative("TEAM", teamCoverMedia(cover, team))
  return (
    <View style={{ height: COVER_HEIGHT, backgroundColor: colour.forest900 }}>
      <Image source={source} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" accessible={false} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "70%", backgroundColor: colour.forest900, opacity: 0.6 }} />
      <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.lg, alignItems: "center", gap: space.xs }}>
        <View style={{ width: CREST, height: CREST, borderRadius: radius.lg, backgroundColor: colour.surface, alignItems: "center", justifyContent: "center", ...elevation.card }}>
          {crestUrl ? <ClubCrest url={crestUrl} size={CREST - 14} /> : <Users size={28} color={colour.forest800} />}
        </View>
        <Text accessibilityRole="header" numberOfLines={2} style={{ fontFamily: type.title.fontFamily, fontSize: 24, lineHeight: 28, color: colour.onForest, textAlign: "center" }}>
          {profile.club.name}
        </Text>
        <Text numberOfLines={1} style={[type.body, { color: colour.onForest }]}>{profile.name}</Text>
      </View>
      {illustrative && <IllustrativeTag placement="top" />}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>{title}</Text>
      {children}
    </View>
  )
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  return parts.length === 0 ? "?" : `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase()
}

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** The contact's role on the button -- "Call Secretary" -- or the plain "Call Club" / "Call Team". */
function shortLabel(label: string): string {
  const trimmed = label.replace(/\s*(phone|number|line)$/i, "").trim()
  if (/^team contact$/i.test(trimmed)) return "Team"
  if (/^club contact$/i.test(trimmed) || trimmed.length === 0 || trimmed.length > 16) return "Club"
  return trimmed
}
