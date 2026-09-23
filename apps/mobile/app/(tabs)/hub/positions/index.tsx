import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { POSITION_FAMILY_LABEL, groupByFamily } from "@ovalball/contracts/rugby-hub/position-explorer-data"

import { CODE_LABEL, codeParam, usePositions } from "../../../../src/hub/bundles"
import { useHubIdentity } from "../../../../src/hub/identity"
import { AgeStageBanner, PositionPitch, resolveCodeAgeStage } from "../../../../src/hub/positions"
import { HubScreen } from "../../../../src/hub/screen"
import { HubEmpty, HubFailed, HubHero, HubLoading, HubOverline, HubSegmented } from "../../../../src/hub/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * THE POSITION EXPLORER. Never a form before something useful: the code opens
 * on the viewer's own when their team's identity maps to one, and on Union
 * otherwise, with a line saying which of those it is. Union and League are
 * never mixed on one pitch; switching is explicit and always visible.
 */
export default function PositionExplorer() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const { ownCode, loading: identityLoading, team } = useHubIdentity()
  const [code, setCode] = useState<"union" | "league" | null>(codeParam(params.code))
  useEffect(() => {
    if (code === null && !identityLoading) setCode(ownCode ?? "union")
  }, [code, identityLoading, ownCode])

  return code === null ? (
    <HubScreen section="Learn the Game">
      <HubHero title="Position Explorer" intro="Explore the pitch, pick a position, and find out what it actually does — on the ball, off it, in attack and in defence." />
      <HubLoading rows={2} />
    </HubScreen>
  ) : (
    <Explorer code={code} onCode={setCode} contextTeam={team ? (team.childName ? `${team.childName}'s ${team.teamDisplayName} team` : `your ${team.teamDisplayName} team`) : null} />
  )
}

function Explorer({ code, onCode, contextTeam }: { code: "union" | "league"; onCode: (c: "union" | "league") => void; contextTeam: string | null }) {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing, ownContext } = usePositions(code)
  const codeStage = data ? resolveCodeAgeStage(data) : null

  return (
    <HubScreen section="Learn the Game" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Position Explorer" intro="Explore the pitch, pick a position, and find out what it actually does — on the ball, off it, in attack and in defence." />

      <View style={{ gap: space.sm }}>
        <HubSegmented
          label="Rugby code"
          value={code}
          onChange={onCode}
          options={[
            { value: "union", label: CODE_LABEL.union },
            { value: "league", label: CODE_LABEL.league },
          ]}
        />
        <Text style={[type.small, { color: colour.inkMuted }]}>
          {ownContext && contextTeam ? (
            <>
              Based on <Text style={{ fontFamily: "Inter_500Medium", color: "rgba(16,21,18,0.8)" }}>{contextTeam}</Text>
            </>
          ) : (
            <>You're exploring {CODE_LABEL[code]}</>
          )}
        </Text>
      </View>

      {codeStage && <AgeStageBanner stage={codeStage.stage} note={codeStage.note} />}

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && data.positions.length === 0 && <HubEmpty title={`${CODE_LABEL[code]} positions are still being added`} body="The Explorer will show them as soon as they are published." />}

      {data && data.positions.length > 0 && (
        <>
          <PositionPitch bundle={data} onSelect={(p) => router.push({ pathname: "/hub/positions/[code]/[positionKey]", params: { code, positionKey: p.positionKey } })} />
          <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>{codeStage?.stage === "NOT_APPLICABLE" ? "Explore the pitch to see what each position becomes later on." : "Tap a position on the pitch, or from the list, to see what it does."}</Text>

          <View accessibilityRole="list" accessibilityLabel="All positions" style={{ gap: space.lg }}>
            {groupByFamily(data.positions).map((g) => (
              <View key={g.family} style={{ gap: space.xs }}>
                <HubOverline>{POSITION_FAMILY_LABEL[g.family] ?? g.family}</HubOverline>
                {g.positions.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.displayName}${p.shirtNumber ? `, number ${p.shirtNumber}` : ""}`}
                    onPress={() => router.push({ pathname: "/hub/positions/[code]/[positionKey]", params: { code, positionKey: p.positionKey } })}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: pressed ? colour.mint100 : "transparent" })}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(16,21,18,0.1)", alignItems: "center", justifyContent: "center" }}>
                      <Text style={[type.caption, { color: "rgba(16,21,18,0.7)", fontFamily: "Inter_600SemiBold" }]}>{p.shirtNumber ?? p.displayName.charAt(0)}</Text>
                    </View>
                    <Text style={[type.smallMedium, { color: "rgba(16,21,18,0.85)" }]}>{p.displayName}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        </>
      )}
    </HubScreen>
  )
}
