import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { anyTeamAdministration } from "@ovalball/contracts/team/authority"

import { useTeamAuthority } from "../../../../src/team/authority"
import { NotForYou, TeamScreen } from "../../../../src/team/screen"
import { ArrowRightLeft, ChevronRight, KeyRound, Newspaper, Settings2, UserPlus, Users } from "../../../../src/components/icons"
import { CardSkeleton } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * TEAM SETTINGS -- the infrequent work, in one place (CA-M7).
 *
 * Join requests, player requests between the club's sides, join codes, the staff who run the side and
 * publishing are set up once and touched rarely; they do not earn a place beside Fixtures and
 * Availability. A pending item still reaches the person through Needs Attention, which links straight
 * to the row here where it is dealt with.
 *
 * EVERY ROW IS A CAPABILITY THE SERVER CONFIRMED. A Coach without `team.roster.manage` sees no Join
 * Requests row, not a row that refuses; a person with nothing to configure is told so once. Season
 * handover, folding the side and club-wide settings are the club's and stay on the website.
 */
export default function TeamSettings() {
  const router = useRouter()
  const { authority: a, loading, teamId } = useTeamAuthority()
  const rows: { key: string; icon: React.ReactNode; label: string; caption: string; onPress: () => void; show: boolean }[] = [
    { key: "requests", icon: <UserPlus size={19} color={colour.forest800} strokeWidth={1.9} />, label: "Join Requests", caption: "Players waiting to be let into the side", onPress: () => router.push("/team/settings/requests" as never), show: a.rosterManage },
    { key: "player-requests", icon: <ArrowRightLeft size={19} color={colour.forest800} strokeWidth={1.9} />, label: "Player Requests", caption: "Call-ups between the club's sides for a fixture", onPress: () => router.push("/team/settings/player-requests" as never), show: a.callupRequest },
    { key: "staff", icon: <Users size={19} color={colour.forest800} strokeWidth={1.9} />, label: "Staff", caption: "The coaches and managers who run the side", onPress: () => router.push({ pathname: "/team/people", params: { tab: "staff" } } as never), show: a.roleAssignTeam || a.rosterView },
    { key: "codes", icon: <KeyRound size={19} color={colour.forest800} strokeWidth={1.9} />, label: "Join Codes", caption: "A code a family can use to ask to join", onPress: () => router.push("/team/settings/join-codes" as never), show: a.joinCodeManage },
    { key: "news", icon: <Newspaper size={19} color={colour.forest800} strokeWidth={1.9} />, label: "News & Announcements", caption: "What this side publishes", onPress: () => router.push("/admin/news" as never), show: a.newsManage },
    { key: "details", icon: <Settings2 size={19} color={colour.forest800} strokeWidth={1.9} />, label: "Team Details", caption: "The side's canonical name and its alias", onPress: () => router.push({ pathname: "/admin/teams/[teamId]", params: { teamId: teamId ?? "" } } as never), show: a.teamManage },
  ]
  const shown = rows.filter((r) => r.show)

  return (
    <TeamScreen section="Team Settings">
      {loading && <CardSkeleton lines={3} />}
      {!loading && !anyTeamAdministration(a) && <NotForYou title="Nothing to set up from here" body="Requests, codes, staff and publishing for this side are handled by the people the club has given those jobs to." />}
      {!loading && shown.length > 0 && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {shown.map((r, index) => (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              accessibilityLabel={`${r.label}. ${r.caption}`}
              onPress={r.onPress}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
            >
              {r.icon}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{r.label}</Text>
                <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{r.caption}</Text>
              </View>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          ))}
        </View>
      )}
      <Text style={[type.caption, { color: colour.inkSubtle }]}>Season handover, folding the side and the club's own settings stay on the website, with the club.</Text>
    </TeamScreen>
  )
}
