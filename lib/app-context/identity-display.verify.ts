import { resolveContextSettingsLink } from "./identity-display"

/**
 * Run with `npx tsx lib/app-context/identity-display.verify.ts`. Permanent
 * regression coverage for the settings-gear destination resolver (Master
 * Architecture Pass -- Security/Safeguarding Gate §9): cheap, deterministic,
 * and the exact boundary a "context is not authorization" leak would show
 * up in first if this function regressed.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

check("Club context -> /club/settings, labelled with the club's own name", resolveContextSettingsLink("club", "10000000-0000-0000-0000-000000000001", "Burnley RUFC"), {
  href: "/club/settings",
  ariaLabel: "Burnley RUFC settings",
})

check(
  "Club context -> /club/settings regardless of WHICH club id is active (never a fixed/first club)",
  resolveContextSettingsLink("club", "20000000-0000-0000-0000-000000000002", "League Test Club A"),
  { href: "/club/settings", ariaLabel: "League Test Club A settings" }
)

check(
  "Team context -> /teams/<exact active team_id>, never a different team",
  resolveContextSettingsLink("team", "40000000-0000-0000-0000-00000000000c", "Men's 1st"),
  { href: "/teams/40000000-0000-0000-0000-00000000000c", ariaLabel: "Men's 1st settings" }
)

check(
  "Team context with a DIFFERENT team id resolves to THAT team, not the first one tried above",
  resolveContextSettingsLink("team", "30000000-0000-0000-0000-000000000001", "U12"),
  { href: "/teams/30000000-0000-0000-0000-000000000001", ariaLabel: "U12 settings" }
)

check("Team context with a null id (should never happen in practice) is safely null, never a broken href", resolveContextSettingsLink("team", null, "Men's 1st"), null)

check("Parent context -> the safe Personal Settings fallback, never Club or Team Settings", resolveContextSettingsLink("parent", "30000000-0000-0000-0000-000000000001", "U12"), {
  href: "/account",
  ariaLabel: "Your personal account settings",
})

check("Player context -> the same safe Personal Settings fallback, never Team Admin settings", resolveContextSettingsLink("player", "40000000-0000-0000-0000-00000000000c", "Senior Colts"), {
  href: "/account",
  ariaLabel: "Your personal account settings",
})

check("Site Admin context -> no invented generic destination (gear hidden)", resolveContextSettingsLink("site_admin", null, "Ovalball"), null)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
