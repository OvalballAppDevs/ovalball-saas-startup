import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import {
  getSourceMetadata,
  getWelfareBundle,
  getWelfareBundleByIdentity,
  type DomainResult,
  type SourceMetadata,
  type WelfareByIdentityRow,
  type WelfareRow,
} from "@ovalball/contracts/rugby-hub/rugby-hub-data"
import { WELFARE_SECTION_LABELS, formatWelfareValue, labelForObligation } from "@ovalball/contracts/rugby-hub/rugby-hub-format"

import { supabase } from "../../../src/auth/supabase"
import { friendly, logDetail, type FriendlyError } from "../../../src/errors/translate"
import { codeParam, oneParam } from "../../../src/hub/bundles"
import { useHubIdentity } from "../../../src/hub/identity"
import { HubScreen } from "../../../src/hub/screen"
import { hubTeamPossessive, HubTeamSwitch } from "../../../src/hub/team"
import { HubContextStrip, HubFactCard, HubFailed, HubHero, HubLoading, HubNotice, Strong } from "../../../src/hub/ui"
import { space } from "../../../src/design/tokens"

type Row = WelfareRow | WelfareByIdentityRow

/**
 * PLAYER WELFARE — concussion and welfare guidance from the governing body,
 * for this team's age grade and this viewer's audience (a parent reads the
 * parent-authored wording, a player the player's). Guidance, never an
 * Ovalball medical clearance decision. Browse mode (`?code=` and optional
 * `?identity=`) shows one code's published guidance under a banner.
 */
export default function PlayerWelfareScreen() {
  const params = useLocalSearchParams<{ code?: string; identity?: string; section?: string }>()
  const browseCode = codeParam(params.code)
  const browseIdentity = oneParam(params.identity)
  const wanted = oneParam(params.section)
  const { teamId, team, audience, loading: identityLoading } = useHubIdentity()
  const [result, setResult] = useState<DomainResult<Row> | null>(null)
  const [sources, setSources] = useState<Map<string, SourceMetadata>>(new Map())
  const [error, setError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(true)
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r: DomainResult<Row> = browseCode ? await getWelfareBundleByIdentity(supabase, browseCode, browseIdentity) : teamId ? await getWelfareBundle(supabase, teamId, audience) : { status: "empty" }
      setResult(r)
      if (r.status === "content") setSources(await getSourceMetadata(supabase, r.rows.map((x) => x.primary_source_key)))
    } catch (cause) {
      const translated = friendly(cause, "player-welfare guidance")
      logDetail("hub:welfare", translated)
      setError(translated)
    } finally {
      setBusy(false)
    }
  }, [browseCode, browseIdentity, teamId, audience])

  useEffect(() => {
    if (identityLoading) return
    void load()
  }, [load, identityLoading])

  useEffect(() => {
    if (!wanted || result?.status !== "content") return
    const t = setTimeout(() => {
      const y = offsets.current.get(wanted)
      if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true })
    }, 250)
    return () => clearTimeout(t)
  }, [wanted, result])

  const rows = result?.status === "content" ? result.rows : []
  const identityLabel = (rows[0] as WelfareByIdentityRow | undefined)?.identity_label ?? null

  return (
    <HubScreen ref={scroll} section="Welfare & Support" onRefresh={load} refreshing={!!result && busy}>
      <HubHero
        title="Player Welfare"
        intro={browseCode ? undefined : `Concussion and player-welfare guidance for ${hubTeamPossessive(team)}, published by the governing body. This is guidance, never an Ovalball medical clearance decision.`}
      />
      {!browseCode && <HubTeamSwitch />}
      {browseCode && (
        <HubContextStrip>
          <Text>
            Showing {browseCode === "league" ? "Rugby League" : "Rugby Union"} player-welfare guidance{identityLabel ? <Text> for <Strong>{identityLabel}</Strong></Text> : null} — not necessarily your own team's guidance.
          </Text>
        </HubContextStrip>
      )}

      {(identityLoading || (busy && !result)) && <HubLoading />}
      {error && <HubFailed error={error} onRetry={() => void load()} />}

      {!error && result && !identityLoading && (
        <>
          {!browseCode && !teamId && <HubNotice tone="unavailable" message="No team relationship available to show player-welfare guidance for." />}
          {result.status === "error" && <HubNotice tone="unavailable" message="Player-welfare guidance is temporarily unavailable. Please try again shortly." />}
          {result.status === "no-mapping" && <HubNotice tone="no-mapping" message="There isn't a separate official player-welfare identity for this context." />}
          {result.status === "empty" && (browseCode || teamId) && (
            <HubNotice tone="reviewing" message={browseCode ? "No published player-welfare guidance was found for that context." : "Detailed player-welfare guidance for this context is being reviewed and isn't published here yet."} />
          )}
          {result.status === "content" && (
            <View style={{ gap: space.md }}>
              {rows.map((row) => {
                const meta = row.primary_source_key ? sources.get(row.primary_source_key) : undefined
                return (
                  <View key={`${row.fact_id ?? ""}-${row.section_key}`} onLayout={(e) => offsets.current.set(row.section_key, e.nativeEvent.layout.y)}>
                    <HubFactCard
                      title={WELFARE_SECTION_LABELS[row.section_key] ?? row.section_key}
                      valueDisplay={row.value_integer != null ? formatWelfareValue(row) : null}
                      body={row.body ?? (row.value_integer == null ? row.value_text : null)}
                      obligation={labelForObligation(row.obligation_level)}
                      source={meta && row.primary_source_key ? { authority: meta.authorityName, title: meta.title, url: meta.canonicalUrl, locator: row.primary_source_locator ?? null } : null}
                      highlighted={wanted === row.section_key}
                    />
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}
    </HubScreen>
  )
}
