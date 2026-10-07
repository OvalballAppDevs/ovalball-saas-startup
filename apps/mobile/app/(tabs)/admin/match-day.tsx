import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, Switch, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  awardSettingName,
  effectiveAwardEnabled,
  readClubAwardSettings,
  setClubAwardCategory,
  setTeamAwardChoice,
  type ClubAwardSettings,
} from "@ovalball/contracts/match-centre/award-settings"
import {
  PUBLIC_PROFILE_SETTINGS,
  readClubPublicSharing,
  setClubPublicProfile,
  setTeamPublicProfile,
  type ClubPublicSharing,
  type PublicProfileSetting,
  type PublicProfileSettings,
  type TeamPublicProfileOverrides,
} from "@ovalball/contracts/match-centre/public-profiles"
import type { AwardCategoryKey } from "@ovalball/contracts/match-centre/rewards"

import { AdminScreen } from "../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../src/admin/access"
import { supabase } from "../../../src/auth/supabase"
import { AwardBadge } from "../../../src/components/player-identity"
import { ChevronDown, ChevronRight } from "../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { friendly } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * AWARDS & PUBLIC PAGES -- the club's match-day choices, and each team's own.
 *
 * MATCH AWARDS follow the owner's chain: the CLUB sets what every team runs, a TEAM may switch one on or
 * off for itself, and each match uses the team's choice if it made one and the club's otherwise. A team
 * row that follows the club says so, so nobody has to work out where an award came from.
 *
 * PUBLIC TEAM PAGES follow the same chain: the club's default for every team, then a team's own choice.
 * By default a page is public with its overview, cover photo and coaches, and the staff of a club the team
 * is playing may message and call it; the squad and photos stay off until somebody chooses to share them.
 * The server decides what a public page returns.
 *
 * One Save Changes for the whole screen, and nothing is written before it. The controls come from the
 * server's answer for this person at this club, and every write is checked again by the database.
 */
type Choice = boolean | null
type Draft = {
  clubAwards: Record<string, boolean>
  teamAwards: Record<string, Record<string, Choice>>
  clubProfile: PublicProfileSettings
  teamProfile: Record<string, TeamPublicProfileOverrides>
}

export default function MatchDaySettings() {
  const insets = useSafeAreaInsets()
  const { clubId } = useAdminCentreAccess()
  const [awards, setAwards] = useState<ClubAwardSettings | null>(null)
  const [sharing, setSharing] = useState<ClubPublicSharing | null>(null)
  const [authority, setAuthority] = useState({ club: false, teams: false })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const baseline = useMemo<Draft | null>(() => {
    if (!awards || !sharing) return null
    return {
      clubAwards: Object.fromEntries(awards.categories.map((c) => [c.key, awards.clubDefaults[c.key] ?? false])),
      teamAwards: Object.fromEntries(
        sharing.teams.map((t) => [t.teamId, Object.fromEntries(awards.categories.map((c) => [c.key, awards.teamOverrides[t.teamId]?.[c.key] ?? null]))])
      ),
      clubProfile: { ...sharing.club },
      teamProfile: Object.fromEntries(sharing.teams.map((t) => [t.teamId, { ...t.own }])),
    }
  }, [awards, sharing])

  const load = useCallback(async () => {
    if (!clubId) return
    setLoadError(null)
    try {
      const share = await readClubPublicSharing(supabase, clubId)
      const [settings, caps] = await Promise.all([
        readClubAwardSettings(supabase, clubId, share.teams.map((t) => t.teamId)),
        supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId }),
      ])
      const held = new Set((caps.data ?? []).filter((r) => r.allowed).map((r) => r.capability_key))
      setAuthority({ club: held.has("club.settings.manage") || held.has("club.profile.edit"), teams: held.has("team.news.manage") || held.has("club.profile.edit") })
      setSharing(share)
      setAwards(settings)
    } catch (caught) {
      setLoadError(friendly(caught, "these settings").message)
    }
  }, [clubId])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (baseline) setDraft(baseline)
  }, [baseline])

  const dirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline)

  async function save() {
    if (!draft || !baseline || !clubId) return
    setSaving(true)
    setProblem(null)
    setSaved(false)
    try {
      for (const [key, on] of Object.entries(draft.clubAwards)) {
        if (on !== baseline.clubAwards[key]) await setClubAwardCategory(supabase, clubId, key, on)
      }
      for (const [teamId, choices] of Object.entries(draft.teamAwards)) {
        for (const [key, choice] of Object.entries(choices)) {
          if (choice !== baseline.teamAwards[teamId]?.[key]) await setTeamAwardChoice(supabase, teamId, key, choice)
        }
      }
      const clubChanges = changedKeys(draft.clubProfile, baseline.clubProfile)
      if (Object.keys(clubChanges).length > 0) await setClubPublicProfile(supabase, clubId, clubChanges)
      for (const [teamId, own] of Object.entries(draft.teamProfile)) {
        const teamChanges = changedKeys(own, baseline.teamProfile[teamId] ?? {})
        if (Object.keys(teamChanges).length > 0) await setTeamPublicProfile(supabase, teamId, teamChanges)
      }
      setSaved(true)
      await load()
    } catch (caught) {
      setProblem(friendly(caught, "these settings").message)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const effective = (teamId: string, key: string) => {
    if (!draft || !awards) return false
    const own = draft.teamAwards[teamId]?.[key]
    return own ?? draft.clubAwards[key] ?? effectiveAwardEnabled(awards, teamId, key)
  }

  return (
    <AdminScreen
      section="Awards & Public Pages"
      onRefresh={() => void load()}
      footer={
        dirty ? (
          // The same save bar as Club Profile: one decision for the whole screen.
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.md,
              backgroundColor: colour.surface,
              borderTopWidth: 1,
              borderTopColor: colour.line,
              flexDirection: "row",
              gap: space.md,
            }}
          >
            <Button label="Discard" variant="secondary" style={{ flex: 1 }} disabled={saving} onPress={() => baseline && setDraft(baseline)} />
            <Button label="Save Changes" style={{ flex: 2 }} busy={saving} onPress={() => void save()} />
          </View>
        ) : undefined
      }
    >
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>Awards & Public Pages</Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>What every team runs on match day, and what a team's public page shows.</Text>
      </View>

      {!draft && !loadError && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {loadError && <ErrorState message={loadError} onRetry={() => void load()} />}

      {draft && awards && sharing && (
        <>
          {!!problem && (
            <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface }}>
              <Text style={[type.small, { color: colour.danger }]}>{problem}</Text>
            </View>
          )}
          {saved && !dirty && (
            <Text accessibilityLiveRegion="polite" style={[type.small, { color: colour.forest800 }]}>Saved. The next match uses these settings.</Text>
          )}

          <Section title="Match Awards" body="The club's default. Every team runs these unless it chooses otherwise below.">
            {awards.categories.map((c) => (
              <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 8 }}>
                <AwardBadge categoryKey={c.key as AwardCategoryKey} size={40} label={awardSettingName(c)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>{c.youthName}</Text>
                  {c.adultName !== c.youthName && <Text style={[type.caption, { color: colour.inkMuted }]}>{c.adultName} for adult sides</Text>}
                </View>
                <Switch
                  accessibilityLabel={`${awardSettingName(c)}, club default`}
                  value={draft.clubAwards[c.key] ?? false}
                  disabled={!authority.club}
                  onValueChange={(on) => setDraft({ ...draft, clubAwards: { ...draft.clubAwards, [c.key]: on } })}
                  trackColor={{ true: colour.pitch600, false: colour.lineStrong }}
                />
              </View>
            ))}
            {!authority.club && <Text style={[type.caption, { color: colour.inkMuted }]}>Changing the club's awards needs the Club Settings permission.</Text>}
          </Section>

          <Section title="Public Team Pages" body="The club's default for every team's public page. A team can choose differently below.">
            {PUBLIC_PROFILE_SETTINGS.map((setting) => (
              <ToggleRow
                key={setting.key}
                label={setting.label}
                hint={setting.detail}
                value={draft.clubProfile[setting.key]}
                disabled={!authority.club || (setting.key !== "profile_public" && !draft.clubProfile.profile_public && !OPPOSITION_KEYS.has(setting.key))}
                onChange={(on) => setDraft({ ...draft, clubProfile: { ...draft.clubProfile, [setting.key]: on } })}
              />
            ))}
            <Text style={[type.caption, { color: colour.inkMuted }]}>Message and Call are only ever offered to staff of a club playing the team — never to parents, players or the public. Call uses the team's or club's contact number, never a coach's own.</Text>
          </Section>

          <Section title="Team Choices" body="A team can run an award, or set its public page, differently from the club.">
            {sharing.teams.length === 0 && <Text style={[type.small, { color: colour.inkMuted }]}>This club has no active teams.</Text>}
            {sharing.teams.map((t) => {
              const changes =
                Object.values(draft.teamAwards[t.teamId] ?? {}).filter((v) => v !== null).length +
                Object.values(draft.teamProfile[t.teamId] ?? {}).filter((v) => v !== null && v !== undefined).length
              const expanded = open === t.teamId
              return (
                <View key={t.teamId} style={{ borderTopWidth: 1, borderTopColor: colour.line }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${t.name}. ${changes === 0 ? "Follows the club" : `${changes} of its own choices`}`}
                    onPress={() => setOpen(expanded ? null : t.teamId)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET + 8, opacity: pressed ? 0.7 : 1 })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyMedium, { color: colour.ink }]}>{t.name}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{changes === 0 ? "Follows the club" : `${changes} of its own ${changes === 1 ? "choice" : "choices"}`}</Text>
                    </View>
                    {expanded ? <ChevronDown size={18} color={colour.inkSubtle} /> : <ChevronRight size={18} color={colour.inkSubtle} />}
                  </Pressable>
                  {expanded && (
                    <View style={{ gap: space.md, paddingBottom: space.md }}>
                      {awards.categories.map((c) => (
                        <TriState
                          key={c.key}
                          label={awardSettingName(c)}
                          value={draft.teamAwards[t.teamId]?.[c.key] ?? null}
                          clubValue={draft.clubAwards[c.key] ?? false}
                          effective={effective(t.teamId, c.key)}
                          disabled={!authority.teams}
                          onChange={(v) => setDraft({ ...draft, teamAwards: { ...draft.teamAwards, [t.teamId]: { ...(draft.teamAwards[t.teamId] ?? {}), [c.key]: v } } })}
                        />
                      ))}
                      {PUBLIC_PROFILE_SETTINGS.map((setting) => {
                        const own = draft.teamProfile[t.teamId]?.[setting.key] ?? null
                        return (
                          <TriState
                            key={setting.key}
                            label={setting.label}
                            words={setting.key.startsWith("opposition_") ? { on: "Offered to the opposition's staff", off: "Not offered" } : { on: "On the public page", off: "Not shown" }}
                            value={own}
                            clubValue={draft.clubProfile[setting.key]}
                            effective={own ?? draft.clubProfile[setting.key]}
                            disabled={!authority.club}
                            onChange={(v) => setDraft({ ...draft, teamProfile: { ...draft.teamProfile, [t.teamId]: { ...(draft.teamProfile[t.teamId] ?? {}), [setting.key]: v } as TeamPublicProfileOverrides } })}
                          />
                        )
                      })}
                    </View>
                  )}
                </View>
              )
            })}
          </Section>
        </>
      )}
    </AdminScreen>
  )
}

/** Message and Call concern the opposition's staff, not the public page, so they stand on their own. */
const OPPOSITION_KEYS = new Set<PublicProfileSetting>(["opposition_can_message", "opposition_can_call"])

function changedKeys<T extends Record<string, unknown>>(next: T, was: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== was[k as keyof T])) as Partial<T>
}

function Section({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{body}</Text>
      </View>
      <Card style={{ gap: space.xs }}>{children}</Card>
    </View>
  )
}

function ToggleRow({ label, hint, value, disabled, onChange }: { label: string; hint: string; value: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>{label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{hint}</Text>
      </View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} />
    </View>
  )
}

/** Follow the club, or the team's own On / Off -- with what the club's choice currently is. */
function TriState({
  label,
  value,
  clubValue,
  effective,
  disabled,
  onChange,
  words = { on: "Runs for this team", off: "Not run" },
}: {
  label: string
  value: Choice
  clubValue: boolean
  effective: boolean
  disabled: boolean
  onChange: (v: Choice) => void
  /** What the effective answer means for this row: an award runs, a page shows something. */
  words?: { on: string; off: string }
}) {
  const options: { v: Choice; text: string }[] = [
    { v: null, text: `Club (${clubValue ? "On" : "Off"})` },
    { v: true, text: "On" },
    { v: false, text: "Off" },
  ]
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>
        {label} <Text style={[type.caption, { color: effective ? colour.forest800 : colour.inkMuted }]}>· {effective ? words.on : words.off}</Text>
      </Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, overflow: "hidden", opacity: disabled ? 0.5 : 1 }}>
        {options.map((o, i) => {
          const selected = value === o.v
          return (
            <Pressable
              key={String(o.v)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${label}: ${o.text}`}
              disabled={disabled}
              onPress={() => onChange(o.v)}
              style={{ flex: 1, minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colour.forest800 : colour.surface, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: colour.lineStrong }}
            >
              <Text style={[type.smallMedium, { color: selected ? colour.chalk : colour.ink }]}>{o.text}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
