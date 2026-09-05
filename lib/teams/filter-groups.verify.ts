import { FILTER_GROUP_LABEL, groupAndSortLanes, type FilterableLane } from "./filter-groups"

/**
 * Run with `npx tsx lib/teams/filter-groups.verify.ts`. Permanent
 * regression coverage for the Calendar team-filter grouping/sorting
 * rework -- built from real Burnley RUFC team metadata (see the live
 * duplicate-team audit in this pass's final report) so the fixture below
 * is representative, not invented.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

function lane(overrides: Partial<FilterableLane> & Pick<FilterableLane, "id" | "fullLabel">): FilterableLane {
  return { label: overrides.fullLabel, kind: "team", category: null, ageGroup: null, gender: null, squadDesignation: null, ...overrides }
}

const lanes: FilterableLane[] = [
  lane({ id: "u12", fullLabel: "Under 12", category: "youth", ageGroup: "U12", gender: "boys" }),
  lane({ id: "u12b", fullLabel: "Under 12 B", category: "youth", ageGroup: "U12", gender: "boys", squadDesignation: "B" }),
  lane({ id: "u6", fullLabel: "Under 6", category: "youth", ageGroup: "U6", gender: "mixed" }),
  lane({ id: "u16girls", fullLabel: "Girls Under 16", category: "youth", ageGroup: "U16", gender: "girls" }),
  lane({ id: "u13girls", fullLabel: "Girls Under 13", category: "youth", ageGroup: "U13", gender: "girls" }),
  lane({ id: "seniorcolts", fullLabel: "Senior Colts", category: "colts", ageGroup: "SeniorColts" }),
  lane({ id: "juniorcolts", fullLabel: "Junior Colts", category: "colts", ageGroup: "JuniorColts" }),
  lane({ id: "mens2", fullLabel: "Men's 2nd", category: "senior", gender: "mens", squadDesignation: "2nd" }),
  lane({ id: "mens1", fullLabel: "Men's 1st", category: "senior", gender: "mens", squadDesignation: "1st" }),
  lane({ id: "womens1", fullLabel: "Women's 1st", category: "senior", gender: "womens", squadDesignation: "1st" }),
  lane({ id: "sharedu7u8", fullLabel: "U7/U8 Shared", kind: "group" }),
  lane({ id: "u7", fullLabel: "Under 7", category: "youth", ageGroup: "U7", gender: "boys" }),
]

const grouped = groupAndSortLanes(lanes)

check(
  "Groups render in the required order and every non-empty bucket appears",
  grouped.map((g) => g.key),
  ["minis_juniors", "colts", "girls", "womens", "mens"]
)

const minis = grouped.find((g) => g.key === "minis_juniors")!
check("Minis + Juniors: age-descending, then primary before B, then the shared group lane last", minis.lanes.map((l) => l.id), ["u12", "u12b", "u7", "u6", "sharedu7u8"])
check("Shared scheduling group lane lands inside Minis + Juniors, never floating alphabetically as its own bucket", minis.lanes.some((l) => l.id === "sharedu7u8"), true)

const colts = grouped.find((g) => g.key === "colts")!
check("Colts: Senior Colts before Junior Colts (older first)", colts.lanes.map((l) => l.id), ["seniorcolts", "juniorcolts"])

const girls = grouped.find((g) => g.key === "girls")!
check("Girls: age descending", girls.lanes.map((l) => l.id), ["u16girls", "u13girls"])

const mens = grouped.find((g) => g.key === "mens")!
check("Men's: ordinal ascending (1st before 2nd), never alphabetical", mens.lanes.map((l) => l.id), ["mens1", "mens2"])

check("Women's: separated cleanly from Men's despite sharing squad_designation '1st'", grouped.find((g) => g.key === "womens")!.lanes.map((l) => l.id), ["womens1"])

check("Group label lookup is stable and human-readable", FILTER_GROUP_LABEL.minis_juniors, "Minis + Juniors")

// An unclassifiable lane (no category/gender at all) lands in "other" rather than silently vanishing.
const withOther = groupAndSortLanes([...lanes, lane({ id: "mystery", fullLabel: "Mystery Team" })])
check("A lane with no classifiable metadata lands in 'other', never silently dropped", withOther.some((g) => g.key === "other" && g.lanes.some((l) => l.id === "mystery")), true)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
