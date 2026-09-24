import { useEffect, useMemo, useState } from "react"
import { AccessibilityInfo, Pressable, Text, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"

import { Button } from "../../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../design/tokens"
import { HUB_ASSETS } from "./assets"
import { entityKey, type HubEntityRef, type HubVisual } from "./manifest"

/**
 * THE VISUAL EXPLAINER — a scene, native hotspots, and canonical words.
 *
 * The image is only the scene. Every hotspot is a real button drawn OVER it whose label and
 * explanation are resolved from the canonical entity it points at (`explanations`), so the picture
 * carries no rugby facts of its own and can be replaced without changing a word. A textual
 * equivalent — the scene sentence and every hotspot's title and explanation in order — sits beneath
 * for anybody who cannot or does not want to use the picture. Reduce Motion means plain state changes.
 */
export type HubExplanation = { title: string; text: string; href?: string }
export type HubExplain = (ref: HubEntityRef) => HubExplanation | null

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => live && setReduce(on))
      .catch(() => {})
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => live && setReduce(on))
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return reduce
}

export function HubVisualExplainer({ visual, explanations, onOpen, initialStep = 0 }: { visual: HubVisual; explanations: HubExplain; onOpen: (ref: HubEntityRef) => void; initialStep?: number }) {
  const { width } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const w = Math.min(width - space.lg * 2, 480)
  const h = Math.round(w / visual.aspect)
  const steps = visual.steps ?? []
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), Math.max(steps.length - 1, 0)))
  const [selected, setSelected] = useState<string | null>(steps.length > 0 ? (steps[step]?.hotspotIds[0] ?? null) : (visual.hotspots[0]?.id ?? null))

  // The hotspots the current step lights up; with no steps, every hotspot is live.
  const lit = useMemo(() => new Set(steps.length > 0 ? (steps[step]?.hotspotIds ?? []) : visual.hotspots.map((hs) => hs.id)), [steps, step, visual.hotspots])
  const hotspots = visual.hotspots
  const current = hotspots.find((hs) => hs.id === selected) ?? null
  const currentIndex = current ? hotspots.indexOf(current) : -1
  const explanation = current ? explanations(current.entity) : null
  const stepTitle = steps.length > 0 ? (explanations(steps[step].entity)?.title ?? `Step ${step + 1}`) : null

  function goStep(next: number) {
    const clamped = Math.min(Math.max(next, 0), steps.length - 1)
    setStep(clamped)
    setSelected(steps[clamped]?.hotspotIds[0] ?? null)
  }
  function goHotspot(delta: number) {
    if (hotspots.length === 0) return
    const next = (currentIndex + delta + hotspots.length) % hotspots.length
    setSelected(hotspots[next].id)
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ width: w, height: h, alignSelf: "center", borderRadius: radius.xl, overflow: "hidden", backgroundColor: colour.forest900 }}>
        <Image source={HUB_ASSETS[visual.assetKey]} style={{ width: w, height: h }} contentFit="cover" transition={reduceMotion ? 0 : 200} accessible accessibilityLabel={visual.alt} />
        {hotspots.map((hs) => {
          const title = explanations(hs.entity)?.title ?? hs.id
          const on = hs.id === selected
          const dim = !lit.has(hs.id)
          const size = TOUCH_TARGET
          return (
            <Pressable
              key={hs.id}
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityHint="Shows what this is"
              accessibilityState={{ selected: on }}
              onPress={() => setSelected(hs.id)}
              hitSlop={4}
              style={({ pressed }) => ({
                position: "absolute",
                left: hs.x * w - size / 2,
                top: hs.y * h - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                alignItems: "center",
                justifyContent: "center",
                opacity: dim ? 0.45 : 1,
              })}
            >
              <View
                style={{
                  width: on ? 30 : 22,
                  height: on ? 30 : 22,
                  borderRadius: 15,
                  borderWidth: 3,
                  borderColor: on ? colour.pitch400 : colour.chalk,
                  backgroundColor: on ? "rgba(90,203,131,0.35)" : "rgba(18,61,44,0.55)",
                }}
              />
            </Pressable>
          )
        })}
        {current && explanation && (
          <View pointerEvents="none" style={{ position: "absolute", left: space.md, right: space.md, bottom: space.md, flexDirection: "row" }}>
            <View style={{ backgroundColor: "rgba(16,21,18,0.82)", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 }}>
              <Text style={[type.smallMedium, { color: colour.chalk }]} numberOfLines={1}>
                {explanation.title}
              </Text>
            </View>
          </View>
        )}
      </View>

      {steps.length > 1 && (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[type.overline, { color: colour.forest800 }]}>{`STEP ${step + 1} OF ${steps.length}`}</Text>
            <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>
              {stepTitle}
            </Text>
          </View>
          <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space.sm }}>
            {steps.map((s, i) => {
              const name = explanations(s.entity)?.title ?? `Step ${i + 1}`
              const on = i === step
              return (
                <Pressable key={s.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Step ${i + 1}: ${name}`} onPress={() => goStep(i)} hitSlop={6} style={{ minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: type.display.fontFamily, fontSize: 15, color: colour.forest900 }}>{i + 1}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
        {current && explanation ? (
          <>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {explanation.title}
            </Text>
            <Text style={[type.body, { color: "rgba(16,21,18,0.85)" }]}>{explanation.text}</Text>
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
              <Button label="Open" variant="secondary" onPress={() => onOpen(current.entity)} accessibilityHint={`Opens ${explanation.title}`} />
              {hotspots.length > 1 && (
                <>
                  <Button label="Previous" variant="quiet" onPress={() => goHotspot(-1)} />
                  <Button label="Next" variant="quiet" onPress={() => goHotspot(1)} />
                </>
              )}
            </View>
          </>
        ) : (
          <Text style={[type.small, { color: colour.inkMuted }]}>Tap a point on the picture to see what it is.</Text>
        )}
        {steps.length > 1 && (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Previous Step" variant="quiet" onPress={() => goStep(step - 1)} disabled={step === 0} />
            <Button label="Next Step" variant="quiet" onPress={() => goStep(step + 1)} disabled={step === steps.length - 1} />
          </View>
        )}
      </View>

      {/* THE TEXTUAL EQUIVALENT: nothing essential lives only in the picture. */}
      <View accessible accessibilityRole="summary" style={{ gap: 6 }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>IN WORDS</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{visual.alt}</Text>
        {hotspots.map((hs) => {
          const e = explanations(hs.entity)
          if (!e) return null
          return (
            <Text key={hs.id} style={[type.small, { color: colour.inkMuted }]}>
              <Text style={{ fontFamily: "Inter_600SemiBold", color: colour.ink }}>{e.title}: </Text>
              {e.text}
            </Text>
          )
        })}
      </View>
    </View>
  )
}

export const explainerKeyFor = entityKey
