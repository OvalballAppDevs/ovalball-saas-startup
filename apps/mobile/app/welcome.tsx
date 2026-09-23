import { useRouter } from "expo-router"

import { WelcomeScreen } from "../src/components/welcome/welcome-screen"

/**
 * THE PUBLIC WELCOME. Where a signed-out session lands; a signed-in one is sent past it by the gate
 * in `_layout.tsx` before it can be seen. The screen itself grants nothing and decides nothing.
 */
export default function Welcome() {
  const router = useRouter()
  return <WelcomeScreen onLogIn={() => router.push("/sign-in")} />
}
