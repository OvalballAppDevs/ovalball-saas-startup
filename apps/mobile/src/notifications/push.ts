import { useEffect, useRef } from "react"
import { Linking, Platform } from "react-native"
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { useRouter } from "expo-router"

import { notificationHref } from "@ovalball/contracts/notifications/destinations"
import { markNotificationRead } from "@ovalball/contracts/notifications/feed"
import type { ActiveContextKind } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { webUrl } from "../config/environment"
import { invalidateAttention } from "../attention/cache"
import { useAppContexts } from "../context/contexts"
import { routeForHref } from "../links/destinations"
import { friendly, logDetail } from "../errors/translate"
import { showForegroundNotice } from "../components/foreground-banner"
import { isMessageAnswer, noticeAnswerNotSent, reactFromNotification, registerMessageCategory, sendMessageAnswer } from "./message-actions"

/**
 * NATIVE PUSH DELIVERY (M7) -- the device side of the pipeline the database already proves:
 * `register_push_device_token` / `unregister_push_device_token`, the `push_enabled` preference
 * channel, and the `notifications_deliver_push_trigger` that sends an Expo push message for every
 * row the in-app gate already let through (`supabase/migrations/20270706000000...`,
 * `20270707000000...`, `supabase/tests/push_notifications.sql`).
 *
 * THIS FILE OWNS DELIVERY, NOT DECISIONS. Whether a push arrives at all was decided server-side, by
 * the same `should_deliver_notification` rule the in-app and email channels already obey. What this
 * file decides is strictly native plumbing: has this device got OS permission, does Expo have its
 * current token on file, and where does a tap land -- the last of which it does not decide either,
 * reusing `routeForHref` so a push tap and an in-app tap on the same notification resolve to the
 * same destination (CLAUDE.md's Match Centre "one shared surface" reasoning, applied to routing).
 */

const APP_VARIANTS = ["development", "staging", "production"] as const
type AppVariant = (typeof APP_VARIANTS)[number]

function appVariant(): AppVariant {
  const extra = Constants.expoConfig?.extra as { ovalballEnvironment?: string } | undefined
  const value = extra?.ovalballEnvironment
  return (APP_VARIANTS as readonly string[]).includes(value ?? "") ? (value as AppVariant) : "development"
}

/**
 * THE ONE THING THIS BUILD CANNOT DO YET: there is no EAS project configured
 * (`apps/mobile/eas.json` does not exist, and `app.config.ts` carries no
 * `extra.eas.projectId`), and `getExpoPushTokenAsync` requires one -- Expo's push
 * service has had no anonymous/experience-id token path since the SDK this app is
 * on. Every function below fails CLOSED and honestly when it is missing, rather
 * than throwing from deep inside a sign-in flow: logged in development, silent
 * in production, and never blocking anything else the app does.
 */
function projectId(): string | null {
  const easProjectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  return typeof easProjectId === "string" && easProjectId.length > 0 ? easProjectId : null
}

/** Android needs a channel to exist before a notification can be delivered to it at all. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return
  await Notifications.setNotificationChannelAsync("default", {
    name: "Ovalball",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 200, 200],
  })
}

/**
 * THE APP DECIDES FOREGROUND PRESENTATION, not iOS/Android defaults -- a push that arrives while
 * somebody is already looking at Ovalball shows Ovalball's own banner (`foreground-banner.tsx`)
 * rather than stacking a second, OS-styled one over it. Sound and badge still run natively; the
 * visual banner is suppressed here and drawn again, deliberately, by the received-listener below.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * REGISTER OR REFRESH THIS DEVICE, but ONLY IF OS PERMISSION IS ALREADY GRANTED. This never prompts
 * -- prompting is the pre-prompt screen's job, and only after its own Ovalball-styled explanation.
 * Called on sign-in and whenever the app returns to the foreground, so a token Expo silently rotates
 * is kept current without asking anybody anything twice.
 */
export async function syncRegistrationIfPermitted(): Promise<void> {
  const settings = await Notifications.getPermissionsAsync()
  if (!settings.granted) return
  await ensureAndroidChannel()
  // A SIMULATOR/EMULATOR HAS OS PERMISSION CONCEPTS BUT NO REAL APNs/FCM IDENTITY -- the request and
  // the OS prompt above are genuine and worth proving there; only the token itself needs real
  // hardware, so this is the one place the distinction is checked rather than at the door.
  if (!Device.isDevice) return
  const pid = projectId()
  if (!pid) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[ovalball] push: no EAS project id configured (app.config.ts extra.eas.projectId); cannot request an Expo push token yet.")
    }
    return
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid })
    const { error } = await supabase.rpc("register_push_device_token", {
      p_token: token,
      p_platform: Platform.OS === "ios" ? "ios" : "android",
      p_app_variant: appVariant(),
    })
    if (error) throw error
  } catch (caught) {
    logDetail("push registration", friendly(caught, "push notifications"))
  }
}

/**
 * REQUEST OS PERMISSION, then register if it was granted. The ONLY function that actually triggers
 * the native prompt -- called exclusively from the Ovalball pre-prompt screen's "Enable" button, never
 * automatically, so the OS dialog is never the first thing anybody sees.
 */
export async function requestPermissionAndRegister(): Promise<boolean> {
  const settings = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  })
  if (!settings.granted) return false
  await syncRegistrationIfPermitted()
  return true
}

/**
 * SIGNING OUT removes THIS DEVICE's token -- the same "this device forgets" rule
 * `session.tsx`'s `signOut` already applies to the session itself. Called BEFORE the auth call clears
 * the session, because the unregister RPC authenticates as whoever is currently signed in.
 */
export async function unregisterThisDevice(): Promise<void> {
  if (!Device.isDevice) return
  try {
    const settings = await Notifications.getPermissionsAsync()
    if (!settings.granted) return
    const pid = projectId()
    if (!pid) return
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid })
    await supabase.rpc("unregister_push_device_token", { p_token: token })
  } catch {
    // Best-effort: a device that cannot be reached to unregister is not a reason to block sign-out.
    // A stale token left behind is harmless -- re-registering (by anybody) replaces it in place
    // (`register_push_device_token`'s own upsert), and it is never treated as authority for anything.
  }
}

/**
 * WHERE A PUSH TAP LANDS, WIRED ONCE NEAR THE ROOT.
 *
 * THREE MOMENTS, ONE RESOLVER. A tap while the app is backgrounded or terminated arrives through
 * `addNotificationResponseReceivedListener`; a tap that is what actually LAUNCHED the app (cold
 * start) never fires that listener in time to be caught, so `getLastNotificationResponse` is checked
 * once up front as well. A received-while-foregrounded push never taps anything -- it shows the
 * in-app banner instead, and that banner's own `onPress` reuses the identical `routeForHref` call.
 *
 * `contextKind` narrows a fixture notification to the participant address for a family-facing
 * viewer, exactly as `routeForHref`'s other caller (the in-app notification list) already does --
 * there is deliberately no separate narrowing rule for push.
 */
/**
 * UNWRAP WHAT EXPO'S RELAY ACTUALLY DELIVERS.
 *
 * `expo-notifications`' own native layer -- on both platforms, independently -- reads a top-level
 * `"body"` key out of the raw push and treats ITS CONTENTS as what this app sees as
 * `notification.request.content.data` (iOS: `NotificationRecords.swift`'s
 * `serializedNotificationData` reads `userInfo["body"]`; Android: `NotificationData.kt`'s `body`
 * parses `data["body"]` as JSON, cited there against Expo's own "Android push notification payload
 * specification"). Because Expo's push relay (`exp.host`) nests the WHOLE original message -- title,
 * body, data, sound -- under that same `"body"` key, what lands here as `data` is actually
 * `{ title, body, data: {...}, sound }`, one level deeper than the message this app's own delivery
 * trigger sends. This was found live: a raw, flat `xcrun simctl push` test payload (which skips
 * Expo's relay and its wrapping) produced `data: null` and crashed the received-listener, which is
 * what proved the real shape rather than leaving it assumed. Unwrapped once here rather than at each
 * of the three call sites below, and tolerant of an already-flat payload so a local test (or a future
 * relay change) degrades to "no type found" instead of a crash.
 */
function unwrapPushData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {}
  const outer = raw as Record<string, unknown>
  const inner = outer.data
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : outer
}

export function useNotificationRouting(contextKind: ActiveContextKind | null): void {
  const router = useRouter()
  const { refreshUnread } = useAppContexts()
  const contextRef = useRef(contextKind)
  contextRef.current = contextKind
  const refreshRef = useRef(refreshUnread)
  refreshRef.current = refreshUnread

  useEffect(() => {
    void ensureAndroidChannel()

    /**
     * OPENING IS READING, wherever the tap happened. The delivery trigger stamps every push with the
     * row's own `notificationId`, so a tap on the OS notification or on the foreground banner marks
     * that exact row read through the same canonical operation the in-app lists use -- and the bell's
     * count comes back down from the server's own answer, never a local decrement.
     */
    const markOpened = (data: Record<string, unknown>) => {
      if (typeof data.notificationId !== "string") return
      void markNotificationRead(supabase, data.notificationId)
        .then(() => {
          invalidateAttention()
          return refreshRef.current()
        })
        .catch((caught) => logDetail("mark notification", friendly(caught, "that notification")))
    }

    // ONE RULE FOR EVERY TAP, the same as the bell and the Centre (`useNotificationNavigator`): a native
    // screen when this build has one, otherwise the website's own page for that exact object. A push tap
    // used to do nothing at all for an address with no native screen yet (an announcement), while the
    // same notification tapped in the app opened it.
    const go = (href: string) => {
      const route = routeForHref(href, contextRef.current)
      if (route) router.push(route as never)
      else void Linking.openURL(`${webUrl}${href}`)
    }

    const open = (data: Record<string, unknown>) => {
      if (typeof data.type !== "string") return
      markOpened(data)
      go(notificationHref(data.type, data))
    }

    void registerMessageCategory()

    const last = Notifications.getLastNotificationResponse()
    if (last) {
      if (last.actionIdentifier === "react-thumbs") {
        void reactFromNotification(unwrapPushData(last.notification.request.content.data))
      } else if (isMessageAnswer(last.actionIdentifier)) {
        const data = unwrapPushData(last.notification.request.content.data)
        void sendMessageAnswer(data, last.actionIdentifier, last.userText).then((sent) => {
          if (sent) markOpened(data)
          else void noticeAnswerNotSent()
        })
      } else {
        open(unwrapPushData(last.notification.request.content.data))
      }
      Notifications.clearLastNotificationResponse()
    }

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = unwrapPushData(notification.request.content.data)
      if (typeof data.type !== "string") return
      // The header's badges recount from the server the moment something arrives, so the Messages and
      // bell counts never wait for the app to be reopened.
      void refreshRef.current()
      const href = notificationHref(data.type, data)
      showForegroundNotice({
        type: data.type,
        title: notification.request.content.title ?? "Ovalball",
        body: notification.request.content.body ?? "",
        onPress: () => {
          markOpened(data)
          go(href)
        },
      })
    })

    // ANSWERED FROM THE NOTIFICATION: Reply, or one of the quick answers. Sent through the platform's own
    // idempotent send under this person's session; the notification it answers is then read, as opening
    // it would have made it. Nothing navigates -- the person chose not to open the app.
    const answer = (response: Notifications.NotificationResponse): boolean => {
      const data = unwrapPushData(response.notification.request.content.data)
      if (response.actionIdentifier === "react-thumbs") {
        // A reaction is not reading: the notification stays as it was, and the thread is not marked read.
        void reactFromNotification(data).then((ok) => {
          if (!ok) void noticeAnswerNotSent()
        })
        return true
      }
      if (!isMessageAnswer(response.actionIdentifier)) return false
      void sendMessageAnswer(data, response.actionIdentifier, response.userText).then((sent) => {
        if (sent) markOpened(data)
        else void noticeAnswerNotSent()
      })
      return true
    }

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (answer(response)) return
      open(unwrapPushData(response.notification.request.content.data))
    })

    return () => {
      receivedSub.remove()
      responseSub.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `contextRef` carries the live value deliberately.
  }, [router])
}
