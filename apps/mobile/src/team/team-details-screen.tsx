import { useCallback, useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { loadTeamProfile, loadTeamProfileIdentity, type TeamProfile, type TeamProfileIdentity } from "@ovalball/contracts/team/profile"

import { supabase } from "../auth/supabase"
import { EditDescriptionSheet } from "./edit-description-sheet"
import { friendly, logDetail } from "../errors/translate"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, CardSkeleton, ErrorState } from "../components/ui"
import { colour, radius, space, type } from "../design/tokens"

/**
 * TEAM DETAILS -- the canonical read/edit presentation of a team's identity fields (Section 6),
 * reached from the Team Profile ellipsis menu and from Overview's own "Team Details" row. One
 * implementation, both entry points converge here.
 *
 * WHY MOST ROWS ARE READ-ONLY, NOT A MISTAKE: the mockup shows four editable rows (Name, Age Grade,
 * Gender, Season) plus Description. Before wiring any of them to a mutation, each was audited against
 * the real schema and the existing canonical architecture:
 *
 *   TEAM NAME -- `teams.display_name` is a DATABASE-COMPUTED column. `teams_set_display_name_trigger`
 *   (20260904100000_locked_team_naming.sql) recomputes it from category/age_group/gender/
 *   squad_designation on every insert AND on every update that touches those fields, and its own
 *   comment states the intent explicitly: "a client-supplied display_name is always overwritten, never
 *   trusted." There is categorically no free-text rename path to wire up -- building one would either
 *   silently no-op or require undoing a deliberate, already-shipped product decision (the Team
 *   Directory's canonical naming) that is not this section's to make. The one adjacent, real mechanism
 *   -- `set_team_alias`/`team_aliases` -- is a club-set friendly nickname for a B/C SQUAD team
 *   specifically ("Blacks", "Golds"), authorised at `club.teams.manage`, not a general team rename; it
 *   is a narrower, different feature and is left for its own pass rather than folded in here as if it
 *   answered "Team Name".
 *
 *   AGE GRADE / GENDER -- both feed the SAME trigger and the SAME `identity_key`/
 *   `canonical_team_type_id` uniqueness and Team Directory eligibility a real club already has fixtures,
 *   competition entries and role assignments built against. No existing mobile-reachable, safe
 *   transition path for changing an established team's age grade or gender exists yet (Season Rollover
 *   owns age-grade progression and has no mobile UI at all as of this section). Per this section's own
 *   brief: "If a field is C, DO NOT fake an editor just to match the mockup. Render it as read-only and
 *   report why." Both are Category C here.
 *
 *   SEASON -- `teams` has no `season_id` column at all. A team is season-independent; "Season" is the
 *   CURRENT season resolved from the canonical register (`TeamProfile.season`, the exact read Overview's
 *   own summary already uses), not a field this team owns. There is nothing to edit -- Season Handover
 *   is the real, existing product surface for anything season-shaped, and duplicating it here was
 *   explicitly ruled out by the brief.
 *
 * DESCRIPTION is the one genuinely safe, already-governed field -- `set_team_description`, the exact
 * same RPC and the exact same `EditDescriptionSheet` Overview's own "About This Team" card already uses.
 * No second write path.
 */
export function TeamDetailsScreen({ teamId }: { teamId: string }) {
  const router = useRouter()
  const [identity, setIdentity] = useState<TeamProfileIdentity | null>(null)
  const [profile, setProfile] = useState<TeamProfile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editingDescription, setEditingDescription] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const id = await loadTeamProfileIdentity(supabase, teamId)
      setIdentity(id)
      setProfile(await loadTeamProfile(supabase, id.clubId, teamId, id.rugbyCode))
    } catch (caught) {
      const failure = friendly(caught, "this team's details")
      logDetail("team details", failure)
      setProblem(failure.message)
    }
  }, [teamId])
  useEffect(() => {
    setIdentity(null)
    setProfile(null)
    void load()
  }, [load])
  useFocusEffect(useCallback(() => { void load() }, [load]))

  const canManage = profile?.canEditCover ?? false

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Team Details" onBack={() => router.back()} tone="forest" />
      {problem ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={problem} onRetry={() => void load()} />
        </View>
      ) : !identity || !profile ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <CardSkeleton lines={5} />
        </View>
      ) : (
        <View style={{ padding: space.lg, gap: space.lg }}>
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            <DetailRow label="Team Name" value={identity.fullLabel} first />
            <DetailRow label="Age Grade" value={ageGradeLabel(identity)} />
            <DetailRow label="Gender" value={genderLabel(identity.gender)} />
            <DetailRow label="Season" value={profile.season?.label ?? "Not set"} />
          </View>

          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink }]}>Description</Text>
              {!!identity.description && canManage && (
                <Pressable accessibilityRole="button" accessibilityLabel="Edit team description" onPress={() => setEditingDescription(true)} hitSlop={8} style={({ pressed }) => ({ minHeight: 32, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>Edit</Text>
                </Pressable>
              )}
            </View>
            <Text style={[type.small, { color: identity.description ? colour.ink : colour.inkMuted, lineHeight: 21 }]}>
              {identity.description ?? "No team description has been added yet."}
            </Text>
            {!identity.description && canManage && <Button label="Add Description" variant="quiet" onPress={() => setEditingDescription(true)} />}
          </View>

          {canManage && (
            <Text style={[type.caption, { color: colour.inkSubtle }]}>
              Team name, age grade and gender are set from this team's canonical identity and season is
              read from the current season register -- none of these can be changed from this screen.
              Age grade or gender changes go through Season Rollover; season changes go through Season
              Handover.
            </Text>
          )}
        </View>
      )}

      {editingDescription && identity && (
        <EditDescriptionSheet
          teamId={identity.id}
          current={identity.description}
          onClose={() => setEditingDescription(false)}
          onSaved={(description) => {
            setIdentity((prior) => (prior ? { ...prior, description } : prior))
            setEditingDescription(false)
          }}
        />
      )}
    </View>
  )
}

/** No chevron, ever -- none of these rows are tappable (Section 6's own audit result). */
function DetailRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 58, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
      <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right", marginLeft: space.md }]}>{value}</Text>
    </View>
  )
}

/** The exact same "Under N" transformation `fullTeamLabel`/`compactTeamLabel` already apply
 * (`packages/contracts/src/teams/compact-label.ts`) -- never a second age-grade vocabulary. */
function ageGradeLabel(identity: { category: string; ageGroup: string | null }): string {
  if (identity.ageGroup) return `Under ${identity.ageGroup.replace(/^U/i, "")}`
  if (identity.category === "senior") return "Senior"
  if (identity.category === "colts") return "Colts"
  return "Not set"
}

/** The same gender vocabulary the Overview hero's own meta line already uses -- never a second one. */
function genderLabel(gender: string | null): string {
  switch (gender) {
    case "mens":
      return "Men"
    case "womens":
      return "Women"
    case "boys":
      return "Boys"
    case "girls":
      return "Girls"
    case "mixed":
      return "Mixed"
    default:
      return "Not set"
  }
}
