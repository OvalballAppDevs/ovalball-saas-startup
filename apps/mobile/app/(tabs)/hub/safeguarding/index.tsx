import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import {
  contactableOfficers,
  getSafeguardingBundleByIdentity,
  getSafeguardingContent,
  getSafeguardingOfficerProjections,
  getSafeguardingRoutes,
  getSourceMetadata,
  type DomainResult,
  type SafeguardingByIdentityRow,
  type SafeguardingContentRow,
  type SafeguardingOfficerProjection,
  type SafeguardingRouteRow,
  type SourceMetadata,
} from "@ovalball/contracts/rugby-hub/rugby-hub-data"
import { SAFEGUARDING_SECTION_LABELS } from "@ovalball/contracts/rugby-hub/rugby-hub-format"

import { supabase } from "../../../../src/auth/supabase"
import { MessageCircleWarning, Shield, UserRound } from "../../../../src/components/icons"
import { Button, Card } from "../../../../src/components/ui"
import { webUrl } from "../../../../src/config/environment"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { codeParam, oneParam } from "../../../../src/hub/bundles"
import { useHubIdentity } from "../../../../src/hub/identity"
import { openExternal } from "../../../../src/hub/routes"
import { HubScreen } from "../../../../src/hub/screen"
import { hubTeamPossessive, HubTeamSwitch } from "../../../../src/hub/team"
import { HubContextStrip, HubFactCard, HubFailed, HubHeading, HubHero, HubLoading, HubNotice, HubOfficialSource, HubTextLink, Strong } from "../../../../src/hub/ui"
import { colour, space, type } from "../../../../src/design/tokens"

type ContentRow = SafeguardingContentRow | SafeguardingByIdentityRow

/**
 * SAFEGUARDING — three deliberately separate blocks, as on the web.
 *
 * YOUR CLUB SAFEGUARDING OFFICER: a local contact, drawn from the club's own
 * registered officer record through RLS, and never visually confused with the
 * governing body's official route. Contacting them hands off to the one
 * existing mechanism: an Ovalball conversation (through the existing
 * `start_or_get_safeguarding_officer_conversation` RPC) for an officer who is
 * an active user, or email for one who is not.
 *
 * OFFICIAL SAFEGUARDING GUIDANCE and OFFICIAL REPORTING ROUTES: the governing
 * body's published words and contacts, each with its source.
 *
 * WHAT IS NEVER HERE: any concern, case, report or record. This is PUBLIC
 * guidance and a way to reach a person. Safeguarding operational data has no
 * route in the Hub and none is read by this screen.
 */
export default function SafeguardingScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string; identity?: string; section?: string }>()
  const browseCode = codeParam(params.code)
  const browseIdentity = oneParam(params.identity)
  const wanted = oneParam(params.section)
  const { teamId, team, audience, loading: identityLoading } = useHubIdentity()
  const [content, setContent] = useState<DomainResult<ContentRow> | null>(null)
  const [routes, setRoutes] = useState<DomainResult<SafeguardingRouteRow> | null>(null)
  const [officers, setOfficers] = useState<SafeguardingOfficerProjection[]>([])
  const [sources, setSources] = useState<Map<string, SourceMetadata>>(new Map())
  const [error, setError] = useState<FriendlyError | null>(null)
  const [busy, setBusy] = useState(true)
  const scroll = useRef<ScrollView>(null)
  const offsets = useRef(new Map<string, number>())

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (browseCode) {
        const r = await getSafeguardingBundleByIdentity(supabase, browseCode, browseIdentity)
        setContent(r)
        setRoutes(null)
        setOfficers([])
        setSources(await getSourceMetadata(supabase, r.status === "content" ? r.rows.map((x) => x.primary_source_key) : []))
      } else if (!teamId) {
        setContent({ status: "empty" })
        setRoutes({ status: "empty" })
        setOfficers([])
      } else {
        const [c, r, o] = await Promise.all([getSafeguardingContent(supabase, teamId, audience), getSafeguardingRoutes(supabase, teamId), team ? getSafeguardingOfficerProjections(supabase, team.clubId) : Promise.resolve([])])
        setContent(c)
        setRoutes(r)
        setOfficers(contactableOfficers(o))
        setSources(await getSourceMetadata(supabase, [...(c.status === "content" ? c.rows.map((x) => x.primary_source_key) : []), ...(r.status === "content" ? r.rows.map((x) => x.primary_source_key) : [])]))
      }
    } catch (cause) {
      const translated = friendly(cause, "safeguarding guidance")
      logDetail("hub:safeguarding", translated)
      setError(translated)
    } finally {
      setBusy(false)
    }
  }, [browseCode, browseIdentity, teamId, team, audience])

  useEffect(() => {
    if (identityLoading) return
    void load()
  }, [load, identityLoading])

  useEffect(() => {
    if (!wanted || content?.status !== "content") return
    const t = setTimeout(() => {
      const y = offsets.current.get(wanted)
      if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true })
    }, 250)
    return () => clearTimeout(t)
  }, [wanted, content])

  const rows = content?.status === "content" ? content.rows : []
  const identityLabel = (rows[0] as SafeguardingByIdentityRow | undefined)?.identity_label ?? null
  const sourceFor = (key: string | null, locator: string | null) => {
    const meta = key ? sources.get(key) : undefined
    return meta && key ? { authority: meta.authorityName, title: meta.title, url: meta.canonicalUrl, locator } : null
  }

  return (
    <HubScreen ref={scroll} section="Welfare & Support" onRefresh={load} refreshing={!!content && busy}>
      <HubHero title="Safeguarding" intro={browseCode ? undefined : `Official safeguarding guidance for ${hubTeamPossessive(team)}. Ovalball is not a safeguarding authority — this page presents guidance published by the governing body itself, with a link back to the original source.`} />
      {!browseCode && <HubTeamSwitch />}
      {browseCode && (
        <HubContextStrip>
          <Text>
            Showing {browseCode === "league" ? "Rugby League" : "Rugby Union"} safeguarding guidance{identityLabel ? <Text> for <Strong>{identityLabel}</Strong></Text> : null} — not necessarily your own team's guidance.
          </Text>
        </HubContextStrip>
      )}

      {(identityLoading || (busy && !content)) && <HubLoading />}
      {error && <HubFailed error={error} onRetry={() => void load()} />}

      {!error && content && !identityLoading && !browseCode && !teamId && <HubNotice tone="unavailable" message="No team relationship available to show safeguarding information for." />}

      {!error && content && !identityLoading && (browseCode || teamId) && (
        <>
          {!browseCode && (
            <View style={{ gap: space.md }}>
              <HubHeading>Your Club Safeguarding Officer</HubHeading>
              {officers.length === 0 ? (
                <HubNotice tone="reviewing" message="This club hasn't assigned a Safeguarding Officer contact on Ovalball yet." />
              ) : (
                officers.map((o) => (
                  <Card key={o.safeguardingOfficerAssignmentId}>
                    <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                        <UserRound size={18} color={colour.forest800} />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[type.caption, { color: colour.forest800, textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "Inter_500Medium" }]}>{o.officerType === "primary" ? "Primary Safeguarding Officer" : "Deputy Safeguarding Officer"}</Text>
                        <Text style={[type.bodyMedium, { color: colour.ink }]}>{o.officerDisplayName}</Text>
                        {o.registrationState === "PENDING" && <Text style={[type.caption, { color: colour.inkMuted }]}>Not yet an active Ovalball user — reachable by email only.</Text>}
                        <Button
                          variant="secondary"
                          label={o.messageMode === "OVALBALL" ? "Message Safeguarding Officer" : "Email Safeguarding Officer"}
                          style={{ marginTop: space.sm, alignSelf: "flex-start" }}
                          onPress={() => router.push({ pathname: "/hub/safeguarding/contact", params: { club: o.clubId, assignment: o.safeguardingOfficerAssignmentId, mode: o.messageMode } })}
                        />
                      </View>
                    </View>
                  </Card>
                ))
              )}
            </View>
          )}

          <View style={{ gap: space.md }}>
            <HubHeading>Official Safeguarding Guidance</HubHeading>
            {content.status === "error" && <HubNotice tone="unavailable" message="Safeguarding guidance is temporarily unavailable. Please try again shortly." />}
            {(content.status === "empty" || content.status === "no-mapping") && <HubNotice tone="reviewing" message={browseCode ? "No published safeguarding guidance was found for that context." : "Detailed safeguarding guidance for this rugby code is being reviewed and isn't published here yet."} />}
            {content.status === "content" &&
              rows.map((row) => (
                <View key={`${row.fact_id ?? ""}-${row.section_key}`} onLayout={(e) => offsets.current.set(row.section_key, e.nativeEvent.layout.y)}>
                  <HubFactCard title={SAFEGUARDING_SECTION_LABELS[row.section_key] ?? row.section_key} body={row.body ?? row.value_text ?? null} source={sourceFor(row.primary_source_key, row.primary_source_locator ?? null)} highlighted={wanted === row.section_key} />
                </View>
              ))}
          </View>

          {!browseCode && routes && (
            <View style={{ gap: space.md }}>
              <HubHeading>Official Reporting / Support Routes</HubHeading>
              {routes.status === "error" && <HubNotice tone="unavailable" message="Official contact routes are temporarily unavailable." />}
              {(routes.status === "empty" || routes.status === "no-mapping") && <HubNotice tone="reviewing" message="An official reporting route for this rugby code isn't published here yet." />}
              {routes.status === "content" &&
                routes.rows.map((route) => (
                  <Card key={route.route_id}>
                    <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                        {route.route_type === "EXTERNAL_CHILD_PROTECTION_PARTNER" ? <Shield size={18} color={colour.forest800} /> : <MessageCircleWarning size={18} color={colour.forest800} />}
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>
                          {route.label}
                        </Text>
                        {route.email ? <HubTextLink external label={route.email} onPress={() => openExternal(`mailto:${route.email}`)} /> : null}
                        {route.phone ? <HubTextLink external label={route.phone} onPress={() => openExternal(`tel:${route.phone.replace(/\s+/g, "")}`)} /> : null}
                        {route.url ? <HubTextLink external label={route.url} onPress={() => openExternal(route.url)} /> : null}
                        {sourceFor(route.primary_source_key, route.primary_source_locator ?? null) && <HubOfficialSource {...sourceFor(route.primary_source_key, route.primary_source_locator ?? null)!} />}
                      </View>
                    </View>
                  </Card>
                ))}
            </View>
          )}

          {!browseCode && (
            <Pressable accessibilityRole="link" accessibilityLabel="Safeguarding and Online Safety. Opens the Ovalball website" onPress={() => openExternal(`${webUrl}/legal/safeguarding`)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Text style={[type.small, { color: colour.inkMuted }]}>
                For concerns about how Ovalball itself is used (not rugby-regulatory safeguarding), see <Text style={{ color: colour.forest800, fontFamily: "Inter_500Medium", textDecorationLine: "underline" }}>Safeguarding & Online Safety</Text>.
              </Text>
            </Pressable>
          )}
        </>
      )}
    </HubScreen>
  )
}
