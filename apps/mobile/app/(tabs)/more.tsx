import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { useSession } from "../../src/auth/session"
import { useAppContexts } from "../../src/context/contexts"
import { leaveSession } from "../../src/auth/leave"
import { environment, webUrl } from "../../src/config/environment"
import { isSecure, sessionStorageDescription } from "../../src/auth/session-store"
import { AppHeader } from "../../src/components/app-header"
import { ContextSheet } from "../../src/components/context-sheet"
import { PersonAvatar } from "../../src/components/identity"
import { ArrowRightLeft, CalendarDays, ChevronRight, ClipboardList, ExternalLink, KeyRound, Landmark, Lock, Shield, Receipt, Settings2, Users, Megaphone, UserRound, HeartHandshake, IdCard, MapPin, Newspaper } from "../../src/components/icons"
import { isFamilyFacingContext } from "@ovalball/contracts"
import { useAdminCentreAccess } from "../../src/admin/access"
import { useVenueAllocationAccess } from "../../src/pitch-allocation/access"
import { useSafeguardingOfficerAccess } from "../../src/safeguarding/access"
import { useTeamAuthority } from "../../src/team/authority"
import { anyTeamAdministration } from "@ovalball/contracts/team/authority"
import { Button, Card } from "../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * MORE — organised around jobs, not around what would not fit.
 *
 * THE FAILURE MODE IS A DUMPING GROUND, and it is avoided by grouping: who you are, the jobs that are
 * not in the bar yet, and leaving. Each row says what the job IS rather than which screen it opens, so
 * the list stays readable as things move out of it into the bar over the next milestones.
 *
 * SUBSCRIPTIONS IS HERE FOR EVERYONE IT IS RELEVANT TO. It takes the bottom bar's fifth cell only for
 * somebody the server says may see a team's subscription state; everybody else reaches the same
 * destination from here. A tab is a shortcut, never the only way in.
 */
export default function More() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { signOut, email } = useSession()
  const { person, active, canSeeTeamSubscriptions } = useAppContexts()
  const [sheetOpen, setSheetOpen] = useState(false)
  // THE ADMIN CENTRE ROW IS THE SERVER'S TO GIVE. It appears in a club context only, and only when
  // `my_capabilities` says this person holds at least one administrative capability at that club --
  // never because the context is labelled Club Admin. Re-asked on every context change and focus.
  const admin = useAdminCentreAccess()
  const venueCaps = useVenueAllocationAccess()
  const officer = useSafeguardingOfficerAccess().isOfficer
  // THE TEAM'S OWN JOBS, for a team context (CA-M7). Which rows appear is the server's answer at team
  // scope; the rows themselves are the recurring work the bar does not hold.
  const team = useTeamAuthority()
  const inTeam = active?.kind === "team"
  // A FAMILY AND A PLAYER GET THEIR OWN ROWS (CA-M9): Children & Family for a guardian, and the family's
  // memberships; a player gets their own memberships. Neither is offered a staff or club control from
  // here -- those belong to the team and club contexts.
  const inFamily = active !== null && isFamilyFacingContext(active.kind)
  const inClub = active?.kind === "club"
  const isGuardian = active?.kind === "parent" || active?.kind === "family"

  async function leave() {
    // ONE LIST, KEPT IN `src/auth/leave.ts`: the context, the child, drafts, caches, pending intents and a
    // held invitation all go before the session does. The next person on this handset starts clean.
    await leaveSession(signOut)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <PersonAvatar name={person.firstName} url={person.avatarUrl} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]} numberOfLines={1}>
                {person.firstName ?? "Your account"}
              </Text>
              <Text style={[type.small, { color: colour.inkMuted }]} numberOfLines={1}>
                {email ?? ""}
              </Text>
            </View>
          </View>
        </Card>

        {/*
          WHAT HAS NO OTHER HOME. More is the overflow, so a destination that has
          earned a permanent place elsewhere does not also sit here.

          RUGBY HUB LEFT THIS LIST at P1, because it took the bar's fourth cell
          back when Messages moved into the global header. NOTIFICATIONS LEFT IT
          TOO: the bell is now in that header on every screen, and it opens a
          native screen rather than the website. Neither route changed; both are
          simply reachable from somewhere better, and listing them twice would
          make one destination look like two.
        */}
        {inTeam && (
          <Group title={active?.label ?? "Your Team"}>
            <Row icon={<ClipboardList size={19} color={colour.forest800} strokeWidth={1.9} />} label="Availability" caption="Who has answered, who has not" onPress={() => router.push("/team/availability" as never)} />
            <Row icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />} label="People" caption="Players, parents and the staff who run the side" onPress={() => router.push("/team/people" as never)} />
            {(team.authority.requestRespond || team.authority.requestCreate) && (
              <Row icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />} label="Fixture Requests" caption="Other clubs asking, and what you have asked" onPress={() => router.push("/team/requests" as never)} />
            )}
            {canSeeTeamSubscriptions && <Row icon={<Receipt size={19} color={colour.forest800} strokeWidth={1.9} />} label="Subscriptions" caption="Who in your squad is set up to pay" onPress={() => router.push("/subscriptions")} />}
            {anyTeamAdministration(team.authority) && (
              <Row icon={<Settings2 size={19} color={colour.forest800} strokeWidth={1.9} />} label="Team Settings" caption="Requests, codes, staff and publishing" onPress={() => router.push("/team/settings" as never)} />
            )}
          </Group>
        )}

        {inFamily && (
          <Group title={isGuardian ? "Your Family" : "Your Rugby"}>
            {isGuardian && (
              <Row
                icon={<HeartHandshake size={19} color={colour.forest800} strokeWidth={1.9} />}
                label="Children & Family"
                caption="Who you look after, their sides and what they may do themselves"
                onPress={() => router.push("/family" as never)}
              />
            )}
            <Row
              icon={<Receipt size={19} color={colour.forest800} strokeWidth={1.9} />}
              label="Subscriptions & Payments"
              caption={isGuardian ? "What each child's membership costs and where it stands" : "Your membership and where it stands"}
              onPress={() => router.push("/subscriptions")}
            />
            <Row
              icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />}
              label="News & Announcements"
              caption="What the club has published"
              onPress={() => router.push("/news")}
            />
          </Group>
        )}
        {/* THE CLUB'S JOBS (CA-M10): what a person away from a desk needs of the club, each row the
            server's to give -- the Admin Centre stays the place for configuration. */}
        {inClub && (
          <Group title={active?.label ?? "Your Club"}>
            <Row icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />} label="Teams" caption="Every side, what it has next and who is in it" onPress={() => router.push("/club/teams" as never)} />
            {admin.sections.some((s) => s.key === "people") && <Row icon={<IdCard size={19} color={colour.forest800} strokeWidth={1.9} />} label="People" caption="Members, staff, and who is waiting to join" onPress={() => router.push("/admin/people")} />}
            <Row icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />} label="Fixture Requests" caption="What other clubs have asked, and what we have asked" onPress={() => router.push("/club/requests" as never)} />
            {admin.sections.some((s) => s.key === "venues") && <Row icon={<MapPin size={19} color={colour.forest800} strokeWidth={1.9} />} label="Grounds & Pitches" caption="Where the club plays" onPress={() => router.push("/admin/venues" as never)} />}
            <Row icon={<Newspaper size={19} color={colour.forest800} strokeWidth={1.9} />} label="News & Announcements" caption="What the club has published" onPress={() => router.push("/news")} />
            {admin.sections.some((s) => s.key === "news") && <Row icon={<ClipboardList size={19} color={colour.forest800} strokeWidth={1.9} />} label="Publish" caption="Write and manage news and announcements" onPress={() => router.push("/admin/news" as never)} />}
            {/* THE CLUB'S JOBS THAT WERE MISSING FROM THE PHONE (CA-M11.1). Each row is the server's to
                give: the Admin Centre's own capability probe decides Guardians & Players, Subscriptions &
                Payments, Season Handover, Roles & Permissions and the safeguarding nomination; the
                board's own two keys decide Pitch Allocation. Nothing here is inferred from a role. */}
            {admin.sections.some((s) => s.key === "guardians") && <Row icon={<HeartHandshake size={19} color={colour.forest800} strokeWidth={1.9} />} label="Guardians & Players" caption="Players, who looks after them, and who is asking to join" onPress={() => router.push("/admin/guardians" as never)} />}
            {admin.sections.some((s) => s.key === "subscriptions") && <Row icon={<Receipt size={19} color={colour.forest800} strokeWidth={1.9} />} label="Subscriptions & Payments" caption="What members pay, and where every payment stands" onPress={() => router.push("/admin/subscriptions" as never)} />}
            {admin.sections.some((s) => s.key === "rollover") && <Row icon={<ArrowRightLeft size={19} color={colour.forest800} strokeWidth={1.9} />} label="Season Handover" caption="Moving every side and player up at the end of the season" onPress={() => router.push("/admin/rollover" as never)} />}
            {(venueCaps.allocate || venueCaps.viewAllocation) && <Row icon={<CalendarDays size={19} color={colour.forest800} strokeWidth={1.9} />} label="Pitch Allocation" caption="Which side is on which pitch, day by day" onPress={() => router.push("/admin/pitch-allocation" as never)} />}
            {admin.sections.some((s) => s.key === "permissions") && <Row icon={<KeyRound size={19} color={colour.forest800} strokeWidth={1.9} />} label="Roles & Permissions" caption="Who may do what, and where" onPress={() => router.push("/admin/permissions" as never)} />}
            {(admin.sections.some((s) => s.key === "safeguarding") || officer) && <Row icon={<Shield size={19} color={colour.forest800} strokeWidth={1.9} />} label="Safeguarding" caption={officer ? "Your safeguarding work at this club" : "The club's safeguarding contact"} onPress={() => router.push("/admin/safeguarding" as never)} />}
          </Group>
        )}
        {!inFamily && !inClub && (
          <Group title="Your Rugby">
            <Row
              icon={<Megaphone size={19} color={colour.forest800} strokeWidth={1.9} />}
              label="News & Announcements"
              caption="What the club has published"
              onPress={() => router.push("/news")}
            />
            {!inTeam && (
              <Row
                icon={<Receipt size={19} color={colour.forest800} strokeWidth={1.9} />}
                label="Subscriptions"
                caption="Subscription and payment state, where you are authorised"
                onPress={() => router.push("/subscriptions")}
              />
            )}
            {!inTeam && (
              <Row
                icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />}
                label="People"
                caption="Players, parents and the staff who run the side — on the web for now"
                onPress={() => (admin.sections.some((s) => s.key === "people") ? router.push("/admin/people") : void Linking.openURL(`${webUrl}/people`))}
                external
              />
            )}
          </Group>
        )}

        {admin.clubId && admin.sections.length > 0 && (
          <Group title="Club Admin">
            <Row
              icon={<Landmark size={20} color={colour.forest800} strokeWidth={1.9} />}
              label="Admin Centre"
              caption="Running the club: profile, contacts and more"
              onPress={() => router.push("/admin")}
            />
          </Group>
        )}

        <Group title="Your Account">
          <Row
            icon={<UserRound size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Profile"
            caption="Your name, your picture and your phone number"
            onPress={() => router.push("/profile" as never)}
          />
          <Row
            icon={<Lock size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Security"
            caption="Password, authenticator and your signed-in devices"
            onPress={() => router.push("/security" as never)}
          />
          <Row
            icon={<Users size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Switch Context"
            caption="Move between your clubs, teams and children"
            onPress={() => setSheetOpen(true)}
          />
        </Group>

        <View>
          <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>THIS BUILD</Text>
          <Card>
            <Detail label="Environment" value={environment} />
            <Detail label="Session stored in" value={sessionStorageDescription} />
            <Detail label="Secure storage" value={isSecure ? "Yes" : "No — this platform has none"} />
          </Card>
        </View>

        <Button label="Sign Out" variant="secondary" onPress={() => void leave()} />
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
        {children}
      </View>
    </View>
  )
}

function Row({
  icon,
  label,
  caption,
  onPress,
  external = false,
}: {
  icon: React.ReactNode
  label: string
  caption: string
  onPress: () => void
  external?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={external ? `${label}. ${caption}. Opens the Ovalball website` : `${label}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{caption}</Text>
      </View>
      {external ? <ExternalLink size={15} color={colour.inkSubtle} /> : <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 4 }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.small, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  )
}
