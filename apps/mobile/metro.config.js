// Metro, taught where this repository's own shared code lives.
//
// `packages/contracts` is not an installed dependency -- it is this repository's source, compiled from
// source by the website's TypeScript and by Metro alike. Installing it would put a build step between
// an edit and the running app, and a stale copy of "who is signed in" is exactly the class of bug the
// shared package exists to prevent.
//
// watchFolders reaches the repository root because the package imports the generated `types/` from
// there; Metro watches that tree but only ever bundles what is actually imported.
const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

config.watchFolders = [repoRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")]
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@ovalball/contracts": path.resolve(repoRoot, "packages/contracts/src"),
}
// The website's own node_modules must never be resolved into a React Native bundle: it holds `next`,
// `react-dom` for the DOM and a second copy of React, and pulling any of them in produces failures
// that look like application bugs and are not.
config.resolver.blockList = [new RegExp(`^${path.resolve(repoRoot, "node_modules").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*$`)]

module.exports = config
