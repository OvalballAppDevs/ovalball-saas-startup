import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native"
import type { KitConfig } from "@ovalball/contracts/agenda/kit"
import {
  readClubKits,
  readClubTeamsAtGrade,
  type TournamentCandidateTeam,
  type TournamentClubResult,
} from "@ovalball/contracts/club/tournament-teams"
import { sidesAtGrade, teamCountAtGrade, totalTeamCount, type TournamentDetail, type TournamentSide } from "@ovalball/contracts/club/tournament-detail"

import { supabase } from "../auth/supabase"
import { AddClubsSheet } from "./add-clubs-sheet"
import { ExternalClubSheet } from "./external-club-sheet"
import { ClubCrest, TeamRow } from "./team-row"
import { Info, Plus, X } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"

/**
 * THE FIELD OF TEAMS, AFTER THE TOURNAMENT EXISTS.
 *
 * The same two sheets the create wizard uses -- so a club is found and its sides are chosen exactly
 * the same way whether the tournament is being made or managed. What differs is where the answer
 * goes: the wizard puts it in a draft, this writes it immediately, because the tournament is real and
 * there is nothing to defer to.
 *
 * ADDED IS NOT ACCEPTED. A club the organiser adds is `added` and that is the whole story: it was not
 * asked, so it has nothing to answer. A club that APPLIED and was accepted is also `added` by then --
 * the request is over. The place that remembers the difference is the application itself, on Requests,
 * which is exactly where a person would look for it.
 */
export function TournamentTeamsTab({ detail, onChanged }: { detail: TournamentDetail; onChanged: () => void }) {
  const [active, setActive] = useState(detail.ageGroups[0] ?? "")
  const [addSheet, setAddSheet] = useState(false)
  const [externalSheet, setExternalSheet] = useState(false)
  const [ourSheet, setOurSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ourKit, setOurKit] = useState<KitConfig | null>(null)
  const [otherKits, setOtherKits] = useState<Record<string, KitConfig>>({})
  const [hostDirectoryId, setHostDirectoryId] = useState<string | null>(null)
  const [rugbyCode, setRugbyCode] = useState("union")
  const [ourOptions, setOurOptions] = useState<TournamentCandidateTeam[]>([])

  // A grade can disappear from under this tab when Overview edits the age groups.
  useEffect(() => {
    if (detail.ageGroups.length > 0 && !detail.ageGroups.includes(active)) setActive(detail.ageGroups[0])
  }, [detail.ageGroups, active])

  useEffect(() => {
    if (!detail.hostClubId) return
    let live = true
    void readClubKits(supabase, [detail.hostClubId]).then((k) => live && setOurKit(k[detail.hostClubId!] ?? null)).catch(() => {})
    void supabase
      .from("clubs")
      .select("directory_id, club_directory(rugby_code)")
      .eq("id", detail.hostClubId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return
        setHostDirectoryId(data.directory_id)
        const code = (data.club_directory as { rugby_code: string } | null)?.rugby_code
        if (code === "union" || code === "league") setRugbyCode(code)
      })
    return () => {
      live = false
    }
  }, [detail.hostClubId])

  // Our own sides at this grade that are NOT yet in, so they can be added back.
  useEffect(() => {
    if (!detail.hostClubId || !active) return
    let live = true
    void readClubTeamsAtGrade(supabase, detail.hostClubId, active).then((t) => live && setOurOptions(t)).catch(() => {})
    return () => {
      live = false
    }
  }, [detail.hostClubId, active])

  const at = useMemo(() => sidesAtGrade(detail, active), [detail, active])

  useEffect(() => {
    const ids = [...new Set(at.clubs.map((c) => c.clubId).filter((v): v is string => !!v))].filter((id) => !(id in otherKits))
    if (ids.length === 0) return
    let live = true
    void readClubKits(supabase, ids).then((k) => live && setOtherKits((p) => ({ ...p, ...k }))).catch(() => {})
    return () => {
      live = false
    }
  }, [at.clubs.map((c) => c.clubId ?? "").join("|")])

  const run = useCallback(
    async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
      setBusy(true)
      const { error } = await fn()
      setBusy(false)
      if (error) Alert.alert("That change was not saved", error.message)
      else onChanged()
    },
    [onChanged],
  )

  /**
   * REMOVING A SIDE ASKS FIRST, AND SAYS WHAT GOES WITH IT.
   *
   * There are no games yet because Planning has not been built -- but the question is asked in the
   * shape that survives Planning arriving, so that the day a side HAS fixtures the guard is already
   * in the right place rather than being remembered.
   */
  // THE CLUB IS PART OF THE QUESTION. Three clubs can each bring an "Under 12 Boys", so asking
  // "Remove Under 12 Boys?" asks about a side the person cannot identify -- and the answer is
  // destructive. The club's name is what tells them which one they are about to take out.
  const confirmRemove = useCallback(
    (side: TournamentSide, clubName: string, onConfirm: () => void) => {
      const who = clubName ? `${clubName} ${side.label}` : side.label
      Alert.alert(
        `Remove ${who}?`,
        `${who} will be taken out of the ${side.ageGroup} competition. The team itself is not changed, and it can be added again.`,
        [
          { text: "Keep", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: onConfirm },
        ],
      )
    },
    [],
  )

  const alreadyIn = useCallback(
    (club: TournamentClubResult, teams: TournamentCandidateTeam[]) => {
      const group = at.clubs.find((c) => c.directoryId === club.directoryId)
      const have = new Set((group?.sides ?? []).map((s) => s.teamId).filter(Boolean))
      return new Set(teams.filter((t) => have.has(t.teamId)).map((t) => t.teamId))
    },
    [at.clubs],
  )

  const ourIn = new Set(at.ours.map((s) => s.teamId))
  const ourMissing = ourOptions.filter((t) => !ourIn.has(t.teamId))
  const gradeCount = teamCountAtGrade(detail, active)
  const tabBar = useTabBarHeight()

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}>
        {/* ONLY THE GRADES THIS TOURNAMENT RUNS. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}>
          {detail.ageGroups.map((g) => {
            const on = g === active
            return (
              <Pressable
                key={g}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${g}, ${teamCountAtGrade(detail, g)} teams`}
                onPress={() => setActive(g)}
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
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{g}</Text>
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{active} Teams</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>{gradeCount === 1 ? "1 team" : `${gradeCount} teams`}</Text>
          </View>

          {at.ours.length > 0 && (
            <View style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <ClubCrest url={detail.hostCrestUrl} name={detail.hostClubName || "Club"} size={24} />
                <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
                  {detail.hostClubName}
                </Text>
              </View>
              {at.ours.map((s) => (
                <TeamRow
                  key={s.id}
                  name={s.label}
                  badge="Our Team"
                  kit={ourKit}
                  clubName={detail.hostClubName}
                  onRemove={() => confirmRemove(s, detail.hostClubName, () => void run(() => supabase.rpc("remove_tournament_team_entry", { p_entry_id: s.id } as never)))}
                />
              ))}
            </View>
          )}

          {ourMissing.length > 0 && (
            <View style={{ gap: space.xs }}>
              {ourMissing.map((t) => (
                <Pressable
                  key={t.teamId}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${t.name}`}
                  onPress={() => void run(() => supabase.rpc("add_tournament_team_entry", { p_tournament_id: detail.id, p_team_id: t.teamId } as never))}
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
                    Add {t.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {at.clubs.map((club) => (
            <View key={club.directoryId} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.xs }}>
                <ClubCrest url={club.crestUrl} name={club.clubName} size={24} />
                <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
                  {club.clubName}
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{club.sides.length === 1 ? "1 team" : `${club.sides.length} teams`}</Text>
              </View>
              {club.sides.map((s) => (
                <TeamRow
                  key={s.id}
                  name={s.label}
                  badge={s.kind === "external" ? "External" : "Added"}
                  kit={club.clubId ? (otherKits[club.clubId] ?? null) : null}
                  clubName={club.clubName}
                  onRemove={() => confirmRemove(s, club.clubName, () => void run(() => supabase.rpc("remove_tournament_participant", { p_participant_id: s.id } as never)))}
                />
              ))}
            </View>
          ))}

          {gradeCount === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No teams in the {active} competition yet.</Text>}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Teams"
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
            <Text style={[type.smallMedium, { color: colour.forest800 }]}>Add Teams</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
          <View style={{ paddingTop: 1 }}>
            <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
          </View>
          <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
            Ovalball clubs are added directly to the tournament. No invitations are required. External
            clubs are included manually.
          </Text>
        </View>
      </ScrollView>

      {busy && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(248,250,247,0.55)" }}>
          <ActivityIndicator color={colour.forest800} />
        </View>
      )}

      <AddClubsSheet
        visible={addSheet}
        ageGroup={active}
        rugbyCode={rugbyCode}
        hostDirectoryId={hostDirectoryId}
        alreadyIn={alreadyIn}
        onClose={() => setAddSheet(false)}
        onAdd={(club, teams) =>
          void run(async () => {
            for (const t of teams) {
              const { error } = await supabase.rpc("add_tournament_participant_team", {
                p_tournament_id: detail.id,
                p_club_directory_id: club.directoryId,
                p_team_id: t.teamId,
                p_age_group: active,
              } as never)
              if (error) return { error }
            }
            return { error: null }
          })
        }
        tournamentAgeGroups={detail.ageGroups}
        onAddClubSide={(club, grade, alias) =>
          void run(() =>
            // THE CLUB'S OWN DIRECTORY IDENTITY IS KEPT. No team id, because the club has not created
            // that side on Ovalball -- but it is still Wigan, not an anonymous name, so if Wigan later
            // creates its U12 team this participant is still recognisably theirs.
            supabase.rpc("add_tournament_participant_team", {
              p_tournament_id: detail.id,
              p_club_directory_id: club.directoryId,
              // THE GRADE IS WHAT THE ORGANISER CHOSE, not the tab they happened to open the sheet
              // from, and never anything read out of the alias.
              p_age_group: grade,
              p_squad_label: alias,
            } as never),
          )
        }
        onAddExternal={() => {
          setAddSheet(false)
          setExternalSheet(true)
        }}
      />

      <ExternalClubSheet
        visible={externalSheet}
        ageGroup={active}
        tournamentAgeGroups={detail.ageGroups}
        onClose={() => setExternalSheet(false)}
        onAdd={(input) =>
          void run(() =>
            // THE SERVER RESOLVES THE CLUB, NOT THIS SCREEN. Inserting into `club_directory` from here
            // is refused by RLS -- correctly: a club administrator may record a club for a tournament
            // they manage, which is not the same permission as writing the canonical club directory.
            // `add_tournament_participant_team` matches an existing club by name before creating
            // anything, so typing a name Ovalball already has records the side against that club
            // rather than inventing a second one. It is the same server logic the create wizard uses.
            supabase.rpc("add_tournament_participant_team", {
              p_tournament_id: detail.id,
              p_club_name: input.clubName,
              p_age_group: input.ageGroup,
              p_squad_label: input.alias,
            } as never),
          )
        }
      />
    </View>
  )
}

