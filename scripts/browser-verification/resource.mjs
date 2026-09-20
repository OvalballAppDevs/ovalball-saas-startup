// =====================================================================
// RESOURCE TELEMETRY FOR THE BROWSER GATE
//
// Convergence Step 7's final gate was killed three times by the operating
// system for low memory, and the output looked exactly like a gate that had
// stopped for no reason. An hour of wall clock produced a partial log that a
// reader could not classify. This exists so that never happens silently again.
//
// The distinction it has to support is the one Step 6 had to establish the
// hard way, and Step 7 met again:
//
//   application failure   an assertion about the product was false
//   test failure          an assertion about the product was wrong
//   browser crash         the browser went away mid-suite
//   OOM kill              the KERNEL stopped the process; nothing failed
//   resource leak         each suite leaves more behind than it took
//   already exhausted     the machine had nothing to give before we started
//
// The first two are engineering. The last four are not, and reporting them as
// engineering is how a team spends a day reproducing a defect that does not
// exist.
//
// DELIBERATELY SMALL. No sampler, no time series, no dependency. Two shell
// reads and an aggregate, at checkpoints a human chose. This is not a
// monitoring project; it is enough to tell those six apart.
// =====================================================================

import { execFileSync } from "node:child_process"
import os from "node:os"

/** Never let telemetry be the thing that fails a run. */
function quiet(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const MB = 1024 * 1024

/**
 * Swap in use, in MB, or null where the platform does not report it.
 * macOS is the platform this gate runs on; Linux is handled because the
 * numbers are the same question and CI may one day ask it.
 */
function swapUsedMb() {
  if (process.platform === "darwin") {
    return quiet(() => {
      const out = execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" })
      const used = /used\s*=\s*([\d.]+)M/.exec(out)
      const total = /total\s*=\s*([\d.]+)M/.exec(out)
      return used && total ? { usedMb: Math.round(+used[1]), totalMb: Math.round(+total[1]) } : null
    }, null)
  }
  return quiet(() => {
    const meminfo = execFileSync("cat", ["/proc/meminfo"], { encoding: "utf8" })
    const total = /SwapTotal:\s+(\d+) kB/.exec(meminfo)
    const free = /SwapFree:\s+(\d+) kB/.exec(meminfo)
    if (!total || !free) return null
    return { usedMb: Math.round((+total[1] - +free[1]) / 1024), totalMb: Math.round(+total[1] / 1024) }
  }, null)
}

/**
 * Genuinely available memory, in MB.
 *
 * `os.freemem()` is not the answer on macOS: it reports only the free list and
 * ignores the inactive pages the kernel will hand over on demand, so it reads
 * catastrophically low on a machine that is coping. `vm_stat`'s free +
 * inactive + speculative is what a process can actually expect to get.
 */
function availableMb() {
  if (process.platform === "darwin") {
    return quiet(() => {
      const out = execFileSync("vm_stat", [], { encoding: "utf8" })
      const pageSize = +(/page size of (\d+) bytes/.exec(out)?.[1] ?? 4096)
      const pages = (label) => +(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0)
      const usable = pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")
      return Math.round((usable * pageSize) / MB)
    }, Math.round(os.freemem() / MB))
  }
  return quiet(() => {
    const meminfo = execFileSync("cat", ["/proc/meminfo"], { encoding: "utf8" })
    const available = /MemAvailable:\s+(\d+) kB/.exec(meminfo)
    return available ? Math.round(+available[1] / 1024) : Math.round(os.freemem() / MB)
  }, Math.round(os.freemem() / MB))
}

/**
 * The processes this gate is responsible for: the browsers it launched and the
 * node processes running the suites. Counted and weighed separately from
 * everything else on the machine, because "the gate is leaking" and "the
 * machine was already full" are different findings and the number that tells
 * them apart is this one.
 */
function ourProcesses() {
  return quiet(
    () => {
      const out = execFileSync("ps", ["-axo", "rss,command"], { encoding: "utf8" })
      let browsers = 0
      let browserRssMb = 0
      let nodes = 0
      let nodeRssMb = 0
      for (const line of out.split("\n")) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line)
        if (!m) continue
        const rssMb = +m[1] / 1024
        const cmd = m[2]
        // Playwright's own browser build, never the person's installed browser.
        if (cmd.includes("ms-playwright")) {
          browsers += 1
          browserRssMb += rssMb
        } else if (/(^|\/)node\b/.test(cmd) && cmd.includes("browser-verification")) {
          nodes += 1
          nodeRssMb += rssMb
        }
      }
      return { browsers, browserRssMb: Math.round(browserRssMb), nodes, nodeRssMb: Math.round(nodeRssMb) }
    },
    { browsers: 0, browserRssMb: 0, nodes: 0, nodeRssMb: 0 },
  )
}

/** One reading. Cheap enough to take at a checkpoint, too expensive to take in a loop. */
export function readResources() {
  const swap = swapUsedMb()
  return {
    availableMb: availableMb(),
    totalMb: Math.round(os.totalmem() / MB),
    swapUsedMb: swap?.usedMb ?? null,
    swapTotalMb: swap?.totalMb ?? null,
    ...ourProcesses(),
  }
}

/** One line, for a log a person reads. */
export function formatResources(r) {
  const swap = r.swapUsedMb === null ? "swap n/a" : `swap ${r.swapUsedMb}/${r.swapTotalMb}MB`
  const ours = `${r.browsers} browser proc (${r.browserRssMb}MB), ${r.nodes} suite proc (${r.nodeRssMb}MB)`
  return `${r.availableMb}MB available of ${r.totalMb}MB, ${swap}, ${ours}`
}

/**
 * WHAT COUNTS AS TOO LITTLE TO START.
 *
 * Measured, not guessed. Two suites were sampled while they ran, on this
 * application, on this machine:
 *
 *   65-session-boundary-and-signup-challenge   10 procs    891MB peak
 *   31-competition-creator (before)            12 procs   1351MB peak
 *   31-competition-creator (after)             10 procs    975MB peak
 *
 * The middle row is the one that set this number. Suite 31 opened four
 * personas and kept all four alive until the browser closed; suite 65 opened
 * FIVE and kept at most one, and peaked 460MB lower. Closing each persona when
 * its questions were answered took suite 31 down to 975MB with all 39 of its
 * assertions unchanged.
 *
 * So a suite costs roughly 900MB-1GB at peak, not the 400-700MB first guessed
 * here, and 800MB was a threshold a machine could pass and still be killed.
 * 1200MB is one suite's measured peak plus the node process that runs it.
 *
 * These are thresholds for REPORTING, not for refusing. A gate that silently
 * declined to run would be worse than one that runs badly -- the point is that
 * the result is interpretable either way.
 */
export const MINIMUM_AVAILABLE_MB = 1200
export const MAXIMUM_SWAP_FRACTION = 0.9

export function assessForFullBatch(r = readResources()) {
  const reasons = []
  if (r.availableMb < MINIMUM_AVAILABLE_MB) {
    reasons.push(`only ${r.availableMb}MB available; a single suite was measured at 891-1351MB at peak`)
  }
  if (r.swapTotalMb && r.swapUsedMb / r.swapTotalMb > MAXIMUM_SWAP_FRACTION) {
    reasons.push(`swap is ${Math.round((100 * r.swapUsedMb) / r.swapTotalMb)}% used before the gate starts`)
  }
  return { healthy: reasons.length === 0, reasons, reading: r }
}

/**
 * The preflight line the runner prints. Names the state plainly; a reader who
 * frees some memory and runs again should not have to guess what to free.
 */
export function preflightReport(assessment = assessForFullBatch()) {
  const lines = [`  RESOURCE PREFLIGHT  ${formatResources(assessment.reading)}`]
  if (!assessment.healthy) {
    lines.push("  RESOURCE PREFLIGHT — UNSUITABLE FOR CLEAN FULL BATCH")
    for (const reason of assessment.reasons) lines.push(`        ${reason}`)
    lines.push("        The gate will still run. A kill or a stall from here is the")
    lines.push("        machine, not the product -- free memory and run it again before")
    lines.push("        reading a partial result as a failure.")
  }
  return lines.join("\n")
}

/**
 * Was a suite's exit the kernel's doing rather than the suite's?
 *
 * A process killed by SIGKILL reports status 137 through a shell, or a null
 * exit code and the signal through Node. Neither is a test result, and the one
 * thing a runner must not do is add it to a failure count.
 */
export function looksLikeOomKill(exitCode, signal) {
  return signal === "SIGKILL" || exitCode === 137 || exitCode === null
}
