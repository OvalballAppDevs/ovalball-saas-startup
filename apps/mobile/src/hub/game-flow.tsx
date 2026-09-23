import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"

import { ArrowDown } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"
import { openHubHref } from "./routes"
import { HubSegmented, HubTextLink } from "./ui"

/**
 * HOW A GAME FLOWS — the flagship Game Knowledge visual, once per code.
 *
 * One repeating cycle whose contact step genuinely diverges: Union contests
 * the ball at a breakdown, League restarts with a play-the-ball. The nodes
 * and their explanations are the same seven the website draws, laid out
 * vertically for a thumb with down-arrows between them -- the same nodes
 * recomposed, not a shrunk copy of the desktop row. Every node is a real
 * button; activating one shows its explanation and, where a concept exists,
 * a link to it.
 */
interface FlowNode {
  key: string
  label: string
  detail: string
  href?: string
}

const SHARED_START: FlowNode = { key: "restart", label: "Start / Restart", detail: "Play begins from a kick-off, or restarts after a score or a stoppage.", href: "/rugby-hub/game/how-play-restarts" }
const SHARED_POSSESSION: FlowNode = { key: "possession", label: "Possession", detail: "One team has the ball and tries to advance it towards the opposition's try line.", href: "/rugby-hub/game/possession-and-territory" }
const SHARED_ATTACK: FlowNode = { key: "attack", label: "Attack", detail: "The team in possession runs, passes or kicks to gain ground and create space.", href: "/rugby-hub/game/how-teams-move-the-ball" }
const SHARED_CONTACT: FlowNode = { key: "contact", label: "Contact / Tackle", detail: "The ball-carrier is tackled — what happens next is where Union and League genuinely diverge." }
const UNION_CONTACT_OUTCOME: FlowNode = { key: "union-breakdown", label: "Breakdown / Ruck", detail: "Both teams can compete for the ball on the ground — winning it continues the attack, losing it turns possession over.", href: "/rugby-hub/game/the-breakdown-and-ruck" }
const LEAGUE_CONTACT_OUTCOME: FlowNode = { key: "league-ptb", label: "Play-the-Ball", detail: "No contest — the tackled team keeps the ball and restarts with a play-the-ball, using one of a limited number of tackles.", href: "/rugby-hub/game/the-play-the-ball" }
const SHARED_TERRITORY: FlowNode = { key: "territory", label: "Territory / Continuity", detail: "The team weighs keeping the ball against kicking for better field position.", href: "/rugby-hub/game/possession-and-territory" }
const SHARED_RESOLUTION: FlowNode = { key: "resolution", label: "Score / Turnover / Penalty", detail: "The sequence ends in a score, a turnover, or a penalty — and then the cycle restarts from the top.", href: "/rugby-hub/game/how-a-game-flows" }

function flowFor(code: "union" | "league"): FlowNode[] {
  return [SHARED_START, SHARED_POSSESSION, SHARED_ATTACK, SHARED_CONTACT, code === "union" ? UNION_CONTACT_OUTCOME : LEAGUE_CONTACT_OUTCOME, SHARED_TERRITORY, SHARED_RESOLUTION]
}

export function GameFlow({ defaultCode }: { defaultCode: "union" | "league" }) {
  const router = useRouter()
  const [code, setCode] = useState<"union" | "league">(defaultCode)
  const [activeKey, setActiveKey] = useState("restart")
  const nodes = flowFor(code)
  const active = nodes.find((n) => n.key === activeKey) ?? nodes[0]

  return (
    <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
          How a Game Flows
        </Text>
        <HubSegmented
          label="Rugby code"
          value={code}
          onChange={(c) => {
            setCode(c)
            if (activeKey === "union-breakdown" || activeKey === "league-ptb") setActiveKey(c === "union" ? "union-breakdown" : "league-ptb")
          }}
          options={[
            { value: "union", label: "Rugby Union" },
            { value: "league", label: "Rugby League" },
          ]}
        />
      </View>

      <View style={{ gap: 4 }}>
        {nodes.map((node, i) => {
          const on = node.key === activeKey
          return (
            <View key={node.key} style={{ alignItems: "stretch", gap: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Step ${i + 1}: ${node.label}`}
                onPress={() => setActiveKey(node.key)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingHorizontal: space.md,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: on ? colour.pitch600 : pressed ? "rgba(50,166,101,0.4)" : colour.lineStrong,
                  backgroundColor: on ? colour.mint100 : colour.surface,
                })}
              >
                <Text style={[type.smallMedium, { color: on ? colour.forest900 : "rgba(16,21,18,0.75)" }]}>{node.label}</Text>
              </Pressable>
              {i < nodes.length - 1 && (
                <View accessibilityElementsHidden style={{ alignItems: "center" }}>
                  <ArrowDown size={14} color="rgba(16,21,18,0.3)" />
                </View>
              )}
            </View>
          )
        })}
      </View>

      <View style={{ backgroundColor: colour.chalk, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4 }}>
        <Text style={[type.smallMedium, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>{active.label}</Text>
        <Text style={{ ...type.body, color: "rgba(16,21,18,0.8)" }}>{active.detail}</Text>
        {active.href && <HubTextLink label="Learn more" onPress={() => openHubHref(router, active.href!)} />}
      </View>

      <Text style={[type.caption, { color: colour.inkMuted }]}>The cycle repeats: whatever the outcome, play restarts and the sequence begins again from the top.</Text>
    </View>
  )
}
