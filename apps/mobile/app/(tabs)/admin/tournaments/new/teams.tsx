import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import type { KitConfig } from "@ovalball/contracts/agenda/kit"
import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import { readClubKits, readOurTeamsForAgeGroups, type OurTeamOption, type TournamentCandidateTeam, type TournamentClubResult } from "@ovalball/contracts/club/tournament-teams"

import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { supabase } from "../../../../../src/auth/supabase"
import { CreateTournamentHeader, useTournamentDraft } from "../../../../../src/tournaments/create-context"
import { AddClubsSheet } from "../../../../../src/tournaments/add-clubs-sheet"
import { ExternalClubSheet } from "../../../../../src/tournaments/external-club-sheet"
import { ClubCrest, TeamRow } from "../../../../../src/tournaments/team-row"
import {
  addExternalSide,
  addOurTeam,
  addSides,
  ageGroupEntry,
  alreadyInGrade,
  gradeBreakdown,
  removeOurTeam,
  removeSide,
  seedOurTeams,
  teamCountForGrade,
  teamsLabel,
  teamsStepHint,
  totalTeamCount,
  addDirectoryClubSide,
} from "../../../../../src/tournaments/teams-selection"
import { WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { Info, Plus } from "../../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * CREATE TOURNAMENT -- STEP 3 OF 4: TEAMS.
 *
 * A TOURNAMENT IS ORGANISED BY AGE GROUP, so this step is really four (or however many the organiser
 * chose): the U9 competition has its own field of teams, and the U11 one has another. The tabs across
 * the top are the grades from Step 2 -- only those, because a grade that was not selected has no
 * competition to fill.
 *
 * OUR OWN SIDES ARE ALREADY IN. A club hosting a U9 festival is running a U9 festival; its own U9
 * teams are playing. They are seeded from the club's real teams and can be taken out again -- which
 * removes them from THIS tournament and touches no team record.
 *
 * ADDED IS NOT INVITED. Another Ovalball club the organiser adds is simply in. No email, no pending
 * state, nothing for that club to accept or decline. That is a product decision and this screen holds
 * to it: there is no status control here at all, because there is no status to set.
 *
 * NOTHING IS WRITTEN YET. This configures the draft; the tournament and every entry is created once,
 * at Review & Create.
 */
export default function TeamsScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const { draft, setDraft } = useTournamentDraft()

  const [ourTeamsByGrade, setOurTeamsByGrade] = useState<Record<string, OurTeamOption[]>>({})
  const [ourKit, setOurKit] = useState<KitConfig | null>(null)
  const [otherKits, setOtherKits] = useState<Record<string, KitConfig>>({})
  const [hostDirectoryId, setHostDirectoryId] = useState<string | null>(null)
  const [host, setHost] = useState<{ name: string; crestUrl: string | null }>({ name: "", crestUrl: null })
  const [rugbyCode, setRugbyCode] = useState<string>("union")
  const [active, setActive] = useState<string>(draft.ageGroups[0]?.ageGroup ?? "")
  const [addSheet, setAddSheet] = useState(false)
  const [externalSheet, setExternalSheet] = useState(false)

  const grades = useMemo(() => draft.ageGroups.map((g) => g.ageGroup), [draft.ageGroups])

  // A grade can disappear from under this screen if the organiser goes back and deselects it, so the
  // active tab is corrected rather than left pointing at a competition that no longer exists.
  useEffect(() => {
    if (grades.length > 0 && !grades.includes(active)) setActive(grades[0])
  }, [grades, active])

  useEffect(() => {
    if (!clubId || grades.length === 0) return
    let live = true
    void readOurTeamsForAgeGroups(supabase, clubId, grades)
      .then((byGrade) => {
        if (!live) return
        setOurTeamsByGrade(byGrade)
        // Seeds only the grades never looked at. A grade the organiser emptied stays empty.
        setDraft((d) => ({ ...d, ageGroups: seedOurTeams(d.ageGroups, byGrade) }))
      })
      .catch(() => {})
    void readClubKits(supabase, [clubId]).then((k) => live && setOurKit(k[clubId] ?? null)).catch(() => {})
    void supabase
      .from("clubs")
      .select("directory_id, logo_storage_path, club_directory(name, rugby_code, logo_storage_path)")
      .eq("id", clubId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return
        const dir = data.club_directory as { name: string; rugby_code: string; logo_storage_path: string | null } | null
        setHostDirectoryId(data.directory_id)
        // THE ORGANISER'S OWN CLUB IS NAMED AND BADGED like every other club on the screen. "Your club"
        // beside a letter in a box is what a placeholder looks like, and this club has a real crest.
        setHost({ name: dir?.name ?? "", crestUrl: clubLogoUrlFromPath(supabase, data.logo_storage_path ?? dir?.logo_storage_path ?? null) })
        const code = dir?.rugby_code
        if (code === "union" || code === "league") setRugbyCode(code)
      })
    return () => {
      live = false
    }
  }, [clubId, grades.join("|"), setDraft])

  const group = ageGroupEntry(draft.ageGroups, active)
  const ourOptions = ourTeamsByGrade[active] ?? []
  const ourIn = useMemo(() => new Set(group?.ourTeamIds ?? []), [group])
  const ourShown = ourOptions.filter((t) => ourIn.has(t.teamId))
  const ourRemoved = ourOptions.filter((t) => !ourIn.has(t.teamId))
  const sides = group?.sides ?? []

  // Another club's kit, loaded once its sides are in the draft.
  useEffect(() => {
    const ids = [...new Set(sides.map((s) => s.clubId).filter((v): v is string => !!v))].filter((id) => !(id in otherKits))
    if (ids.length === 0) return
    let live = true
    void supabase
      .from("clubs")
      .select("id, directory_id")
      .in("directory_id", ids)
      .then(({ data }) => {
        if (!live || !data?.length) return
        const byDirectory = new Map(data.map((c) => [c.id, c.directory_id]))
        void readClubKits(supabase, data.map((c) => c.id)).then((k) => {
          if (!live) return
          const mapped: Record<string, KitConfig> = {}
          for (const [clubRowId, kit] of Object.entries(k)) {
            const dir = byDirectory.get(clubRowId)
            if (dir) mapped[dir] = kit
          }
          setOtherKits((prev) => ({ ...prev, ...mapped }))
        })
      })
    return () => {
      live = false
    }
  }, [sides.map((s) => s.clubId ?? "").join("|")])

  const alreadyIn = useCallback(
    (club: TournamentClubResult, teams: TournamentCandidateTeam[]) => alreadyInGrade(ageGroupEntry(draft.ageGroups, active), teams, club.directoryId),
    [draft.ageGroups, active],
  )

  const gradeCount = teamCountForGrade(group)
  const total = totalTeamCount(draft.ageGroups)
  const hint = teamsStepHint(draft.ageGroups)

  // Sides grouped under their club, which is how a person reads a team sheet.
  const byClub = useMemo(() => {
    const out = new Map<string, { name: string; crestUrl: string | null; clubId: string | null; sides: typeof sides }>()
    for (const s of sides) {
      const e = out.get(s.directoryId) ?? { name: s.clubName, crestUrl: s.crestUrl, clubId: s.clubId, sides: [] as typeof sides }
      e.sides = [...e.sides, s]
      out.set(s.directoryId, e)
    }
    return [...out.entries()]
  }, [sides])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <CreateTournamentHeader step={3} />

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.md, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.title, { color: colour.ink }]}>Teams</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Add the clubs and teams taking part in each age group.</Text>
        </View>

        {/* ONLY THE GRADES STEP 2 CHOSE. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}>
          {draft.ageGroups.map((g) => {
            const on = g.ageGroup === active
            return (
              <Pressable
                key={g.ageGroup}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${g.ageGroup}, ${teamsLabel(teamCountForGrade(g))}`}
                onPress={() => setActive(g.ageGroup)}
                style={({ pressed }) => ({
                  minHeight: 38,
                  minWidth: 74,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: on ? colour.forest800 : colour.line,
                  backgroundColor: on ? colour.forest800 : colour.surface,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{g.ageGroup}</Text>
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{active} Teams</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>{teamsLabel(gradeCount)}</Text>
          </View>

          {/* OUR OWN SIDES. */}
          {ourShown.length > 0 && (
            <View style={{ gap: space.xs }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Our Teams ({ourShown.length})</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 2 }}>
                <ClubCrest url={host.crestUrl} name={host.name || "Club"} size={24} />
                <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.inkMuted }]}>
                  {host.name}
                </Text>
              </View>
              {ourShown.map((t) => (
                <TeamRow
                  key={t.teamId}
                  name={t.name}
                  kit={ourKit}
                  // Our own side still names the club: two clubs in this list can each bring an
                  // "Under 12 Boys", and the remove button has to say which one it takes out.
                  clubName={host.name}
                  badge="Our Team"
                  onRemove={() => setDraft((d) => ({ ...d, ageGroups: removeOurTeam(d.ageGroups, active, t.teamId) }))}
                />
              ))}
            </View>
          )}

          {/* A SIDE THE ORGANISER TOOK OUT CAN COME BACK. Removing is not deleting, so the way back is
              on the screen rather than in a memory of what used to be there. */}
          {ourRemoved.length > 0 && (
            <View style={{ gap: space.xs }}>
              {ourRemoved.map((t) => (
                <Pressable
                  key={t.teamId}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${t.name} back`}
                  onPress={() => setDraft((d) => ({ ...d, ageGroups: addOurTeam(d.ageGroups, active, t.teamId, ourOptions) }))}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: colour.lineStrong,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Plus size={15} color={colour.rugby700} strokeWidth={2.2} />
                  <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.inkMuted }]}>
                    Add {t.name} back
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* EVERY OTHER CLUB, GROUPED UNDER ITS OWN CREST. */}
          {byClub.map(([directoryId, club]) => (
            <View key={directoryId} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.xs }}>
                <ClubCrest url={club.crestUrl} name={club.name} size={24} />
                <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
                  {club.name}
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{teamsLabel(club.sides.length)}</Text>
              </View>
              {club.sides.map((s) => (
                <TeamRow
                  key={s.key}
                  name={s.label}
                  kit={s.clubId ? (otherKits[s.clubId] ?? null) : null}
                  clubName={club.name}
                  badge={s.clubId ? "Added" : "External"}
                  onRemove={() => setDraft((d) => ({ ...d, ageGroups: removeSide(d.ageGroups, active, s.key) }))}
                />
              ))}
            </View>
          ))}

          {gradeCount === 0 && (
            <Text style={[type.small, { color: colour.inkMuted, paddingVertical: space.sm }]}>
              No teams in the {active} competition yet.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Clubs / Teams"
            onPress={() => setAddSheet(true)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: space.xs,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.forest800,
              backgroundColor: colour.successSurface,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Plus size={17} color={colour.forest800} strokeWidth={2.3} />
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Clubs / Teams</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
          <View style={{ paddingTop: 1 }}>
            <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
          </View>
          <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
            These are the teams taking part in the {active} competition. You can add teams from other clubs
            or external clubs, and remove any teams if needed.
          </Text>
        </View>
      </ScrollView>

      {/* TEAMS, NOT CLUBS: a club bringing three sides is three teams. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>Total teams across all age groups</Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>
            {gradeBreakdown(draft.ageGroups)}
          </Text>
        </View>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{teamsLabel(total)}</Text>
      </View>

      <WizardFooter
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments/new/age-groups" as never))}
        primaryLabel="Next: Review"
        onPrimary={() => router.push("/admin/tournaments/new/review" as never)}
        primaryDisabled={!!hint}
        primaryHint={hint}
      />

      <AddClubsSheet
        visible={addSheet}
        ageGroup={active}
        rugbyCode={rugbyCode}
        hostDirectoryId={hostDirectoryId}
        alreadyIn={alreadyIn}
        onClose={() => setAddSheet(false)}
        onAdd={(club, teams) => setDraft((d) => ({ ...d, ageGroups: addSides(d.ageGroups, active, club, teams) }))}
        tournamentAgeGroups={draft.ageGroups.map((g) => g.ageGroup)}
        onAddClubSide={(club, grade, alias) =>
          // THE SAME RULE AS THE MANAGEMENT TAB. A canonical club with no team at the chosen grade
          // becomes a side carrying that club's real directory id, the grade the organiser picked and
          // an optional alias -- never a retyped unknown club, and never a grade read out of a name.
          // The wizard holds it in the draft; `buildCreatePayload` sends the same shape
          // `add_tournament_participant_team` writes after creation.
          setDraft((d) => ({
            ...d,
            ageGroups: addDirectoryClubSide(d.ageGroups, grade, {
              directoryId: club.directoryId,
              clubName: club.name,
              crestUrl: club.crestUrl,
              alias,
            }),
          }))
        }
        onAddExternal={() => {
          setAddSheet(false)
          setExternalSheet(true)
        }}
      />

      <ExternalClubSheet
        visible={externalSheet}
        ageGroup={active}
        tournamentAgeGroups={draft.ageGroups.map((g) => g.ageGroup)}
        onClose={() => setExternalSheet(false)}
        onAdd={(input) =>
          setDraft((d) => ({
            ...d,
            // The grade the organiser chose, not the tab this was opened from.
            ageGroups: addExternalSide(d.ageGroups, input.ageGroup, { directoryId: null, clubName: input.clubName, alias: input.alias }),
          }))
        }
      />
    </View>
  )
}
