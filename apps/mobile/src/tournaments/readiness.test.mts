import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  READINESS_ACTION_LABEL,
  primaryReadinessAction,
  readinessChecklist,
  readinessHeadline,
  type PlanReadiness,
} from "../../../../packages/contracts/src/tournaments/readiness.ts"
import { swissRoundLimit } from "../../../../packages/contracts/src/tournaments/swiss.ts"
import { friendlyRefusal } from "../errors/translate.ts"

const base: PlanReadiness = {
  stage: "DRAFT_GENERATED",
  format: "round_robin",
  publicationState: "DRAFT",
  hasResults: false,
  gameCount: 6,
  consistency: { competing: 4, placed: 4, newSides: 0, departedSides: 0, games: 6, fixturesOutOfDate: false },
  readyToGenerate: true,
  readyToPublish: true,
  canRegenerate: true,
  canSchedule: true,
  blockers: [],
  warnings: [],
}

const code = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

test("a ready draft leads with Publish, and says so in its headline and ticks", () => {
  assert.equal(primaryReadinessAction(base), "publish")
  assert.deepEqual(readinessHeadline(base), { tone: "ready", title: "Ready to publish" })
  const ticks = readinessChecklist(base)
  assert.ok(ticks.some((t) => t.ok && t.text === "6/6 games have kick-off times"))
  assert.ok(ticks.some((t) => t.ok && t.text === "6/6 games have pitches"))
  assert.ok(ticks.every((t) => t.ok), "nothing is ticked that the server did not confirm, and nothing here is wrong")
})

test("games without times lead to Complete Scheduling (or Reserve Pitches), never back round the wizard", () => {
  const r: PlanReadiness = {
    ...base, readyToPublish: false,
    blockers: [{ code: "UNSCHEDULED", stage: "publish", action: "schedule", count: 4, message: "4 of 6 games have no kick-off time yet." }],
  }
  assert.equal(primaryReadinessAction(r), "schedule")
  assert.equal(READINESS_ACTION_LABEL.schedule, "Complete Scheduling")
  assert.ok(readinessChecklist(r).some((t) => !t.ok && t.text === "2/6 games have kick-off times"))
  assert.equal(readinessHeadline(r).title, "Needs attention")
  const noPitches = { ...r, blockers: [{ ...r.blockers[0]!, action: "pitches" as const }] }
  assert.equal(primaryReadinessAction(noPitches), "pitches")
  assert.equal(READINESS_ACTION_LABEL.pitches, "Reserve Pitches")
})

test("a stale team list is fixed before anything is scheduled or published", () => {
  const r: PlanReadiness = {
    ...base, readyToPublish: false,
    blockers: [
      { code: "UNSCHEDULED", stage: "publish", action: "schedule", message: "x" },
      { code: "FIXTURES_OUT_OF_DATE", stage: "publish", action: "regenerate", message: "1 team has joined since the fixtures were generated." },
    ],
  }
  assert.equal(primaryReadinessAction(r), "regenerate", "regenerating first, because scheduling stale games is wasted work")
  const ko: PlanReadiness = { ...r, blockers: [{ code: "DRAW_MEMBERSHIP", stage: "generate", action: "draw_update", message: "1 new team is not in the draw yet." }] }
  assert.equal(primaryReadinessAction(ko), "draw_update")
  assert.equal(READINESS_ACTION_LABEL.draw_update, "Update the Draw")
})

test("every route a control names is Title Case, as the content standard requires of buttons", () => {
  for (const [k, label] of Object.entries(READINESS_ACTION_LABEL)) {
    if (!label) continue
    for (const word of label.split(" ")) {
      if (["the", "a", "of", "to"].includes(word)) continue
      assert.match(word, /^[A-Z]/, `${k}: "${label}"`)
    }
  }
})

test("a planning refusal reaches the organiser in its own words; a technical failure does not", () => {
  const refusal = { code: "22023", message: "1 new team is not in the draw yet. Update the draw to include exactly the teams in this competition." }
  assert.equal(friendlyRefusal(refusal, "the draw").message, refusal.message)
  const technical = { code: "22023", message: "invalid value for parameter p_plan_id." }
  assert.equal(friendlyRefusal(technical, "the draw").message, "Couldn't load the draw. Try again.")
  const identifier = { code: "22023", message: "Value for tournament_plan_tables is wrong." }
  assert.equal(friendlyRefusal(identifier, "the draw").message, "Couldn't load the draw. Try again.")
  const other = { code: "23505", message: "Duplicate key value." }
  assert.equal(friendlyRefusal(other, "the draw").message, "Couldn't load the draw. Try again.")
})

test("the Generated Draft Plan has a forward route and the planner never saves tables for a knockout", () => {
  const draft = code("../../app/(tabs)/admin/tournaments/plan/draft/[tournamentId].tsx")
  assert.doesNotMatch(draft, /label="Continue Planning"/, "no vague Continue Planning that loops back round the wizard")
  assert.doesNotMatch(draft, /arrives in the next release/, "publishing exists")
  assert.match(draft, /primaryReadinessAction\(readiness\)/, "the main button is whatever readiness says comes next")
  assert.match(draft, /publishTournamentPlan\(supabase/)
  assert.match(draft, /useFocusEffect/, "it re-reads on every arrival, so Complete Scheduling's result shows at once")
  const wizard = code("../../app/(tabs)/admin/tournaments/plan/[tournamentId].tsx")
  assert.match(wizard, /formatHasBracket\(context\.format\) \? \[\] : \[supabase\.rpc\("set_tournament_plan_tables"/, "a knockout has a draw, not tables")
  assert.match(wizard, /useFocusEffect/, "returning from the Teams tab re-reads the plan")
  assert.match(wizard, /joined this competition and/, "and says when a team has joined")
  assert.match(wizard, /if \(!\(await save\(\)\)\) return/, "Continue saves before moving on")
})

test("a window that cannot hold the rounds is fixed before scheduling into it", () => {
  const r: PlanReadiness = {
    ...base, readyToPublish: false,
    blockers: [
      { code: "CAPACITY", stage: "generate", action: "schedule_settings", message: "5 rounds need 5 kick-off times, but the selected days and reserved pitches provide 4." },
      { code: "UNSCHEDULED", stage: "publish", action: "schedule", message: "10 of 10 games have no kick-off time yet." },
    ],
  }
  assert.equal(primaryReadinessAction(r), "schedule_settings")
  assert.equal(READINESS_ACTION_LABEL.schedule_settings, "Review Playing Hours")
})

test("a Hybrid without its qualifier count is sent to Choose Qualifiers, before anything is scheduled", () => {
  const r: PlanReadiness = {
    ...base, stage: "CONFIGURING", gameCount: 0, readyToGenerate: false, readyToPublish: false,
    format: "hybrid",
    blockers: [
      { code: "HYBRID_QUALIFIERS", stage: "generate", action: "qualifiers", message: "Choose how many teams from each table go through to the knockout stage." },
      { code: "CAPACITY", stage: "generate", action: "schedule_settings", message: "x" },
    ],
  }
  assert.equal(primaryReadinessAction(r), "qualifiers")
  assert.equal(READINESS_ACTION_LABEL.qualifiers, "Choose Qualifiers")
  const wizard = code("../../app/(tabs)/admin/tournaments/plan/[tournamentId].tsx")
  assert.match(wizard, /case "qualifiers":\s*\n\s*case "schedule_settings": setStep\(2\)/, "the wizard opens Settings, where the knockout stage is chosen")
  const draft = code("../../app/(tabs)/admin/tournaments/plan/draft/[tournamentId].tsx")
  assert.match(draft, /case "qualifiers":\s*\n\s*case "schedule_settings"/, "and so does the draft")
})

test("a Hybrid is one planner: round robin tables, the knockout's settings, and a crossover the server previews", () => {
  const wizard = code("../../app/(tabs)/admin/tournaments/plan/[tournamentId].tsx")
  assert.match(wizard, /HYBRID_STEPS = \["Teams & Dates", "Groups", "Settings", "Review"\]/)
  assert.match(wizard, /<HybridKnockoutStage/)
  assert.match(wizard, /formatHasBracket\(context\.format\) \? \[\] : \[supabase\.rpc\("set_tournament_plan_tables"/, "a Hybrid saves its group tables like a round robin")
  const stage = code("./hybrid-stage.tsx")
  assert.match(stage, /readHybridKnockoutPreview\(supabase/, "the crossover is the server's answer")
  assert.doesNotMatch(stage, /seed_order|seedOrder|bracketSize/, "the phone never works out a draw of its own")
  const draft = code("../../app/(tabs)/admin/tournaments/plan/draft/[tournamentId].tsx")
  assert.match(draft, /draft\.format === "hybrid" && !isPreview/, "the draft shows the knockout stage beneath the group tables")
})

test("a Swiss is one planner too: rounds the field allows, the pairing rule in words, swaps the server decides", () => {
  assert.equal(swissRoundLimit(6), 5, "an even field: one fewer round than teams")
  assert.equal(swissRoundLimit(5), 5, "an odd field: one round each sitting out")
  assert.equal(swissRoundLimit(1), 0)
  const r: PlanReadiness = {
    ...base, stage: "CONFIGURING", gameCount: 0, readyToGenerate: false, readyToPublish: false, format: "swiss",
    blockers: [{ code: "SWISS_ROUNDS", stage: "generate", action: "rounds", message: "Choose how many rounds this Swiss competition plays." }],
  }
  assert.equal(primaryReadinessAction(r), "rounds")
  assert.equal(READINESS_ACTION_LABEL.rounds, "Choose Rounds")
  const wizard = code("../../app/(tabs)/admin/tournaments/plan/[tournamentId].tsx")
  assert.match(wizard, /SWISS_STEPS = \["Teams & Dates", "Rounds", "Settings", "Review"\]/)
  assert.match(wizard, /case "rounds": setStep\(1\)/)
  assert.match(wizard, /context\.format !== "swiss" && <Button\s+label="Preview Example Fixtures"/, "no round robin example for a Swiss")
  const stage = code("./swiss-stage.tsx")
  assert.match(stage, /swapSwissSides\(supabase/, "the swap is the server's to allow or refuse")
  assert.doesNotMatch(stage, /Math\.random|sort\(\(\) =>/, "the phone never draws or pairs a round")
  const agenda = code("./participant-agenda.tsx")
  assert.match(agenda, /has a bye and is awarded a win/, "a participant is told about a bye on its round's day")
})
