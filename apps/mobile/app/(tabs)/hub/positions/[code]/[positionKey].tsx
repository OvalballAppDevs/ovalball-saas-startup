import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { findPositionByKey, relatedPositionsOf } from "@ovalball/contracts/rugby-hub/position-explorer-data"

import { CODE_LABEL, codeParam, oneParam, usePositions } from "../../../../../src/hub/bundles"
import { AgeStageBanner, familySentence } from "../../../../../src/hub/positions"
import { HubScreen } from "../../../../../src/hub/screen"
import { HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubLoading, HubOverline, HubProse, HubTextLink } from "../../../../../src/hub/ui"
import { colour, radius, space, type } from "../../../../../src/design/tokens"

/**
 * A POSITION. Only the sections this position's data supports; "what makes
 * a good X" is development priorities plus what strong performance looks
 * like, framed around awareness, decisions, technique and work-rate -- never
 * a physical-trait claim, because the content was written to that brief.
 */
export default function PositionScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code: string; positionKey: string }>()
  const code = codeParam(params.code) ?? "union"
  const key = oneParam(params.positionKey)
  const { data, loading, error, refresh, refreshing } = usePositions(code)
  const position = data && key ? findPositionByKey(data, key) : null

  return (
    <HubScreen section="Position Explorer" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !position && (
        <View style={{ gap: space.md }}>
          <HubEmpty title="That position isn't published" body={`That link doesn't match a position Ovalball currently has published for ${CODE_LABEL[code]}.`} />
          <HubTextLink label="Back to the pitch" onPress={() => router.push({ pathname: "/hub/positions", params: { code } })} />
        </View>
      )}
      {data && position && (
        <>
          <View style={{ gap: 4 }}>
            <HubHero
              eyebrow={CODE_LABEL[code]}
              title={position.displayName}
              badges={position.shirtNumber ? <Text style={[type.displaySmall, { color: colour.inkMuted }]}>#{position.shirtNumber}</Text> : undefined}
            />
            <Text style={[type.small, { color: colour.inkMuted }]}>{familySentence(position.positionFamily)}</Text>
          </View>

          <AgeStageBanner stage={position.ageStage} note={position.ageStageNote} />

          <HubProse heading="What this position does">{position.purpose}</HubProse>
          {position.roleWithBall && <HubProse heading="With the ball">{position.roleWithBall}</HubProse>}
          {position.roleWithoutBall && <HubProse heading="Without the ball">{position.roleWithoutBall}</HubProse>}
          {position.attackResponsibilities && <HubProse heading="In attack">{position.attackResponsibilities}</HubProse>}
          {position.defenceResponsibilities && <HubProse heading="In defence">{position.defenceResponsibilities}</HubProse>}
          {position.setPieceResponsibilities && <HubProse heading="Set piece">{position.setPieceResponsibilities}</HubProse>}

          <HubChips heading="Key skills for this position" items={(data.skillsByPosition.get(position.id) ?? []).map((s) => ({ label: s.displayName, href: `/rugby-hub/skills/${s.skillKey}` }))} />

          {position.decisionMaking && <HubProse heading="Decision making">{position.decisionMaking}</HubProse>}
          {position.communication && <HubProse heading="Communication">{position.communication}</HubProse>}

          {(position.developmentPriorities || position.strongPerformanceLooksLike) && (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: "rgba(220,247,229,0.5)", padding: space.lg, gap: space.md }}>
              <Text accessibilityRole="header" style={[type.title, { color: colour.forest900 }]}>
                What makes a good {position.displayName.toLowerCase()}?
              </Text>
              {position.developmentPriorities && <HubProse heading="Development priorities">{position.developmentPriorities}</HubProse>}
              {position.strongPerformanceLooksLike && <HubProse heading="What strong performance looks like">{position.strongPerformanceLooksLike}</HubProse>}
            </View>
          )}

          {position.commonMistakes && <HubProse heading="Common mistakes">{position.commonMistakes}</HubProse>}

          {relatedPositionsOf(data, position).length > 0 && (
            <View style={{ gap: space.sm }}>
              <HubOverline>Related positions</HubOverline>
              <HubChips
                items={relatedPositionsOf(data, position).map((r) => ({
                  label: r.displayName,
                  leading: r.shirtNumber ? `#${r.shirtNumber}` : null,
                  onPress: () => router.push({ pathname: "/hub/positions/[code]/[positionKey]", params: { code: r.rugbyCode, positionKey: r.positionKey } }),
                }))}
              />
            </View>
          )}

          <HubFootnote>Ovalball educational guidance — general coaching convention, not law or regulation.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
