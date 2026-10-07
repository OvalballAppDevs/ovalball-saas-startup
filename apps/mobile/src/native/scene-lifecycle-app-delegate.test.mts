import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require_ = createRequire(import.meta.url)
const plugin = require_("../../plugins/with-scene-lifecycle-app-delegate.js")

/**
 * THE APP DELEGATE PATCH THAT KEEPS THE APP LAUNCHING.
 *
 * iOS 26 refuses an app that has not adopted scene lifecycle, so the scene manifest names Expo's
 * `EXExpoAppSceneDelegate` -- and that delegate fatals on launch unless the AppDelegate conforms to
 * `ExpoReactNativeFactoryProvider`. Expo's prebuild template does not, so a plugin adds it.
 *
 * THIS TEST EXISTS BECAUSE THE FAILURE IS INVISIBLE UNTIL LAUNCH. A plugin that silently matches
 * nothing produces a perfectly successful build and an app that dies before its first frame, which is
 * exactly what happened when the same fix lived as a hand edit in the generated `ios/` directory and
 * a prebuild removed it. So two things are asserted: the transformation is right, and the template it
 * is matching against is still the template Expo actually ships.
 */

const TEMPLATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`

test("the patched AppDelegate conforms to the protocol the scene delegate looks for", () => {
  const out = plugin.patchAppDelegate(TEMPLATE, "test")
  assert.match(out, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/)
})

test("the scene delegate's window is the only window -- the template's own is removed", () => {
  const out = plugin.patchAppDelegate(TEMPLATE, "test")
  assert.ok(!out.includes("UIWindow(frame: UIScreen.main.bounds)"), "a second window would sit in front of the real one")
  assert.ok(!out.includes("factory.startReactNative("), "React Native is started by the scene delegate")
})

test("the factory is still created and held, because that is what the scene delegate asks for", () => {
  const out = plugin.patchAppDelegate(TEMPLATE, "test")
  assert.match(out, /reactNativeFactory = factory/)
  assert.match(out, /var reactNativeFactory: RCTReactNativeFactory\?/)
})

test("running it twice changes nothing the second time", () => {
  const once = plugin.patchAppDelegate(TEMPLATE, "test")
  assert.equal(plugin.patchAppDelegate(once, "test"), once)
})

test("a template it does not recognise stops the build rather than passing silently", () => {
  assert.throws(() => plugin.patchAppDelegate("class Something: NSObject {}\n", "test"), /with-scene-lifecycle-app-delegate/)
  // The declaration is there but the window block is not: still a refusal, never a half-patch.
  assert.throws(
    () => plugin.patchAppDelegate("class AppDelegate: ExpoAppDelegate {\n}\n", "test"),
    /window\/startReactNative block/
  )
})

test("the protocol the plugin conforms to is the one this Expo version actually declares", () => {
  const src = readFileSync(
    new URL("../../node_modules/expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift", import.meta.url),
    "utf8"
  )
  assert.match(src, /public protocol ExpoReactNativeFactoryProvider/)
  // The two members the patched delegate must supply. Both already exist in the template; this
  // asserts Expo has not renamed them underneath the patch.
  assert.match(src, /var window: UIWindow\? \{ get set \}/)
  assert.match(src, /var reactNativeFactory: RCTReactNativeFactory\? \{ get \}/)
})
