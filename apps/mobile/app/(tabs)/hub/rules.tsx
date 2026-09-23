import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import {
  getRugbyHubIdentityContext,
  getRulesBundle,
  getRulesBundleByIdentity,
  getSourceMetadata,
  type DomainResult,
  type RulesByIdentityRow,
  type RulesRow,
  type SourceMetadata,
} from "@ovalball/contracts/rugby-hub/rugby-hub-data"
import { RULES_SECTION_LABELS, formatRulesValue, groupPitchDimensions } from "@ovalball/contracts/rugby-hub/rugby-hub-format"

import { supabase } from "../../../src/auth/supabase"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { oneParam } from "../../../src/hub/bundles"
import { useHubIdentity } from "../../../src/hub/identity"
import { HubScreen } from "../../../src/hub/screen"
import { hubTeamPossessive, HubTeamSwitch } from "../../../src/hub/team"
import { HubContextStrip, HubFactCard, HubFailed, HubHero, HubLoading, HubNotice, HubOverline, Strong } from "../../../src/hub/ui"
import { space } from "../../../src/design/tokens"

type Row = RulesRow | RulesByIdentityRow

/**
 * RULES — the laws of the game for THIS team's age grade, from the governing body.
 *
 * Two modes, the website's two. OWN: the viewer's active team resolves to a
 * regulatory identity and `get_rugby_hub_rules` answers for it (or explains
 * why not: no direct regulation for this age group, not yet mapped, still
 * under review). BROWSE: reached from a search result with `?identity=`, shows
 * a real identity's published rules whoever is looking, under a banner that
 * says so -- never mistaken for one's own team's rules, and never silently
 * falling back to them.
 *
 * NOTHING HERE IS OVALBALL'S. Every card carries the governing body's own
 * value, its tier ("General Law" or "Your Age Grade's Variation") and a link to
 * the registered source. A `#section-X` in the link scrolls to that card.
 */
export default function RulesScreen() {
  const params = useLocalSearchParams<{ identity?: string; section?: string }>()
  const browseIdentity = oneParam(params.identity)
  const wantedSection = oneParam(params.section)
  const { teamId, team, identity, loading: identityLoading } = useHubIdentity()

  const [result, setResult] = useState<DomainResult<Row> | null>(null)
  const [reason, setReason] = useState<"no-mapping" | "unmapped" | null>(null)
  const [sources, setSources] = useState<Map<string, SourceMetadata>>(new Map())
  const [error, setError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(true)
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    setReason(null)
    try {
      let r: DomainResult<Row>
      if (browseIdentity) {
        r = await getRulesBundleByIdentity(supabase, browseIdentity)
      } else if (!teamId) {
        r = { status: "empty" }
      } else {
        const ctx = identity ?? (await getRugbyHubIdentityContext(supabase, teamId))
        if (ctx.mappingType === "NO_DIRECT_MAPPING") {
          setReason("no-mapping")
          r = { status: "no-mapping" }
        } else if (!ctx.regulatoryIdentityId) {
          setReason("unmapped")
          r = { status: "empty" }
        } else {
          r = await getRulesBundle(supabase, teamId, ctx)
        }
      }
      setResult(r)
      if (r.status === "content") setSources(await getSourceMetadata(supabase, r.rows.map((x) => x.primary_source_key)))
    } catch (cause) {
      const translated = friendly(cause, "the rules")
      logDetail("hub:rules", translated)
      setError(translated)
    } finally {
      setBusy(false)
    }
  }, [browseIdentity, teamId, identity])

  useEffect(() => {
    if (identityLoading) return
    void load()
  }, [load, identityLoading])

  // Scroll to the requested section once its card has laid out.
  useEffect(() => {
    if (!wantedSection || !result || result.status !== "content") return
    const t = setTimeout(() => {
      const y = offsets.current.get(wantedSection)
      if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true })
    }, 250)
    return () => clearTimeout(t)
  }, [wantedSection, result])

  const rows = result?.status === "content" ? result.rows : []
  const browseCodeLabel = (rows[0] as RulesByIdentityRow | undefined)?.identity_rugby_code === "league" ? "Rugby League" : "Rugby Union"
  const browseLabel = (rows[0] as RulesByIdentityRow | undefined)?.identity_label ?? "this age group"

  return (
    <HubScreen ref={scroll} section="Learn the Game" onRefresh={load} refreshing={!!result && busy}>
      <HubHero
        title="Rules"
        intro={`Playing rules for ${browseIdentity ? "the age group you chose" : hubTeamPossessive(team)}. This reflects the currently published rules for this age group and rugby code — it is not necessarily the complete official regulation. Check with your club or the governing body directly for anything not covered here.`}
      />

      {!browseIdentity && <HubTeamSwitch />}

      {browseIdentity && rows.length > 0 && (
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
          {!reason && result.status === "error" && <HubNotice tone="unavailable" message="Rules for this context are temporarily unavailable. Please try again shortly." />}
          {!reason && result.status === "no-mapping" && <HubNotice tone="no-mapping" message="There isn't a separate official Rules-of-Play regulation for this specific age group." />}
          {!reason && teamId && result.status === "empty" && !browseIdentity && <HubNotice tone="reviewing" message="Detailed rules for this age group are being reviewed and aren't published here yet." />}
          {browseIdentity && (result.status === "empty" || result.status === "no-mapping") && <HubNotice tone="reviewing" message="No published rules were found for that age group." />}
          {result.status === "content" && <RulesCards rows={rows} sources={sources} wanted={wantedSection} onLayoutSection={(k, y) => offsets.current.set(k, y)} />}
        </>
      )}
    </HubScreen>
  )
}

function tierLabelFor(row: Row): string | null {
  if (row.is_tier1_variation == null) return null
  return row.is_tier1_variation ? "Your Age Grade's Variation" : "General Law"
}

function sourceFor(row: Row | undefined, sources: Map<string, SourceMetadata>) {
  const meta = row?.primary_source_key ? sources.get(row.primary_source_key) : undefined
  if (!row?.primary_source_key || !meta) return null
  return { authority: meta.authorityName, title: meta.title, url: meta.canonicalUrl, locator: row.primary_source_locator ?? null }
}

function RulesCards({ rows, sources, wanted, onLayoutSection }: { rows: Row[]; sources: Map<string, SourceMetadata>; wanted: string | null; onLayoutSection: (sectionKey: string, y: number) => void }) {
  const { length, width, rest } = groupPitchDimensions(rows)
  const order: string[] = []
  const bySection = new Map<string, Row[]>()
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
