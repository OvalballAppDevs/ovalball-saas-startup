/**
 * A ~20-line module resolver so Node's own test runner can import the email
 * modules directly.
 *
 * Two things need mapping, and only two:
 *
 *   "@/x"        -> <repo root>/x        (the tsconfig path alias)
 *   "server-only" -> a no-op stub        (that package throws by design
 *                                         outside a React Server Component
 *                                         graph, which a test is)
 *
 * This exists instead of a test framework because adding one meant forcing a
 * peer-dependency resolution the project has not verified. Node 24 already
 * runs TypeScript and already has `node:test`; the only thing missing was
 * path resolution, so that is the only thing supplied here.
 */
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, resolve as resolvePath } from "node:path"
import { existsSync } from "node:fs"

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..")
const STUB = pathToFileURL(resolvePath(ROOT, "scripts/server-only-stub.mjs")).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: STUB, shortCircuit: true }
    }
    // "@/x" -> repo root. TypeScript's own path alias.
    if (specifier.startsWith("@/")) {
      const hit = firstExisting(resolvePath(ROOT, specifier.slice(2)))
      if (hit) return { url: hit, shortCircuit: true }
    }
    // "./x" -> "./x.ts". TypeScript source omits the extension; Node ESM
    // requires it, so the two are reconciled here rather than by rewriting
    // every import in the application to suit the test runner.
    if (specifier.startsWith(".") && context.parentURL) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)
      const hit = firstExisting(base)
      if (hit) return { url: hit, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

/** The first of base, base.ts, base.tsx, base/index.ts that exists on disk. */
function firstExisting(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  return null
}
