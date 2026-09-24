import { View } from "react-native"
import { useRouter } from "expo-router"
import { SKILL_FAMILY_LABEL, groupSkillsByFamily, skillRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/skills-explorer-data"

import { useSkills } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubContextLine, HubTeamSwitch } from "../../../../src/hub/team"
import { HubFailed, HubHero, HubList, HubLoading, HubOverline, HubRow } from "../../../../src/hub/ui"
import { space } from "../../../../src/design/tokens"

/**
 * SKILLS — grouped by the real skill family, never a card wall. The small code
 * badge comes straight off each skill's own rugby code and is absent for the
 * common, genuinely code-universal skill; every code stays visible to every
 * viewer regardless of their own team's code.
 */
export default function SkillsLanding() {
  const router = useRouter()
  const { data, loading, error, refresh, refreshing } = useSkills()
  return (
    <HubScreen section="Play & Develop" onRefresh={refresh} refreshing={refreshing}>
      <HubHero title="Skills" intro="What each skill is, why it matters, when you use it, and how to actually get better at it — connected to the positions that rely on it." />
      <View style={{ gap: space.sm }}>
        <HubContextLine subject="Contact guidance checked" />
        <HubTeamSwitch />
      </View>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data &&
        groupSkillsByFamily(data.skills).map((g) => (
          <View key={g.family} style={{ gap: space.sm }}>
            <HubOverline>{SKILL_FAMILY_LABEL[g.family] ?? g.family}</HubOverline>
            <HubList>
              {g.skills.map((s) => (
                <HubRow key={s.id} title={s.displayName} badge={skillRugbyCodeLabel(s.rugbyCode)} description={s.summary} onPress={() => router.push({ pathname: "/hub/skills/[skillKey]", params: { skillKey: s.skillKey } })} />
              ))}
            </HubList>
          </View>
        ))}
    </HubScreen>
  )
}
