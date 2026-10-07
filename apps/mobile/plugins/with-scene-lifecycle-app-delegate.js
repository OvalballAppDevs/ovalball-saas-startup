const { withAppDelegate } = require("expo/config-plugins")

/**
 * THE APP DELEGATE, UNDER THE SCENE LIFE CYCLE.
 *
 * iOS 26 kills an app that has not adopted scene lifecycle, so `app.config.ts` names Expo's
 * `EXExpoAppSceneDelegate` in the scene manifest. That delegate creates the window and starts React
 * Native itself, and to do it, it asks the app delegate for the factory:
 *
 *   guard let provider = appDelegate as? ExpoReactNativeFactoryProvider, let factory = ...
 *
 * Expo 57's prebuild template still generates the pre-scene AppDelegate -- it does NOT conform to
 * that protocol, and it builds its own `UIWindow` and calls `startReactNative` in
 * `didFinishLaunchingWithOptions`. Against a scene manifest that combination is fatal at launch:
 *
 *   Fatal error: ExpoAppSceneDelegate couldn't start React Native because the app delegate isn't an
 *   ExpoAppDelegate that provides a React Native factory.
 *
 * SO THIS IS A PLUGIN AND NOT AN EDIT IN `ios/`. That directory is generated and gitignored, and a
 * hand edit in it is erased by the next prebuild. This has already happened once: the app was fixed
 * by editing `ios/OvalballDev/AppDelegate.swift`, the project was prebuilt again, and the app died on
 * launch with that same fatal error and no sign of what had removed the fix. Expressing it as a mod
 * means prebuild RE-APPLIES it every time instead of undoing it.
 *
 * IT FAILS LOUDLY RATHER THAN SILENTLY. If a future Expo template no longer matches what is being
 * looked for, the build stops with a sentence naming this file -- because the alternative is a plugin
 * that quietly does nothing and an app that crashes on launch for no visible reason.
 */

/** The stock template's own window creation -- the scene delegate's job now, and doing it twice
 * leaves a second detached window in front of the real one. */
const TEMPLATE_WINDOW_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`

const CLASS_DECLARATION = "class AppDelegate: ExpoAppDelegate {"
const CONFORMING_DECLARATION = "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {"

function patchAppDelegate(contents, filePath) {
  // Already conformed (a re-run, or Expo started shipping it): leave it exactly as it is.
  if (contents.includes("ExpoReactNativeFactoryProvider")) return contents

  if (!contents.includes(CLASS_DECLARATION)) {
    throw new Error(
      `[with-scene-lifecycle-app-delegate] Could not find "${CLASS_DECLARATION}" in ${filePath}. ` +
        "The Expo AppDelegate template has changed shape. Check whether it now conforms to " +
        "ExpoReactNativeFactoryProvider itself -- if it does, delete this plugin; if it does not, " +
        "update the strings in it. Do NOT patch ios/ by hand: prebuild erases that."
    )
  }

  let next = contents.replace(CLASS_DECLARATION, CONFORMING_DECLARATION)

  if (!next.includes(TEMPLATE_WINDOW_BLOCK)) {
    throw new Error(
      `[with-scene-lifecycle-app-delegate] Could not find the template's window/startReactNative block in ${filePath}. ` +
        "Under the scene life cycle the scene delegate owns the window, so this block must go. " +
        "Update the string in this plugin to match the current template."
    )
  }

  // The factory is still built here and held on the delegate -- that is what the scene delegate
  // comes back for. Only the window and the start call move.
  next = next.replace(
    TEMPLATE_WINDOW_BLOCK,
    `// THE SCENE DELEGATE OWNS THE WINDOW. Under the scene life cycle (see the scene manifest in
    // app.config.ts) EXExpoAppSceneDelegate builds the UIWindow from its UIWindowScene and calls
    // startReactNative itself, reading the factory back off this delegate through
    // ExpoReactNativeFactoryProvider. Creating a second window here would put a detached, empty
    // window in front of the real one. Applied by plugins/with-scene-lifecycle-app-delegate.js.
`
  )

  return next
}

module.exports = function withSceneLifecycleAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        `[with-scene-lifecycle-app-delegate] Expected a Swift AppDelegate, got "${cfg.modResults.language}".`
      )
    }
    cfg.modResults.contents = patchAppDelegate(cfg.modResults.contents, "ios/.../AppDelegate.swift")
    return cfg
  })
}

// Exported so a test can assert the transformation without running a prebuild.
module.exports.patchAppDelegate = patchAppDelegate
module.exports.CLASS_DECLARATION = CLASS_DECLARATION
module.exports.TEMPLATE_WINDOW_BLOCK = TEMPLATE_WINDOW_BLOCK
