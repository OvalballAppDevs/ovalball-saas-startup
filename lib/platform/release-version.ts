/**
 * Release version arithmetic for Site Admin → Release & Platform Mode.
 *
 * Ovalball's displayed version is the currently PUBLISHED production release
 * (platform_public_state), never package.json. This module only helps a Site
 * Admin record the next one: it suggests the patch after the highest version
 * already recorded, drafts included, so the suggestion can never collide with
 * the unique (channel, version) key.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parse(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * The next patch version after the highest recorded MAJOR.MINOR.PATCH. Empty
 * when nothing recorded is a plain three-part version: guessing a numbering
 * scheme for a Site Admin is worse than leaving the field for them to fill.
 */
export function nextReleaseVersion(recorded: string[]): string {
  const versions = recorded.map(parse).filter((v): v is [number, number, number] => v !== null)
  if (versions.length === 0) return ""
  const [major, minor, patch] = versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0]
  return `${major}.${minor}.${patch + 1}`
}
