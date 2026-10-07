import { Pressable, ScrollView, Text, View } from "react-native"

import { Field, TextField } from "../components/form"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * WHAT A SIDE IS, WHEN THERE IS NO CANONICAL TEAM BEHIND IT.
 *
 * TWO DIFFERENT FACTS, TWO DIFFERENT FIELDS. A side's AGE GROUP is which competition it plays in; its
 * ALIAS is what the club calls it. They were conflated: one free-text box did both jobs, so "U12 A"
 * had to be read to discover the grade, and a club that calls its second side "Spears" had nowhere to
 * say so without inventing a grade-looking name.
 *
 * THE ALIAS NEVER DETERMINES THE AGE GROUP. The grade is a structured value chosen from a list and
 * stored in its own column; the alias is optional and decorative to the model. Burnley U12 Spears,
 * Burnley U12 Arrows and Burnley U13 B are three structurally distinct sides, and the first two differ
 * only by alias while the third differs by competition.
 *
 * THE LIST IS THE TOURNAMENT'S OWN GRADES, NOT OVALBALL'S. A tournament running U9, U10 and U12 offers
 * exactly those three. Offering every age group would let somebody record a side into a competition
 * this tournament does not run, which is a participant with nowhere to play.
 *
 * NO SECOND VOCABULARY IS DEFINED HERE. The options are the grades the tournament already holds, which
 * came from the canonical age-group source and are checked again by the database's own constraint.
 */
export function SideIdentityFields({
  ageGroups,
  ageGroup,
  onAgeGroup,
  alias,
  onAlias,
}: {
  /** The grades THIS tournament runs, in the order it holds them. */
  ageGroups: string[]
  ageGroup: string
  onAgeGroup: (grade: string) => void
  alias: string
  onAlias: (value: string) => void
}) {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: space.xs }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>AGE GROUP</Text>
        {/* Horizontal because a tournament's grades are few and short; the same pill the Teams tab
            already uses to switch competitions, so choosing one here reads as the same idea. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.xs, paddingRight: space.lg }}
        >
          {ageGroups.map((g) => {
            const on = g === ageGroup
            return (
              <Pressable
                key={g}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Age group ${g}`}
                onPress={() => onAgeGroup(g)}
                style={({ pressed }) => ({
                  minWidth: 64,
                  minHeight: 38,
                  paddingHorizontal: space.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.md,
                  borderWidth: on ? 1.5 : 1,
                  borderColor: on ? colour.forest800 : colour.line,
                  backgroundColor: on ? colour.forest800 : colour.surface,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{g}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      <View style={{ gap: space.xs }}>
        <Field label="Alias (optional)">
          <TextField label="Alias" value={alias} onChange={onAlias} placeholder="e.g. Spears, Arrows, B, 2nd XV" />
        </Field>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 16 }]}>
          Use an alias to distinguish multiple sides from the same club.
        </Text>
      </View>
    </View>
  )
}

export const SIDE_IDENTITY_TOUCH = TOUCH_TARGET
