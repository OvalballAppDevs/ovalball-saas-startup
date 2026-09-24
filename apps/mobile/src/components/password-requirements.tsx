import { Text, View } from "react-native"

import { PASSWORD_REQUIREMENTS } from "@ovalball/contracts"

import { Check } from "./icons"
import { colour, space, type } from "../design/tokens"

/**
 * THE LIVE CHECKLIST, derived from `PASSWORD_REQUIREMENTS` in the shared package, so the list cannot
 * describe a rule the check does not apply. Used by Set a New Password (recovery) and Change Password
 * (Security): one component, one set of words, one rule.
 *
 * THE BREACH CHECK IS NOT CLAIMED HERE, and that is deliberate. Ovalball's Have I Been Pwned check
 * lives in `lib/auth/password-policy.ts`, which is `server-only` and runs inside the website's actions.
 * This client sets the password through GoTrue directly, so that check does not run on this path -- and
 * telling somebody it did would be a security claim this build cannot keep. The right fix is
 * project-level leaked-password protection at the auth server, which is an owner decision.
 */
export function PasswordRequirements({ password }: { password: string }) {
  return (
    <View style={{ marginTop: space.lg, gap: 6 }}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>Your password needs</Text>
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = password.length > 0 && requirement.met(password)
        return (
          <View
            key={requirement.key}
            accessible
            accessibilityLabel={`${requirement.label}: ${met ? "met" : "not yet met"}`}
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: met ? colour.forest800 : "transparent",
                borderWidth: met ? 0 : 1.5,
                borderColor: colour.lineStrong,
              }}
            >
              {met && <Check size={10} color={colour.onForest} strokeWidth={3.5} />}
            </View>
            <Text style={[type.caption, { color: met ? colour.ink : colour.inkMuted, flex: 1 }]}>{requirement.label}</Text>
          </View>
        )
      })}
    </View>
  )
}
