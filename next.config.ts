import { execSync } from "node:child_process"

import type { NextConfig } from "next"

// Captured once at build time -- git is a build-environment concern only,
// never invoked at request time. Falls back to "unknown" for a build
// environment with no .git directory (e.g. a source-only Docker context)
// rather than failing the build.
function resolveGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim()
  } catch {
    return "unknown"
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA ?? resolveGitSha(),
  },
}

export default nextConfig
