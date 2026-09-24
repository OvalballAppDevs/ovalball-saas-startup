import { useRouter } from "expo-router"

import { WelcomeScreen } from "../src/components/welcome/welcome-screen"

/**
 * THE PUBLIC WELCOME. Where a signed-out session lands; a signed-in one is sent past it by the gate
 * in `_layout.tsx` before it can be seen. The screen itself grants nothing and decides nothing.
 *
 * GET STARTED enters the app's own decision screen (CA-M11): the four real ways in, each sent to its
 * canonical surface. It no longer opens the website blind.
 */
export default function Welcome() {
  const router = useRouter()
  return <WelcomeScreen onGetStarted={() => router.push("/get-started")} onLogIn={() => router.push("/sign-in")} />
}
