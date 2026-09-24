import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import {
  getRugbyHubIdentityContext,
  getRulesBundle,
  getRulesBundleByIdentity,
  getRulesOfPlayBundle,
  getRulesOfPlayBundleByIdentity,
  getSourceMetadata,
  type DomainResult,
  type RulesByIdentityRow,
  type RulesOfPlayRow,
  type RulesRow,
  type SourceMetadata,
} from "@ovalball/contracts/rugby-hub/rugby-hub-data"
import { RULES_SECTION_LABELS, formatRulesValue, groupPitchDimensions, groupRulesOfPlay, labelForObligation, presentPitch, presentRuleOfPlay } from "@ovalball/contracts/rugby-hub/rugby-hub-format"

import { supabase } from "../../../src/auth/supabase"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { CODE_LABEL, oneParam } from "../../../src/hub/bundles"
import { useHubIdentity } from "../../../src/hub/identity"
import { HubScreen } from "../../../src/hub/screen"
import { HubContextLine, hubTeamPossessive, HubTeamSwitch } from "../../../src/hub/team"
import { HubContextStrip, HubFactCard, HubFailed, HubHero, HubHeading, HubLoading, HubNotice, HubOverline, HubParagraph, Strong } from "../../../src/hub/ui"
import { colour, space, type } from "../../../src/design/tokens"

type LawRow = RulesRow | RulesByIdentityRow

interface Layers {
  laws: DomainResult<LawRow>
  rulesOfPlay: DomainResult<RulesOfPlayRow>
}

/**
 * RULES — one screen, two layers, for THIS team's age grade (RH-M0.2). The
 * website's page, natively.
 *
 * GENERAL LAWS are the laws of the game every age grade shares. RULES OF PLAY
 * are the governing body's own variations for this age grade — players,
 * pitch, ball, contact, kicking, scrum, restarts, substitutions, eligibility —
 * read through the same shared readers the website uses, from the regulatory
 * identity the team's canonical type maps to. Nothing here names an age: the
 * server says which identity a team is, and the categories come from the
 * register.
 *
 * Two modes, the website's two. OWN: the selected context's team. BROWSE:
 * reached from a search result with `?identity=`, a real identity's rules
 * whoever is looking, under a banner that says so. A `?section=` scrolls to
 * that category or section once it has laid out.
 */
export default function RulesScreen() {
  const params = useLocalSearchParams<{ identity?: string; section?: string }>()
  const browseIdentity = oneParam(params.identity)
  const wantedSection = oneParam(params.section)
  const { teamId, team, identity, loading: identityLoading } = useHubIdentity()

  const [result, setResult] = useState<Layers | null>(null)
  const [reason, setReason] = useState<"no-mapping" | "unmapped" | null>(null)
  const [sources, setSources] = useState<Map<string, SourceMetadata>>(new Map())
  const [error, setError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(true)
  const scroll = useRef<ScrollView>(null)
  /** Section key -> y within its layer; layer -> y within the screen. Summed when a deep link asks for a section. */
  const offsets = useRef(new Map<string, { layer: "laws" | "play"; y: number }>())
  const layerOffsets = useRef(new Map<"laws" | "play", number>())

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    setReason(null)
    try {
      let layers: Layers
      if (browseIdentity) {
        const [laws, rulesOfPlay] = await Promise.all([getRulesBundleByIdentity(supabase, browseIdentity), getRulesOfPlayBundleByIdentity(supabase, browseIdentity)])
        layers = { laws, rulesOfPlay }
      } else if (!teamId) {
        layers = { laws: { status: "empty" }, rulesOfPlay: { status: "empty" } }
      } else {
        const ctx = identity ?? (await getRugbyHubIdentityContext(supabase, teamId))
        if (ctx.mappingType === "NO_DIRECT_MAPPING") {
          setReason("no-mapping")
          layers = { laws: { status: "no-mapping" }, rulesOfPlay: { status: "no-mapping" } }
        } else if (!ctx.regulatoryIdentityId) {
          setReason("unmapped")
          layers = { laws: { status: "empty" }, rulesOfPlay: { status: "empty" } }
        } else {
          const [laws, rulesOfPlay] = await Promise.all([getRulesBundle(supabase, teamId, ctx), getRulesOfPlayBundle(supabase, teamId, ctx)])
          layers = { laws, rulesOfPlay }
        }
      }
      setResult(layers)
      const keys = [...(layers.laws.status === "content" ? layers.laws.rows : []).map((x) => x.primary_source_key), ...(layers.rulesOfPlay.status === "content" ? layers.rulesOfPlay.rows : []).map((x) => x.primary_source_key)]
      if (keys.length > 0) setSources(await getSourceMetadata(supabase, keys))
    } catch (cause) {
      const translated = friendly(cause, "the rules")
      logDetail("hub:rules", translated)
      setError(translated)
    } finally {
      setBusy(false)
    }
  }, [browseIdentity, teamId, identity])

  // A NEW TEAM MEANS A BLANK PAGE, NOT THE OLD TEAM'S ROWS WHILE THE NEW ONES LOAD.
  // The scope names every dimension the answer depends on; when it changes the
  // previous result is dropped before the next read starts, so nothing from Ava's
  // team can be on screen under Ben's name for even a moment.
  const scope = `${browseIdentity ?? ""}|${teamId ?? ""}`
  useEffect(() => {
    setResult(null)
    setSources(new Map())
    offsets.current.clear()
    layerOffsets.current.clear()
  }, [scope])

  useEffect(() => {
    if (identityLoading) return
    void load()
  }, [load, identityLoading])

  // Scroll to the requested section or category once its card has laid out.
  useEffect(() => {
    if (!wantedSection || !result) return
    const t = setTimeout(() => {
      const at = offsets.current.get(wantedSection)
      if (at) scroll.current?.scrollTo({ y: Math.max(0, (layerOffsets.current.get(at.layer) ?? 0) + at.y - space.md), animated: true })
    }, 250)
    return () => clearTimeout(t)
  }, [wantedSection, result])

  const lawRows: LawRow[] = result?.laws.status === "content" ? result.laws.rows : []
  const playRows: RulesOfPlayRow[] = result?.rulesOfPlay.status === "content" ? result.rulesOfPlay.rows : []
  const anyContent = lawRows.length > 0 || playRows.length > 0
  const anyError = result?.laws.status === "error" || result?.rulesOfPlay.status === "error"
  const browseFirst = (lawRows[0] as RulesByIdentityRow | undefined) ?? playRows[0]
  const browseCodeLabel = CODE_LABEL[(browseFirst?.identity_rugby_code as "union" | "league" | undefined) ?? "union"]
  const browseLabel = browseFirst?.identity_label ?? "this age group"
  const who = browseIdentity ? browseLabel : team ? (team.childName ? `${team.childName}'s ${team.teamDisplayName}` : team.teamDisplayName) : "your team"
  const code = browseIdentity ? browseCodeLabel : identity?.rugbyCode ? CODE_LABEL[identity.rugbyCode] : null

  return (
    <HubScreen ref={scroll} section="Learn the Game" onRefresh={load} refreshing={!!result && busy}>
      <HubHero
        title="Rules"
        intro={`The laws of the game, and the Rules of Play for ${browseIdentity ? "the age group you chose" : hubTeamPossessive(team)}. This reflects the currently published rules for this age group and rugby code — it is not necessarily the complete official regulation. Check with your club or the governing body directly for anything not covered here.`}
      />

      {!browseIdentity && (
        <View style={{ gap: space.sm }}>
          <HubContextLine subject="Rules" />
          <HubTeamSwitch />
        </View>
      )}

      {browseIdentity && anyContent && (
        <HubContextStrip>
          <Text>
            Showing rules for <Strong>{browseLabel}</Strong> ({browseCodeLabel}) — not necessarily your own team's rules.
          </Text>
        </HubContextStrip>
      )}

      {(identityLoading || (busy && !result)) && <HubLoading />}
      {error && <HubFailed error={error} onRetry={() => void load()} />}

      {!error && result && !identityLoading && (
        <>
          {!browseIdentity && !teamId && <HubNotice tone="unavailable" message="No team relationship available to show rules for." />}
          {reason === "no-mapping" && <HubNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group. Ovalball does not invent one — check with your club for locally-agreed playing arrangements." />}
          {reason === "unmapped" && <HubNotice tone="reviewing" message="This age group hasn't been mapped to a regulatory identity yet — age-grade rules aren't available here for it." />}
          {!reason && anyError && <HubNotice tone="unavailable" message="Rules for this context are temporarily unavailable. Please try again shortly." />}
          {!reason && !anyError && !anyContent && teamId && !browseIdentity && <HubNotice tone="reviewing" message="Detailed rules for this age group are being reviewed and aren't published here yet." />}
          {browseIdentity && !anyError && !anyContent && <HubNotice tone="reviewing" message="No published rules were found for that age group." />}

          {!reason && !anyError && anyContent && (
            <View style={{ gap: space.xl }}>
              <View style={{ gap: space.sm }} onLayout={(e) => layerOffsets.current.set("laws", e.nativeEvent.layout.y)}>
                <HubHeading>General Laws</HubHeading>
                <HubParagraph>The laws of the game every age grade plays under.</HubParagraph>
                {lawRows.length > 0 ? (
                  <RulesCards rows={lawRows} sources={sources} wanted={wantedSection} onLayoutSection={(k, y) => offsets.current.set(k, { layer: "laws", y })} />
                ) : (
                  <HubNotice tone="reviewing" message="The general laws for this rugby code are being reviewed and aren't published here yet." />
                )}
              </View>

              <View style={{ gap: space.sm }} onLayout={(e) => layerOffsets.current.set("play", e.nativeEvent.layout.y)}>
                <Text accessibilityRole="header" style={[type.displaySmall, { color: colour.ink }]}>
                  Rules of Play for {who}
                  {code ? <Text style={{ color: colour.inkMuted }}> · {code}</Text> : null}
                </Text>
                <HubParagraph>The governing body's own variations for this age grade.</HubParagraph>
                {playRows.length > 0 ? (
                  <RulesOfPlayCards
                    rows={playRows}
                    sources={sources}
                    wanted={wantedSection}
                    pitchAnchorTaken={lawRows.some((r) => r.fact_type === "PITCH_LENGTH" || r.fact_type === "PITCH_WIDTH")}
                    onLayoutSection={(k, y) => offsets.current.set(k, { layer: "play", y })}
                  />
                ) : (
                  <HubNotice tone="reviewing" message="No separate age-grade Rules of Play are published for this age group yet — the general laws above apply." />
                )}
              </View>
            </View>
          )}
        </>
      )}
    </HubScreen>
  )
}

function tierLabelFor(row: LawRow): string | null {
  if (row.is_tier1_variation == null) return null
  return row.is_tier1_variation ? "Your Age Grade's Variation" : "General Law"
}

function sourceFor(row: { primary_source_key: string | null; primary_source_locator: string | null } | undefined, sources: Map<string, SourceMetadata>) {
  const meta = row?.primary_source_key ? sources.get(row.primary_source_key) : undefined
  if (!row?.primary_source_key || !meta) return null
  return { authority: meta.authorityName, title: meta.title, url: meta.canonicalUrl, locator: row.primary_source_locator ?? null }
}

function RulesCards({ rows, sources, wanted, onLayoutSection }: { rows: LawRow[]; sources: Map<string, SourceMetadata>; wanted: string | null; onLayoutSection: (sectionKey: string, y: number) => void }) {
  const { length, width, rest } = groupPitchDimensions(rows)
  const order: string[] = []
  const bySection = new Map<string, LawRow[]>()
  for (const row of rest) {
    if (!bySection.has(row.section_key)) {
      bySection.set(row.section_key, [])
      order.push(row.section_key)
    }
    bySection.get(row.section_key)!.push(row)
  }
  const pitch = length ?? width
  return (
    <View style={{ gap: space.md }}>
      {pitch && (
        <View onLayout={(e) => onLayoutSection("PITCH", e.nativeEvent.layout.y)}>
          <HubFactCard
            title="Pitch"
            valueDisplay={[length ? `Length: ${formatRulesValue(length)}` : null, width ? `Width: ${formatRulesValue(width)}` : null].filter(Boolean).join(" · ")}
            tierLabel={tierLabelFor(pitch)}
            source={sourceFor(pitch, sources)}
            highlighted={wanted === "PITCH"}
          />
        </View>
      )}
      {order.map((sectionKey) => {
        const sectionRows = bySection.get(sectionKey)!
        const label = RULES_SECTION_LABELS[sectionKey] ?? sectionKey
        return (
          <View key={sectionKey} style={{ gap: space.sm }} onLayout={(e) => onLayoutSection(sectionKey, e.nativeEvent.layout.y)}>
            {sectionRows.length > 1 && <HubOverline>{label}</HubOverline>}
            {sectionRows.map((row) => (
              <HubFactCard
                key={row.fact_id}
                title={row.display_title ?? label}
                valueDisplay={formatRulesValue(row)}
                isOverlay={row.is_overlay ?? false}
                tierLabel={tierLabelFor(row)}
                source={sourceFor(row, sources)}
                highlighted={wanted === sectionKey}
              />
            ))}
          </View>
        )
      })}
    </View>
  )
}

/**
 * The Rules of Play, one group per governing-body category in the shared canonical order
 * (RULES_OF_PLAY_CATEGORIES) -- the same grouping, order, titles and bodies the website renders.
 * A deep link's section is the category; PITCH yields to the General Laws' own pitch card when
 * both exist, exactly as on the website.
 */
function RulesOfPlayCards({ rows, sources, wanted, pitchAnchorTaken, onLayoutSection }: { rows: RulesOfPlayRow[]; sources: Map<string, SourceMetadata>; wanted: string | null; pitchAnchorTaken: boolean; onLayoutSection: (sectionKey: string, y: number) => void }) {
  const groups = groupRulesOfPlay(rows)
  return (
    <View style={{ gap: space.md }}>
      {groups.map((group) => {
        const anchors = !(group.key === "PITCH" && pitchAnchorTaken)
        const pitch = group.key === "PITCH" ? presentPitch(group.rows) : null
        const cardRows = pitch ? pitch.rest : group.rows
        const lengthOrWidth = pitch ? group.rows.find((r) => r.fact_type === "PITCH_LENGTH") ?? group.rows.find((r) => r.fact_type === "PITCH_WIDTH") : undefined
        const highlighted = anchors && wanted === group.key
        const cardCount = cardRows.length + (pitch?.headline && lengthOrWidth ? 1 : 0)
        return (
          <View key={group.key} style={{ gap: space.sm }} onLayout={(e) => anchors && onLayoutSection(group.key, e.nativeEvent.layout.y)}>
            {cardCount > 1 && <HubOverline>{group.label}</HubOverline>}
            {pitch?.headline && lengthOrWidth && (
              <HubFactCard title="Pitch" valueDisplay={pitch.headline} body={pitch.body} obligation={labelForObligation(lengthOrWidth.obligation_level)} source={sourceFor(lengthOrWidth, sources)} highlighted={highlighted} />
            )}
            {cardRows.map((row) => {
              const p = presentRuleOfPlay(row)
              return <HubFactCard key={row.fact_id} title={p.title} valueDisplay={p.headline} body={p.body} obligation={labelForObligation(row.obligation_level)} source={sourceFor(row, sources)} highlighted={highlighted} />
            })}
          </View>
        )
      })}
    </View>
  )
}
