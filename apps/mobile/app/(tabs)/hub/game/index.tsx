import { useEffect, useState } from "react"
import { View } from "react-native"
import { useRouter } from "expo-router"
import { CONCEPT_FAMILY_LABEL, conceptRugbyCodeLabel, groupConceptsByFamily, journeySteps, type GameConcept } from "@ovalball/contracts/rugby-hub/game-knowledge-data"

import { CODE_LABEL, useGameKnowledge } from "../../../../src/hub/bundles"
import { useHubIdentity } from "../../../../src/hub/identity"
import { HubScreen } from "../../../../src/hub/screen"
import { HubFailed, HubHeading, HubHero, HubLead, HubList, HubLoading, HubOverline, HubRow, HubSegmented } from "../../../../src/hub/ui"
import { space } from "../../../../src/design/tokens"

/**
 * GAME KNOWLEDGE — the beginner journey first, then every concept.
 *
 * Twelve steps in order, from what the game is trying to do through to reading
 * a full sequence of play; a step both codes share shows the variant for the
 * chosen code, never both stacked. The default code is the viewer's own when
 * their team's identity resolves to one, and Union otherwise -- stated plainly
 * by the always-visible switch, never inferred silently.
 */
export default function GameKnowledgeLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useGameKnowledge()
  const { ownCode, loading: identityLoading } = useHubIdentity()
  const [code, setCode] = useState<"union" | "league">("union")
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!identityLoading && !seeded) {
      if (ownCode) setCode(ownCode)
      setSeeded(true)
    }
  }, [identityLoading, ownCode, seeded])

  const stepConcept = (concepts: GameConcept[]) => (concepts.length === 1 ? concepts[0] : (concepts.find((c) => c.rugbyCode === code) ?? concepts[0]))

  return (
    <HubScreen section="Learn the Game" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Game Knowledge" intro="How rugby actually works — what teams are trying to do, what happens after a tackle, how a game flows from one phase to the next, and where Union and League genuinely differ." />

      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}

      {data && (
        <>
          <View style={{ gap: space.md }}>
            <View style={{ gap: space.sm }}>
              <HubHeading>The Beginner Journey</HubHeading>
              <HubSegmented
                label="Rugby code"
                value={code}
                onChange={setCode}
                options={[
                  { value: "union", label: CODE_LABEL.union },
                  { value: "league", label: CODE_LABEL.league },
                ]}
              />
              <HubLead>Twelve steps, in order, from what the game is trying to do through to reading a full sequence of play.</HubLead>
            </View>
            <HubList>
              {journeySteps(data).map(({ order, concepts }, i) => {
                const concept = stepConcept(concepts)
                return (
                  <HubRow
                    key={order}
                    index={i + 1}
                    title={concept.title}
                    badge={conceptRugbyCodeLabel(concept.rugbyCode)}
                    description={concept.summary}
                    onPress={() => router.push({ pathname: "/hub/game/[conceptKey]", params: { conceptKey: concept.contentKey } })}
                  />
                )
              })}
            </HubList>
          </View>

          <View style={{ gap: space.md }}>
            <View>
              <HubHeading>Explore Any Concept</HubHeading>
              <HubLead>Already know your way around? Jump straight to any concept, in any order.</HubLead>
            </View>
            {groupConceptsByFamily(data.concepts).map((group) => (
              <View key={group.family} style={{ gap: space.sm }}>
                <HubOverline>{CONCEPT_FAMILY_LABEL[group.family] ?? group.family}</HubOverline>
                <HubList>
                  {group.concepts.map((c) => (
                    <HubRow key={c.id} title={c.title} badge={conceptRugbyCodeLabel(c.rugbyCode)} description={c.summary} onPress={() => router.push({ pathname: "/hub/game/[conceptKey]", params: { conceptKey: c.contentKey } })} />
                  ))}
                </HubList>
              </View>
            ))}
          </View>
        </>
      )}
    </HubScreen>
  )
}
