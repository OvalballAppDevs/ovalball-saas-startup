import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, Text, TextInput, View } from "react-native"
import { describeSiblingRule, ordinalWord, SIBLING_ORDINALS, siblingRuleInput, type SiblingDiscountType, type SiblingRule } from "@ovalball/contracts/club/finance"

import { Chip } from "../admin/finance-ui"
import { ChevronDown, ChevronUp } from "../components/icons"
import { Button } from "../components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/** One rule as the person is editing it: the type, and the value as typed. */
export interface SiblingRuleDraft {
  discountType: SiblingDiscountType
  value: string
}

export interface SiblingRuleChange {
  ordinal: number
  discountType: SiblingDiscountType
  discountValue: number
}

function draftFor(rule: SiblingRule | null): SiblingRuleDraft {
  if (!rule) return { discountType: "NONE", value: "" }
  return { discountType: rule.discountType, value: rule.discountType === "NONE" ? "" : String(rule.discountType === "PERCENTAGE" ? rule.discountValue : rule.discountValue / 100) }
}

function draftsFrom(rules: SiblingRule[]): Record<number, SiblingRuleDraft> {
  return Object.fromEntries(SIBLING_ORDINALS.map((o) => [o, draftFor(rules.find((r) => r.ordinal === o) ?? null)]))
}

function sameDraft(a: SiblingRuleDraft, b: SiblingRuleDraft): boolean {
  return a.discountType === b.discountType && (a.discountType === "NONE" || a.value.trim() === b.value.trim())
}

/**
 * THE FIVE RULES, ONE LINE EACH, ONE SAVE. What each child's discount is reads at a glance; a rule opens to be
 * changed (one at a time, so five editors are never two screens of scrolling), and every change waits for the one
 * Save Changes / Discard -- the owner's standing pattern for an edit screen, never a Save and a confirm per rule.
 * `onDirty` lets the screen warn before leaving with changes unsaved.
 */
export function SiblingDiscounts({
  rules,
  onSaveAll,
  errorMessage,
  editable,
  onDirty,
}: {
  rules: SiblingRule[]
  /** The changed rules only, validated; resolves when saved, or throws the server's refusal. */
  onSaveAll: (changes: SiblingRuleChange[]) => Promise<void>
  /** What to call a refusal: the screen's own translator (src/admin/decision-sheet.tsx's pattern). */
  errorMessage: (cause: unknown) => string
  editable: boolean
  onDirty?: (dirty: boolean) => void
}) {
  const saved = useMemo(() => draftsFrom(rules), [rules])
  const [drafts, setDrafts] = useState<Record<number, SiblingRuleDraft>>(saved)
  const [open, setOpen] = useState<number | null>(null)
  const [problems, setProblems] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [saveProblem, setSaveProblem] = useState<string | null>(null)

  // The server's rules move the draft only where the person has not changed it since the last rules they saw.
  const previousSaved = useRef(saved)
  useEffect(() => {
    const before = previousSaved.current
    setDrafts((current) => Object.fromEntries(SIBLING_ORDINALS.map((o) => [o, current[o] && before[o] && !sameDraft(current[o]!, before[o]!) ? current[o]! : saved[o]!])))
    previousSaved.current = saved
  }, [saved])

  const changed = SIBLING_ORDINALS.filter((o) => drafts[o] && saved[o] && !sameDraft(drafts[o]!, saved[o]!))
  const dirty = changed.length > 0
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])

  function set(ordinal: number, next: Partial<SiblingRuleDraft>) {
    setOutcome(null)
    setSaveProblem(null)
    setDrafts((d) => ({ ...d, [ordinal]: { ...d[ordinal]!, ...next } }))
    setProblems((p) => {
      const { [ordinal]: _gone, ...rest } = p
      return rest
    })
  }

  async function save() {
    const found: Record<number, string> = {}
    const changes: SiblingRuleChange[] = []
    for (const o of changed) {
      const d = drafts[o]!
      const parsed = siblingRuleInput(d.discountType, d.value)
      if (!parsed.ok) found[o] = parsed.problem
      else changes.push({ ordinal: o, discountType: d.discountType, discountValue: parsed.discountValue })
    }
    setProblems(found)
    const first = Object.keys(found)[0]
    if (first) {
      setOpen(Number(first))
      AccessibilityInfo.announceForAccessibility(`${ordinalWord(Number(first))} child: ${found[Number(first)]}`)
      return
    }
    setSaving(true)
    setSaveProblem(null)
    try {
      await onSaveAll(changes)
      const text = changes.length === 1 ? "Sibling discount saved. It applies to new enrolments from today." : `${changes.length} sibling discounts saved. They apply to new enrolments from today.`
      setOutcome(text)
      AccessibilityInfo.announceForAccessibility(text)
      setOpen(null)
    } catch (cause) {
      setSaveProblem(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (saveProblem) AccessibilityInfo.announceForAccessibility(saveProblem)
  }, [saveProblem])

  return (
    <View style={{ gap: space.md }}>
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
        {SIBLING_ORDINALS.map((ordinal, i) => {
          const d = drafts[ordinal] ?? { discountType: "NONE" as SiblingDiscountType, value: "" }
          const parsed = siblingRuleInput(d.discountType, d.value)
          const summary = parsed.ok ? describeSiblingRule({ discountType: d.discountType, discountValue: parsed.discountValue }) : "Not valid yet"
          const expanded = open === ordinal
          const isChanged = changed.includes(ordinal)
          return (
            <View key={ordinal} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
              <Pressable
                accessibilityRole={editable ? "button" : undefined}
                accessibilityState={editable ? { expanded } : undefined}
                accessibilityLabel={`${ordinalWord(ordinal)} child: ${summary}${isChanged ? ", not saved yet" : ""}`}
                accessibilityHint={editable ? (expanded ? "Closes this rule" : "Opens this rule to change it") : undefined}
                disabled={!editable}
                onPress={() => setOpen(expanded ? null : ordinal)}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
              >
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{`${ordinalWord(ordinal)} child`}</Text>
                <Text style={[type.small, { color: isChanged ? colour.forest800 : colour.inkMuted }]}>{isChanged ? `${summary} · Not saved` : summary}</Text>
                {editable && (expanded ? <ChevronUp size={16} color={colour.forest800} /> : <ChevronDown size={16} color={colour.inkSubtle} />)}
              </Pressable>
              {expanded && editable && (
                <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
                  <View accessibilityRole="radiogroup" accessibilityLabel={`${ordinalWord(ordinal)} child discount type`} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    <Chip label="No Discount" on={d.discountType === "NONE"} onPress={() => set(ordinal, { discountType: "NONE" })} />
                    <Chip label="Percentage" on={d.discountType === "PERCENTAGE"} onPress={() => set(ordinal, { discountType: "PERCENTAGE" })} />
                    <Chip label="Fixed £" on={d.discountType === "FIXED"} onPress={() => set(ordinal, { discountType: "FIXED" })} />
                  </View>
                  {d.discountType !== "NONE" && (
                    <TextInput
                      accessibilityLabel={d.discountType === "PERCENTAGE" ? `${ordinalWord(ordinal)} child: percent off` : `${ordinalWord(ordinal)} child: amount off in pounds`}
                      value={d.value}
                      onChangeText={(value) => set(ordinal, { value })}
                      keyboardType="decimal-pad"
                      placeholder={d.discountType === "PERCENTAGE" ? "Percent off" : "Amount off (£)"}
                      placeholderTextColor={colour.inkSubtle}
                      style={[type.body, INPUT]}
                    />
                  )}
                  {problems[ordinal] && (
                    <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger }]}>
                      {problems[ordinal]}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )
        })}
      </View>
      {(saveProblem || outcome) && (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: saveProblem ? colour.danger : colour.forest800 }]}>
          {saveProblem ?? outcome}
        </Text>
      )}
      {editable && dirty && (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button variant="brand" label="Save Changes" onPress={() => void save()} busy={saving} style={{ flex: 2 }} />
          <Button
            label="Discard"
            variant="secondary"
            disabled={saving}
            onPress={() => {
              setDrafts(saved)
              setProblems({})
              setOpen(null)
            }}
            style={{ flex: 1 }}
          />
        </View>
      )}
    </View>
  )
}

const INPUT = { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, backgroundColor: colour.surface } as const
