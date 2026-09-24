import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Linking from "expo-linking"

import { useSession } from "../../src/auth/session"
import { useAppContexts, forgetSelectedContext } from "../../src/context/contexts"
import { forgetHubCache } from "../../src/hub/cache"
import { forgetAttentionCache } from "../../src/attention/cache"
import { forgetHubTeamPreference } from "../../src/hub/identity"
import { forgetRecentSearches } from "../../src/hub/recent"
import { clearAllDrafts } from "../../src/messages/drafts"
import { environment, webUrl } from "../../src/config/environment"
import { isSecure, sessionStorageDescription } from "../../src/auth/session-store"
import { AppHeader } from "../../src/components/app-header"
import { ContextSheet } from "../../src/components/context-sheet"
import { PersonAvatar } from "../../src/components/identity"
import { ChevronRight, ClipboardList, ExternalLink, Landmark, Receipt, Settings2, Users, Megaphone } from "../../src/components/icons"
import { useAdminCentreAccess } from "../../src/admin/access"
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
  // THE TEAM'S OWN JOBS, for a team context (CA-M7). Which rows appear is the server's answer at team
  // scope; the rows themselves are the recurring work the bar does not hold.
  const team = useTeamAuthority()
  const inTeam = active?.kind === "team"

  async function leave() {
    // EVERYTHING THIS PERSON LEFT ON THE DEVICE GOES WITH THE SESSION. A phone gets handed around a
    // clubhouse: the next person to sign in must not land in the previous person's team, and must not
    // find their half-typed message waiting in a composer.
    await forgetSelectedContext()
    await clearAllDrafts()
    // The Rugby Hub's team choice, recent searches and in-memory bundles go too.
    await forgetHubTeamPreference()
    await forgetRecentSearches()
    forgetHubCache()
    // What needed the previous person's attention is theirs, not the next person's.
    forgetAttentionCache()
    await signOut()
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
            icon={<ExternalLink size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Profile"
            caption="Your name and your picture — on the web for now"
            onPress={() => void Linking.openURL(`${webUrl}/account`)}
            external
          />
          <Row
            icon={<ExternalLink size={19} color={colour.forest800} strokeWidth={1.9} />}
            label="Security"
            caption="Password, authenticator and your signed-in devices"
            onPress={() => void Linking.openURL(`${webUrl}/account/security`)}
            external
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
