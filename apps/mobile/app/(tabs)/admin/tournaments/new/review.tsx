import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import type { KitConfig } from "@ovalball/contracts/agenda/kit"
import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import { FORMAT_ICON } from "../../../../../src/tournaments/format-icon"
import { formatLabel } from "@ovalball/contracts/club/tournaments"
import { readClubKits, readOurTeamsForAgeGroups, type OurTeamOption } from "@ovalball/contracts/club/tournament-teams"

import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { supabase } from "../../../../../src/auth/supabase"
import { CreateTournamentHeader, useTournamentDraft, type DraftSide } from "../../../../../src/tournaments/create-context"
import { ClubCrest, TeamKit } from "../../../../../src/tournaments/team-row"
import { applyTournamentCoverChoice } from "../../../../../src/tournaments/cover-control"
import { ageGroupsLabel, buildCreatePayload, daysLabel, tournamentDayCount, validateDraft, type DraftProblem } from "../../../../../src/tournaments/create-payload"
import { teamCountForGrade, teamsLabel, totalTeamCount } from "../../../../../src/tournaments/teams-selection"
import { WizardFooter } from "../../../../../src/venue/wizard-chrome"
import { CalendarDays, ChevronRight, CircleAlert, Clock, Info, Layers, ListOrdered, Lock, MapPin, Globe, Shirt, Trophy, Users } from "../../../../../src/components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * CREATE TOURNAMENT -- STEP 4 OF 4: REVIEW & CREATE.
 *
 * THE LAST PLACE ANYTHING CAN BE CHANGED, so it shows everything the three steps before it collected
 * and nothing it invented. Every number on this screen is counted from the draft: a hardcoded "18
 * teams" would be right once and wrong for ever after.
 *
 * CREATE IS ONE CALL. `create_tournament_with_teams` writes the tournament, its competitions, our own
 * entries and every other club's sides in a single transaction. The alternative -- save, then grades,
 * then teams -- leaves a real tournament missing half its teams the moment anything fails, and the
 * organiser has no way to tell which half.
 *
 * ADDED IS NOT INVITED, AND THIS SCREEN SAYS SO OUT LOUD. Nothing here shows a pending, accepted or
 * declined state, because an organiser adding a club is not asking it a question. Public applications
 * are a different workflow entirely and are not conflated with this one.
 */
export default function ReviewScreen() {
  const router = useRouter()
  const { clubId } = useAdminCentreAccess()
  const { draft, setDraft, reset } = useTournamentDraft()

  const [ourTeamsByGrade, setOurTeamsByGrade] = useState<Record<string, OurTeamOption[]>>({})
  const [ourKit, setOurKit] = useState<KitConfig | null>(null)
  const [otherKits, setOtherKits] = useState<Record<string, KitConfig>>({})
  const [host, setHost] = useState<{ name: string; crestUrl: string | null }>({ name: "", crestUrl: null })
  // The venue address the organiser already chose at Basic Details. Re-reading the venue here
  // would be a second source for one fact the draft is already carrying.
  const venueAddress = draft.venueAddress
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const scroller = useRef<ScrollView | null>(null)
  const gradeOffsets = useRef<Record<string, number>>({})

  const grades = useMemo(() => draft.ageGroups.map((g) => g.ageGroup), [draft.ageGroups])

  useEffect(() => {
    if (!clubId || grades.length === 0) return
    let live = true
    void readOurTeamsForAgeGroups(supabase, clubId, grades).then((b) => live && setOurTeamsByGrade(b)).catch(() => {})
    void readClubKits(supabase, [clubId]).then((k) => live && setOurKit(k[clubId] ?? null)).catch(() => {})
    void supabase
      .from("clubs")
      .select("directory_id, logo_storage_path, club_directory(name, logo_storage_path)")
      .eq("id", clubId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return
        const dir = data.club_directory as { name: string; logo_storage_path: string | null } | null
        setHost({ name: dir?.name ?? "", crestUrl: clubLogoUrlFromPath(supabase, data.logo_storage_path ?? dir?.logo_storage_path ?? null) })
      })
    return () => {
      live = false
    }
  }, [clubId, grades.join("|")])

  const allSides = useMemo(() => draft.ageGroups.flatMap((g) => g.sides), [draft.ageGroups])
  useEffect(() => {
    const ids = [...new Set(allSides.map((s) => s.clubId).filter((v): v is string => !!v))].filter((id) => !(id in otherKits))
    if (ids.length === 0) return
    let live = true
    void supabase
      .from("clubs")
      .select("id, directory_id")
      .in("directory_id", ids)
      .then(({ data }) => {
        if (!live || !data?.length) return
        const dirByClub = new Map(data.map((c) => [c.id, c.directory_id]))
        void readClubKits(supabase, data.map((c) => c.id)).then((k) => {
          if (!live) return
          const mapped: Record<string, KitConfig> = {}
          for (const [rowId, kit] of Object.entries(k)) {
            const dir = dirByClub.get(rowId)
            if (dir) mapped[dir] = kit
          }
          setOtherKits((p) => ({ ...p, ...mapped }))
        })
      })
    return () => {
      live = false
    }
  }, [allSides.map((s) => s.clubId ?? "").join("|")])

  const problems = useMemo(() => validateDraft(draft), [draft])
  const total = totalTeamCount(draft.ageGroups)
  const days = tournamentDayCount(draft.startsOn, draft.multiDay ? draft.endsOn : null)

  const goTo = useCallback(
    (step: DraftProblem["step"]) => {
      const to = step === "basics" ? "/admin/tournaments/new" : step === "ageGroups" ? "/admin/tournaments/new/age-groups" : "/admin/tournaments/new/teams"
      router.push(to as never)
    },
    [router],
  )

  const create = useCallback(async () => {
    if (!clubId || problems.length > 0 || busy) return
    setBusy(true)
    setFailure(null)
    const { data, error } = await supabase.rpc("create_tournament_with_teams", buildCreatePayload(draft, clubId) as never)
    if (error || !data) {
      // STAY ON REVIEW AND KEEP THE DRAFT. The transaction rolled back, so there is nothing half
      // created to clean up and nothing for the organiser to lose by trying again.
      setFailure(error?.message ?? "The tournament could not be created. Please try again.")
      setBusy(false)
      return
    }
    // Only now: the row exists. The draft is cleared so Create Another starts genuinely empty.
    const id = String(data)

    // AN UPLOADED PHOTO IS APPLIED HERE, because its storage path contains the tournament's id and
    // there was no id until this moment. A LIBRARY choice already travelled with the create.
    //
    // THE TOURNAMENT IS NOT UNMADE IF THIS FAILS. The tournament exists and is correct; it simply has
    // the default photograph, which the organiser can change from its own screen. Rolling back a real
    // tournament because a picture did not upload would be the wrong trade, so the failure is carried
    // forward as a note rather than raised as an error on a screen that is about to disappear.
    if (draft.cover?.kind === "upload") {
      await applyTournamentCoverChoice({ supabase, clubId, tournamentId: id }, draft.cover)
    }

    reset()
    setBusy(false)
    router.replace({ pathname: "/admin/tournaments/new/created", params: { id } } as never)
  }, [clubId, draft, problems.length, busy, reset, router])

  const FormatIcon = FORMAT_ICON[draft.format]

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <CreateTournamentHeader step={4} />

      <ScrollView ref={scroller} contentContainerStyle={{ padding: space.lg, paddingBottom: space.md, gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.title, { color: colour.ink }]}>Review & Create</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Check your tournament details before creating it.</Text>
        </View>

        {/* WHAT IT IS. */}
        <Card title="Basic Details" onEdit={() => goTo("basics")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text numberOfLines={2} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
              {draft.name.trim() || "Untitled tournament"}
            </Text>
            <VisibilityBadge visibility={draft.visibility} />
          </View>
          <Detail icon={<CalendarDays size={16} color={colour.rugby700} strokeWidth={1.9} />} value={dateLine(draft.startsOn, draft.startTime)} secondary={endsLater(draft.startsOn, draft.endsOn, draft.multiDay) ? `Until ${longDate(draft.endsOn)}  ·  ${daysLabel(days)}` : null} />
          <Detail icon={<MapPin size={16} color={colour.rugby700} strokeWidth={1.9} />} value={draft.venueName ?? "No venue"} secondary={venueAddress} />
          <Detail icon={<FormatIcon size={16} color={colour.rugby700} strokeWidth={1.9} />} value={formatLabel(draft.format, draft.swissRounds)} />
        </Card>

        {/* WHICH COMPETITIONS IT RUNS. */}
        <Card title="Age Groups" onEdit={() => goTo("ageGroups")}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
            {draft.ageGroups.map((g) => (
              <View key={g.ageGroup} style={{ minHeight: 30, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: colour.forest800 }}>
                <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>{g.ageGroup}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* HOW MANY, PER COMPETITION. Tapping a row jumps to that competition's teams further down --
            the detail is already on this screen, so a second editor for it would be a second truth. */}
        <Card title="Teams Overview" onEdit={() => goTo("teams")}>
          {draft.ageGroups.map((g) => (
            <Pressable
              key={g.ageGroup}
              accessibilityRole="button"
              accessibilityLabel={`${g.ageGroup}, ${teamsLabel(teamCountForGrade(g))}. Show teams`}
              onPress={() => scroller.current?.scrollTo({ y: Math.max((gradeOffsets.current[g.ageGroup] ?? 0) - 8, 0), animated: true })}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Shirt size={17} color={colour.inkSubtle} strokeWidth={1.8} />
              <Text style={[type.small, { flex: 1, color: colour.ink }]}>{g.ageGroup}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{teamsLabel(teamCountForGrade(g))}</Text>
              <ChevronRight size={16} color={colour.inkSubtle} strokeWidth={1.9} />
            </Pressable>
          ))}

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
            <Users size={18} color={colour.rugby700} strokeWidth={1.9} />
            <View style={{ flex: 1 }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Total Teams</Text>
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>across {ageGroupsLabel(draft.ageGroups.length)}</Text>
            </View>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{teamsLabel(total)}</Text>
          </View>
        </Card>

        {/* WHO IS ACTUALLY COMING, competition by competition. */}
        {draft.ageGroups.map((g) => {
          const ourOptions = ourTeamsByGrade[g.ageGroup] ?? []
          const ourIn = new Set(g.ourTeamIds ?? [])
          const ours = ourOptions.filter((t) => ourIn.has(t.teamId))
          const ovalball = g.sides.filter((s) => !!s.clubId)
          const byClub = groupByClub(ovalball)
          return (
            <View key={g.ageGroup} onLayout={(e) => (gradeOffsets.current[g.ageGroup] = e.nativeEvent.layout.y)} style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{g.ageGroup} Teams</Text>
                <Text style={[type.small, { color: colour.inkMuted }]}>{teamsLabel(teamCountForGrade(g))}</Text>
              </View>

              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
                {ours.length > 0 && (
                  <ClubBlock crestUrl={host.crestUrl} name={host.name || "Your club"}>
                    {ours.map((t) => (
                      <SideRow key={t.teamId} kit={ourKit} clubName={host.name} label={t.name} />
                    ))}
                  </ClubBlock>
                )}
                {byClub.map(([dirId, club]) => (
                  <ClubBlock key={dirId} crestUrl={club.crestUrl} name={club.name}>
                    {club.sides.map((s) => (
                      <SideRow key={s.key} kit={otherKits[s.clubId ?? ""] ?? null} clubName={club.name} label={s.label} />
                    ))}
                  </ClubBlock>
                ))}
                {teamCountForGrade(g) === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>No teams in this competition.</Text>}
              </View>
            </View>
          )
        })}

        {/* CLUBS THAT ARE NOT ON OVALBALL, kept in their own section because that difference is real:
            they were recorded by the organiser rather than being a club with an account. */}
        {externalSides(draft.ageGroups).length > 0 && (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={[type.heading, { flex: 1, color: colour.ink }]}>External Teams</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{teamsLabel(externalSides(draft.ageGroups).length)}</Text>
            </View>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.md }}>
              {groupByClub(externalSides(draft.ageGroups)).map(([dirId, club]) => (
                <ClubBlock key={dirId} crestUrl={club.crestUrl} name={club.name}>
                  {club.sides.map((s) => (
                    <SideRow key={s.key} kit={null} clubName={club.name} label={s.label} grade={s.grade} />
                  ))}
                </ClubBlock>
              ))}
            </View>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md, backgroundColor: colour.successSurface }}>
          <View style={{ paddingTop: 1 }}>
            <Info size={16} color={colour.rugby700} strokeWidth={1.9} />
          </View>
          <Text style={[type.caption, { flex: 1, color: colour.inkMuted, lineHeight: 17 }]}>
            Ovalball clubs are added directly to the tournament. No invitations are required. External
            clubs are included manually.
          </Text>
        </View>

        {/* WHAT IS STOPPING IT, named, with the way back. Never a greyed button and no explanation. */}
        {problems.length > 0 && (
          <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.warning, backgroundColor: colour.warningSurface, padding: space.md, gap: space.sm }}>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <CircleAlert size={17} color={colour.warning} strokeWidth={2} />
              <Text style={[type.smallMedium, { flex: 1, color: colour.ink }]}>This tournament is not ready yet</Text>
            </View>
            {problems.map((p, i) => (
              <Pressable
                key={`${p.step}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`${p.message} Go to ${p.step === "basics" ? "Basic Details" : p.step === "ageGroups" ? "Age Groups" : "Teams"}`}
                onPress={() => goTo(p.step)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={[type.caption, { flex: 1, color: colour.inkMuted }]}>{p.message}</Text>
                <Text style={[type.caption, { color: colour.rugby700, fontFamily: "Inter_600SemiBold" }]}>
                  {p.step === "basics" ? "Basic Details" : p.step === "ageGroups" ? "Age Groups" : "Teams"}
                </Text>
                <ChevronRight size={14} color={colour.rugby700} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        )}

        {!!failure && (
          <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.danger, backgroundColor: colour.dangerSurface, padding: space.md, gap: 4 }}>
            <Text style={[type.smallMedium, { color: colour.danger }]}>The tournament was not created</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>{failure}</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>Nothing was saved. Your details are still here, so you can try again.</Text>
          </View>
        )}
      </ScrollView>

      <WizardFooter
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments/new/teams" as never))}
        primaryLabel="Create Tournament"
        onPrimary={() => void create()}
        primaryDisabled={problems.length > 0}
        primaryBusy={busy}
        primaryHint={problems.length > 0 ? problems[0].message : null}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------

function Card({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={[type.heading, { flex: 1, color: colour.ink }]}>{title}</Text>
        {onEdit && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${title}`} onPress={onEdit} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingLeft: space.sm })}>
            <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Edit</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  )
}

function Detail({ icon, value, secondary }: { icon: React.ReactNode; value: string; secondary?: string | null }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <View style={{ width: 18, alignItems: "center", paddingTop: 1 }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.small, { color: colour.ink }]}>{value}</Text>
        {!!secondary && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{secondary}</Text>}
      </View>
    </View>
  )
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  const isPublic = visibility === "public"
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
      {isPublic ? <Globe size={12} color={colour.inkMuted} strokeWidth={2} /> : <Lock size={12} color={colour.inkMuted} strokeWidth={2} />}
      <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{isPublic ? "Public" : "Private"}</Text>
    </View>
  )
}

function ClubBlock({ crestUrl, name, children }: { crestUrl: string | null; name: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ClubCrest url={crestUrl} name={name} size={26} />
        <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
          {name}
        </Text>
      </View>
      <View style={{ paddingLeft: space.lg, gap: 2 }}>{children}</View>
    </View>
  )
}

function SideRow({ kit, clubName, label, grade }: { kit: KitConfig | null; clubName: string; label: string; grade?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 34 }}>
      <TeamKit kit={kit} clubName={clubName} size={26} />
      <Text numberOfLines={1} style={[type.small, { flex: 1, color: colour.ink }]}>
        {label}
      </Text>
      {!!grade && <Text style={[type.caption, { color: colour.inkMuted }]}>{grade}</Text>}
    </View>
  )
}

/** Sides grouped under their club, in the order they were added. */
function groupByClub(sides: (DraftSide & { grade?: string })[]) {
  const out = new Map<string, { name: string; crestUrl: string | null; sides: (DraftSide & { grade?: string })[] }>()
  for (const s of sides) {
    const e = out.get(s.directoryId) ?? { name: s.clubName, crestUrl: s.crestUrl, sides: [] as (DraftSide & { grade?: string })[] }
    e.sides = [...e.sides, s]
    out.set(s.directoryId, e)
  }
  return [...out.entries()]
}

/** Every side belonging to a club that is not on Ovalball, carrying the grade it is entered at --
 * an external club may bring sides to more than one competition. */
function externalSides(ageGroups: { ageGroup: string; sides: DraftSide[] }[]) {
  return ageGroups.flatMap((g) => g.sides.filter((s) => !s.clubId).map((s) => ({ ...s, grade: g.ageGroup })))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function longDate(iso: string | null): string {
  if (!iso) return "No date"
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** A tournament is only multi-day when it actually ends on a later day. The switch can be on with
 * the end date still sitting on the start, and "30 Sep (Multi-day)" would be a line that contradicts
 * itself. */
function endsLater(startsOn: string | null, endsOn: string | null, multiDay: boolean): boolean {
  return multiDay && !!startsOn && !!endsOn && endsOn > startsOn
}

function dateLine(startsOn: string | null, startTime: string | null): string {
  return startTime ? `${longDate(startsOn)}  ·  ${startTime}` : longDate(startsOn)
}
