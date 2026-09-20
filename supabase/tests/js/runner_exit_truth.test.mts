import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * L28 — RUNNER EXIT TRUTH.
 *
 * ROOT CAUSE. `scripts/run-platform-tests.sh` classified a browser suite by
 * reading its OUTPUT before asking the operating system what had happened to
 * it. The crash branch carried the condition `b_ok > 0`, so a suite that
 * exited non-zero having recorded no PASS lines fell past every failure branch
 * and printed `ok`. The gate still went red through the separate "recorded no
 * assertions" check, so the verdict was right and no failed suite was ever
 * accepted as green -- but the status line lied, and a harness whose job is to
 * say what happened may not do that.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD:
 *
 *   `ok` means the process exited 0 AND the suite's assertion accounting is
 *   valid. A non-zero exit is NEVER labelled ok.
 *
 * Exit status is authoritative for process success. Pass counts, fail counts,
 * the presence of output, how long a suite ran and whether its browser went
 * away are assertion accounting -- an ADDITIONAL invariant, never a substitute.
 *
 * WHY THIS DRIVES REAL CHILD PROCESSES. Asserting the condition in TypeScript
 * would only restate it; the defect was in the shell the gate actually runs.
 * So each case below writes a synthetic suite, runs it exactly as the runner
 * does -- capture output, capture `$?`, count PASS and FAIL lines -- and asks
 * the runner's own sourced functions what happened. The subject under test and
 * the code the gate uses are the same file.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..")
const truthScript = path.join(repoRoot, "scripts/browser-verification/suite-exit-truth.sh")

let dir: string

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ovalball-exit-truth-"))
})

after(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A synthetic browser suite: whatever it prints, however it ends. */
function synthetic(name: string, body: string): string {
  const file = path.join(dir, `${name}.mjs`)
  fs.writeFileSync(file, body)
  return file
}

/**
 * Run one synthetic suite through the runner's own capture-and-classify path.
 * This is the runner's loop body, sourcing the runner's own decision file.
 */
function classify(suite: string): {
  outcome: string
  failsGate: boolean
  status: number
  passes: number
  failures: number
} {
  const script = `
    set -uo pipefail
    . "${truthScript}"
    out=$(node "${suite}" 2>&1)
    status=$?
    ok=$(grep -c '^PASS' <<<"$out")
    bad=$(grep -c '^FAIL' <<<"$out")
    cls=$(classify_suite_outcome "$status" "$ok" "$bad")
    if suite_outcome_is_failure "$cls"; then fails=yes; else fails=no; fi
    echo "$cls|$fails|$status|$ok|$bad"
  `
  const line = execFileSync("bash", ["-c", script], { encoding: "utf8" }).trim().split("\n").pop() ?? ""
  const [outcome, fails, status, passes, failures] = line.split("|")
  return {
    outcome,
    failsGate: fails === "yes",
    status: Number(status),
    passes: Number(passes),
    failures: Number(failures),
  }
}

// ---------------------------------------------------------------------
// A. SUCCESS — a valid PASS signal and a clean exit is the only `ok`.
// ---------------------------------------------------------------------
test("A. a suite that records passes and exits 0 is reported ok", () => {
  const suite = synthetic(
    "success",
    `console.log("PASS one thing is true")\nconsole.log("PASS and so is another")\nprocess.exit(0)\n`,
  )
  const r = classify(suite)
  assert.equal(r.status, 0)
  assert.equal(r.passes, 2)
  assert.equal(r.outcome, "ok")
  assert.equal(r.failsGate, false)
})

// ---------------------------------------------------------------------
// B. ORDINARY FAILURE — exit 1, nothing recorded. THE L28 CASE.
// ---------------------------------------------------------------------
test("B. a suite that exits 1 having recorded nothing is never ok", () => {
  const suite = synthetic("silent-failure", `process.exit(1)\n`)
  const r = classify(suite)
  assert.equal(r.status, 1)
  assert.equal(r.passes, 0, "this is the shape that used to print ok")
  assert.notEqual(r.outcome, "ok")
  assert.equal(r.outcome, "CRASH")
  assert.equal(r.failsGate, true)
})

test("B2. a suite that throws at module load is never ok", () => {
  const suite = synthetic("throws", `throw new Error("invalid input syntax for type uuid: \\"\\"")\n`)
  const r = classify(suite)
  assert.notEqual(r.status, 0)
  assert.equal(r.passes, 0)
  assert.notEqual(r.outcome, "ok")
  assert.equal(r.failsGate, true)
})

// ---------------------------------------------------------------------
// C. KILL — the kernel stopped it. Named, not blamed on the product.
// ---------------------------------------------------------------------
test("C. a suite killed with SIGKILL is reported KILL and fails the gate", () => {
  const suite = synthetic(
    "oom",
    `console.log("PASS got some way in")\nprocess.kill(process.pid, "SIGKILL")\n`,
  )
  const r = classify(suite)
  assert.equal(r.status, 137, "a SIGKILLed child reports 137 through a shell")
  assert.equal(r.outcome, "KILL")
  assert.notEqual(r.outcome, "ok")
  assert.equal(r.failsGate, true)
})

// ---------------------------------------------------------------------
// D. SILENT ZERO — exited cleanly having proved nothing.
//    Assertion accounting is an ADDITIONAL invariant, and this is the
//    half that exit status cannot see.
// ---------------------------------------------------------------------
test("D. a suite that exits 0 having recorded no assertions fails the gate", () => {
  const suite = synthetic("silent-zero", `console.log("NOTE nothing to report")\nprocess.exit(0)\n`)
  const r = classify(suite)
  assert.equal(r.status, 0)
  assert.equal(r.passes, 0)
  assert.equal(r.outcome, "EMPTY")
  assert.notEqual(r.outcome, "ok")
  assert.equal(r.failsGate, true)
})

// ---------------------------------------------------------------------
// E. PARTIAL THEN FAILURE — recorded passes, then died.
// ---------------------------------------------------------------------
test("E. a suite that records passes and then exits 1 is never ok", () => {
  const suite = synthetic(
    "partial",
    `console.log("PASS the first thing")\nconsole.log("PASS the second thing")\nprocess.exit(1)\n`,
  )
  const r = classify(suite)
  assert.equal(r.status, 1)
  assert.equal(r.passes, 2)
  assert.equal(r.outcome, "CRASH")
  assert.equal(r.failsGate, true)
})

// ---------------------------------------------------------------------
// F. A REPORTED ASSERTION FAILURE STAYS FAIL, not CRASH.
//    §6: do not make every failure print the same generic message. A suite
//    that finished and named a false assertion has told the truth, and
//    calling that a crash loses the one diagnostic that matters.
// ---------------------------------------------------------------------
test("F. a suite that reports its own failed assertions is FAIL, not CRASH", () => {
  const suite = synthetic(
    "assertion-failure",
    `console.log("PASS one thing is true")\nconsole.log("FAIL the other is not")\nprocess.exit(1)\n`,
  )
  const r = classify(suite)
  assert.equal(r.status, 1)
  assert.equal(r.failures, 1)
  assert.equal(r.outcome, "FAIL")
  assert.equal(r.failsGate, true)
})

// ---------------------------------------------------------------------
// THE INVARIANT ITSELF, swept rather than argued.
// ---------------------------------------------------------------------
test("no non-zero exit is ever classified ok, whatever the output looked like", () => {
  for (const status of [1, 2, 134, 137, 139, 255]) {
    for (const passes of [0, 1, 57]) {
      for (const failures of [0, 3]) {
        const outcome = execFileSync(
          "bash",
          ["-c", `. "${truthScript}"; classify_suite_outcome ${status} ${passes} ${failures}`],
          { encoding: "utf8" },
        ).trim()
        assert.notEqual(outcome, "ok", `exit ${status} with ${passes} passes and ${failures} failures printed ok`)
      }
    }
  }
})

test("a clean exit is ok only when the suite actually proved something", () => {
  const cases: [number, number, string][] = [
    [0, 0, "EMPTY"],
    [1, 0, "ok"],
    [99, 0, "ok"],
  ]
  for (const [passes, failures, expected] of cases) {
    const outcome = execFileSync(
      "bash",
      ["-c", `. "${truthScript}"; classify_suite_outcome 0 ${passes} ${failures}`],
      { encoding: "utf8" },
    ).trim()
    assert.equal(outcome, expected)
  }
})

// ---------------------------------------------------------------------
// GATE LEVEL: every non-zero outcome must reach the gate's exit code.
// A truthful label that did not fail the run would be a different bug.
// ---------------------------------------------------------------------
test("a batch containing any non-ok suite exits non-zero", () => {
  const good = synthetic("gate-good", `console.log("PASS fine")\nprocess.exit(0)\n`)
  const bad = synthetic("gate-bad", `process.exit(1)\n`)
  const script = `
    set -uo pipefail
    . "${truthScript}"
    failures=0
    for s in "${good}" "${bad}"; do
      out=$(node "$s" 2>&1)
      status=$?
      ok=$(grep -c '^PASS' <<<"$out")
      bad_count=$(grep -c '^FAIL' <<<"$out")
      cls=$(classify_suite_outcome "$status" "$ok" "$bad_count")
      if suite_outcome_is_failure "$cls"; then failures=$((failures + 1)); fi
    done
    [[ "$failures" -gt 0 ]] && exit 1
    exit 0
  `
  let exitCode = 0
  try {
    execFileSync("bash", ["-c", script], { encoding: "utf8" })
  } catch (e: any) {
    exitCode = e.status
  }
  assert.equal(exitCode, 1, "a batch with a silently-failing suite must not exit 0")
})

// ---------------------------------------------------------------------
// The runner must USE this file rather than keep its own copy of the rule.
// Two copies of one condition is how L28 happened.
// ---------------------------------------------------------------------
test("the canonical runner sources this decision rather than restating it", () => {
  const runner = fs.readFileSync(path.join(repoRoot, "scripts/run-platform-tests.sh"), "utf8")
  assert.match(runner, /suite-exit-truth\.sh/, "run-platform-tests.sh no longer sources the classification")
  assert.match(runner, /classify_suite_outcome "\$b_status"/, "the browser loop no longer calls the classifier")
  const browserLoop = runner.slice(runner.indexOf('for b in "${BROWSER_SUITES[@]}"'))
  assert.doesNotMatch(
    browserLoop,
    /b_status" -ne 0 && "\$b_ok" -gt 0/,
    "the crash branch has regained the pass-count condition that was L28",
  )
})
