import { Text, View } from "react-native"
import { CERTAINTY_LABEL, type Certainty, type CodeScope } from "@ovalball/contracts/rugby-hub/heritage-data"

import { TriangleAlert } from "../components/icons"
import { colour, radius, type } from "../design/tokens"

/**
 * THE STORY OF RUGBY'S TWO VOCABULARIES.
 *
 * CODE: forest green is Ovalball's own colour AND the shared root both codes
 * grew from before 1895, so it does double duty honestly; the two paths after
 * the split get two colours the product did not have before the split existed
 * in the sport -- the website's heritage amber for Union and slate for League.
 *
 * CERTAINTY: the one honesty mechanism the whole heritage model rests on. MYTH
 * and LEGEND must never read the same as ESTABLISHED, in copy, colour or
 * weight -- and colour is never the only signal, because the label always says
 * which one this is. Labels come from the shared CERTAINTY_LABEL map so a
 * search result never disagrees with its own detail page.
 */
export const HERITAGE_UNION = "#b45309"
export const HERITAGE_LEAGUE = "#475569"

const CODE_COPY: Record<CodeScope, string> = {
  pre_schism: "Before the split",
  both: "Union & League",
  union: "Union",
  league: "League",
}

export function codeAccent(codeScope: CodeScope): string {
  return codeScope === "union" ? HERITAGE_UNION : codeScope === "league" ? HERITAGE_LEAGUE : colour.forest800
}

export function CodeBadge({ codeScope }: { codeScope: CodeScope }) {
  const accent = codeAccent(codeScope)
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View accessibilityElementsHidden style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
      <Text style={[type.caption, { color: accent, fontFamily: "Inter_500Medium" }]}>{CODE_COPY[codeScope]}</Text>
    </View>
  )
}

export const CERTAINTY_DESCRIPTION: Record<Certainty, string> = {
  ESTABLISHED: "Strong historical evidence",
  WELL_DOCUMENTED: "Solid evidence, detail varies between accounts",
  CONTESTED: "Historians disagree",
  LEGEND: "Part of rugby tradition, not established historical fact",
  MYTH: "Widely repeated, but the evidence doesn't support it",
}

export function isQuestionable(certainty: Certainty): boolean {
  return certainty === "CONTESTED" || certainty === "LEGEND" || certainty === "MYTH"
}

export function CertaintyBadge({ certainty, size = "sm" }: { certainty: Certainty; size?: "sm" | "md" }) {
  const questionable = isQuestionable(certainty)
  return (
    <View
      accessibilityLabel={`${CERTAINTY_LABEL[certainty]}: ${CERTAINTY_DESCRIPTION[certainty]}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: questionable ? "rgba(138,90,0,0.4)" : colour.lineStrong,
        backgroundColor: questionable ? colour.warningSurface : colour.surface,
        paddingHorizontal: size === "sm" ? 8 : 10,
        paddingVertical: size === "sm" ? 2 : 4,
      }}
    >
      {questionable && <TriangleAlert size={11} color={colour.warning} />}
      <Text style={[type.caption, { color: questionable ? colour.warning : "rgba(16,21,18,0.7)", fontFamily: "Inter_500Medium", fontSize: size === "sm" ? 11 : 12 }]}>{CERTAINTY_LABEL[certainty]}</Text>
    </View>
  )
}
