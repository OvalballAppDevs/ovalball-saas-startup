import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { findSkillByKey, relatedSkillsOf, resolveSupersededSkillKey, skillRugbyCodeLabel } from "@ovalball/contracts/rugby-hub/skills-explorer-data"
import { skillCitedContent, skillCoachingLinks, skillDevelopmentLinks } from "@ovalball/contracts/rugby-hub/skills-explorer-types"

import { supabase } from "../../../../src/auth/supabase"
import { ExternalLink } from "../../../../src/components/icons"
import { oneParam, useSkills } from "../../../../src/hub/bundles"
import { HubScreen } from "../../../../src/hub/screen"
import { HubBadge, HubCallout, HubChips, HubEmpty, HubFailed, HubFootnote, HubHero, HubLoading, HubOverline, HubProse, HubSteps } from "../../../../src/hub/ui"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * A SKILL. Only the sections its data supports. The contact-gated skill
 * replaces its technique steps with the governing body's own note rather
 * than showing tackle technique to a viewer whose age grade does not play
 * contact yet -- driven entirely by `contactNotYetPermitted`, which the
 * shared reader resolves from live regulatory data, never a hard-coded age.
 * A retired skill key redirects to its published successor, as on the web.
 */
export default function SkillScreen() {
  const router = useRouter()
  const { skillKey } = useLocalSearchParams<{ skillKey: string }>()
  const key = oneParam(skillKey)
  const { data, loading, error, refresh, refreshing } = useSkills()
  const skill = data && key ? findSkillByKey(data, key) : null
  const [superseded, setSuperseded] = useState<"checking" | "none">("checking")

  useEffect(() => {
    if (!data || !key || skill) return
    let live = true
    void resolveSupersededSkillKey(supabase, key)
      .then((successor) => {
        if (!live) return
        if (successor) router.replace({ pathname: "/hub/skills/[skillKey]", params: { skillKey: successor } })
        else setSuperseded("none")
      })
      .catch(() => live && setSuperseded("none"))
    return () => {
      live = false
    }
  }, [data, key, skill, router])

  const cited = data && skill ? skillCitedContent(data.trainingContentBySkill.get(skill.id) ?? []) : []
  const showSteps = !!skill?.techniqueSteps && skill.techniqueSteps.length > 0 && !skill.contactNotYetPermitted

  return (
    <HubScreen section="Skills" onRefresh={refresh} refreshing={refreshing}>
      {loading && <HubLoading />}
      {error && !data && <HubFailed error={error} onRetry={() => void refresh()} />}
      {data && !skill && (superseded === "checking" ? <HubLoading rows={2} /> : <HubEmpty title="This skill isn't published" body="It may have been renamed or withdrawn. Every published skill is listed under Skills." />)}
      {data && skill && (
        <>
          <HubHero title={skill.displayName} eyebrow="Skills" badges={skillRugbyCodeLabel(skill.rugbyCode) ? <HubBadge label={skillRugbyCodeLabel(skill.rugbyCode)!} /> : undefined} />
          <HubProse heading="What it is">{skill.summary}</HubProse>
          {skill.whyItMatters && <HubProse heading="Why it matters">{skill.whyItMatters}</HubProse>}
          {skill.whenYouUseIt && <HubProse heading="When you use it">{skill.whenYouUseIt}</HubProse>}

          {skill.contactNotYetPermitted && cited.length > 0 && (
            <HubCallout heading="Contact rugby isn't introduced at your stage yet">
              Tackling is taught progressively. Full contact isn't part of the game at your age grade yet, and is introduced from Under 9 — this is the governing body's own rule, not an Ovalball estimate.
            </HubCallout>
          )}

          {showSteps && skill.techniqueSteps && (
            <View style={{ gap: space.md }}>
              <HubOverline>How to do it</HubOverline>
              <HubSteps steps={skill.techniqueSteps} />
            </View>
          )}

          {skill.keyCues && <HubProse heading="Key cues">{skill.keyCues}</HubProse>}
          {skill.commonMistakes && <HubProse heading="Common mistakes">{skill.commonMistakes}</HubProse>}
          {skill.howToImprove && <HubProse heading="How to improve">{skill.howToImprove}</HubProse>}
          {skill.gameExamples && <HubProse heading="Game examples">{skill.gameExamples}</HubProse>}

          <HubChips
            heading="Positions that use this skill"
            items={(data.positionsBySkill.get(skill.id) ?? []).map((p) => ({
              label: p.displayName,
              leading: p.shirtNumber ? `#${p.shirtNumber}` : null,
              trailing: p.rugbyCode === "union" ? "Union" : "League",
              href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`,
            }))}
          />
          <HubChips
            heading="Related skills"
            items={relatedSkillsOf(data, skill).map(({ skill: r, relationshipType }) => ({ label: r.displayName, trailing: relationshipType === "PREREQUISITE" ? "Learn first" : null, href: `/rugby-hub/skills/${r.skillKey}` }))}
          />
          <HubChips
            heading="Develop This Further"
            note="This skill is the technique. These explain what you are actually learning, and why it is taught this way."
            items={skillDevelopmentLinks(data.trainingContentBySkill.get(skill.id) ?? []).map((c) => ({ label: c.title, href: `/rugby-hub/development/${c.contentKey}` }))}
          />
          <HubChips
            heading="Coaching This Skill"
            note="For coaches: how to build practice that teaches this, rather than what to practise."
            items={skillCoachingLinks(data.trainingContentBySkill.get(skill.id) ?? []).map((c) => ({ label: c.title, href: `/rugby-hub/coaching/${c.contentKey}` }))}
          />

          {cited.length > 0 && !skill.contactNotYetPermitted && (
            <View style={{ gap: space.sm }}>
              <HubOverline>Sources</HubOverline>
              {cited.map((c) => (
                <View key={c.contentKey} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{c.title}</Text>
                  <Text style={[type.small, { color: "rgba(16,21,18,0.7)" }]}>{c.summary}</Text>
                  {c.regulatoryFacts.length > 0 && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.sm, gap: 6 }}>
                      {c.regulatoryFacts.map((f) => (
                        <View key={f.factKey} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                          <ExternalLink size={12} color={colour.inkMuted} style={{ marginTop: 3 }} />
                          <Text style={[type.caption, { color: "rgba(16,21,18,0.6)", flex: 1 }]}>{f.valueText ?? "Governing-body regulation"}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          <HubFootnote>Ovalball educational guidance — general coaching convention, not law or regulation.</HubFootnote>
        </>
      )}
    </HubScreen>
  )
}
