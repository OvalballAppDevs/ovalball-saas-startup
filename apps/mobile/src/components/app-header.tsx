import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { removeClubCrest, removeMyAvatar, replaceClubCrest, replaceMyAvatar } from "../identity/images"
import { ClubCrest, PersonAvatar } from "./identity"
import { PictureSheet, type PictureAction } from "./picture-sheet"
import { HeaderUtilities } from "./header-utilities"
import { ChevronDown, ChevronRight } from "./icons"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../design/tokens"

/**
 * THE HEADER — who I am, what I am operating as, and what needs me.
 *
 * NOT THE DESKTOP IDENTITY BLOCK. The sidebar's version can afford an avatar, a name, a role, a club
 * and a switcher stacked vertically because it has a column to itself. A phone has about 56pt before
 * the header is stealing the content's room, so this is one row: the person on the left, the context
 * in the middle as the tappable thing, notifications on the right.
 *
 * THE CONTEXT IS THE BUTTON, and it is the widest target on the row, because switching is the single
 * most characteristic thing this product does. A chevron says so; an avatar that silently opens a
 * menu does not.
 *
 * THE AVATAR IS THE PERSON. It stays the signed-in adult even when the selected context is a child --
 * the header says who you ARE, and the context row beside it says what you are looking at. This is the
 * platform-wide invariant, and the components it uses have nowhere to pass a club crest.
 *
 * AND THE PICTURE IS THE CONTROL. Tapping the avatar changes the avatar; tapping the club crest changes
 * the crest, for somebody who may. That is the owner's instruction -- "I should be able to click the
 * profile picture in the top left and change the profile picture there and then, on club admin I should
 * be able to click the club logo at the top and change that too and it changes in canonically" -- and
 * the last word is the one that matters: each write goes to the ONE canonical column the whole platform
 * reads, so the new picture appears in the sidebar, in a conversation, on a fixture card, in the Club
 * Directory and in an email, because all of those already read it.
 *
 * TWO PICTURES, TWO CONTROLS, NO SUBSTITUTION. A person is not a club. The avatar control offers only a
 * person's picture and the crest control only a club's -- there is no shared "upload an image" path
 * either could reach through, which is the same discipline that removed the `fallback` prop the website
 * once had after a team's playing shirt ended up where a club's crest belonged.
 *
 * THE CREST IS A CONTROL ONLY FOR SOMEBODY THE WRITE WOULD ADMIT. `club.logo.manage` is asked of
 * `my_capabilities`, which is the same engine the storage policy evaluates, so for everybody else the
 * crest stays a plain picture. A control that is offered and then refused is worse than no control.
 */
export function AppHeader({
  onOpenContexts,
  tone = "forest",
  bottomRule = true,
}: {
  onOpenContexts: () => void
  /**
   * WHICH GROUND THIS HEADER IS STANDING ON.
   *
   * OWNER DESIGN-SYSTEM RULE (physical review correction pass): deep forest is now the default
   * authenticated top chrome across the app, not a special case for a screen whose whole upper half is
   * the brand ground. White was never a deliberate choice for the other root screens -- it was simply
   * what this prop defaulted to before anybody had reason to say otherwise, and the physical build made
   * that omission visible. "chalk" remains available for a screen with a genuine, deliberate reason to
   * differ (an immersive surface, a printed-document-style page) -- it is an opt-OUT now, not the
   * default a new screen silently inherits by doing nothing.
   *
   * IT IS A GROUND, NOT A THEME. The same identity, the same three utilities, the
   * same badges from the same canonical read; only the ink changes so it stays
   * readable. Nothing about what the header SAYS depends on this.
   */
  tone?: "chalk" | "forest"
  /** False where the header runs straight into more of its own ground. */
  bottomRule?: boolean
}) {
  const insets = useSafeAreaInsets()
  const onForestGround = tone === "forest"
  const ink = onForestGround ? onForest.primary : colour.ink
  const inkQuiet = onForestGround ? onForest.secondary : colour.inkMuted
  const { person, active, contexts, club, unread, refreshIdentityImages } = useAppContexts()
  const switchable = contexts.length > 1
  const [picture, setPicture] = useState<PictureAction | null>(null)

  /** Resolves to an error sentence, or null when the canonical write succeeded. */
  const avatarAction: PictureAction = {
    subject: "your picture",
    onReplace: async (file) => {
      const result = await replaceMyAvatar(supabase, file)
      if (!result.ok) return result.message
      await refreshIdentityImages()
      return null
    },
    onRemove: person.avatarUrl
      ? async () => {
          const result = await removeMyAvatar(supabase)
          if (!result.ok) return result.message
          await refreshIdentityImages()
          return null
        }
      : null,
  }

  const crestAction: PictureAction | null = club.clubId
    ? {
        subject: "the club crest",
        onReplace: async (file) => {
          const result = await replaceClubCrest(supabase, club.clubId!, file)
          if (!result.ok) return result.message
          await refreshIdentityImages()
          return null
        },
        // Removing the club's OWN upload does not blank the crest: the canonical
        // resolver falls back to the Club Directory's branding logo, which is a
        // real identity rather than a gap. So it is offered only where there is
        // an upload to remove.
        onRemove: club.hasOwnCrest
          ? async () => {
              const result = await removeClubCrest(supabase, club.clubId!)
              if (!result.ok) return result.message
              await refreshIdentityImages()
              return null
            }
          : null,
      }
    : null
  // The OWNING CLUB's identity, from the provider -- so every screen shows the same crest and the same
  // initials. Taking it as a prop is how the team's own initials ended up where the club's belong on
  // the screens that did not pass it.
  const clubName = club.name
  const crestUrl = club.crestUrl

  /*
    WHAT THE CONTEXT ROW SAYS, AND WHY THE CHILD'S NAME LEADS.

    Standing in a parent context, this read:

        Under 12 Boys
        Ovalball UAT RUFC · Under 12 Boys

    -- the team twice, the child not at all, and no word for what the viewer IS.
    `label` is the plain team name on purpose (every header and nav consumer
    expects that), and `switcherLabel` is the one field that names the specific
    child, which is exactly what this row should lead with: a guardian of two is
    looking at ONE of them, and the whole point of having switched is which.

    THE ROLE IS SAID, as it is on the website. "Parent/Guardian" is the viewer's
    relationship, not the child's -- the caption keeps it last, after the club
    and the team, so it reads as what you are rather than as what they are.
  */
  const title = active ? (active.subjectName ? active.switcherLabel : active.label) : "Ovalball"
  const caption = active
    ? active.subjectName
      ? [active.subjectClubName, active.label, active.roleLabel].filter(Boolean).join(" · ")
      : [clubName && clubName !== active.label ? clubName : null, active.roleLabel].filter(Boolean).join(" · ")
    : ""

  return (
    <>
      {/* THE STATUS BAR JOINS THE HEADER'S OWN GROUND (Section 4 of the chrome pass) -- light content
          on forest, dark on chalk, set here so every screen that uses this one shared header gets it
          for free rather than having to remember a second, separate fix per screen. */}
      <StatusBar style={onForestGround ? "light" : "dark"} />
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.lg,
          backgroundColor: onForestGround ? surface.forest : colour.chalk,
          borderBottomWidth: bottomRule ? 1 : 0,
          borderBottomColor: onForestGround ? onForest.line : colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
        }}
      >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={person.avatarUrl ? "Your picture. Change it" : "You have no picture. Add one"}
        accessibilityHint="Opens Take Photo and Choose Photo"
        onPress={() => setPicture(avatarAction)}
        hitSlop={6}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <PersonAvatar name={person.firstName} url={person.avatarUrl} size={36} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? `Viewing ${title}, ${caption}` : "No context selected"}
        accessibilityHint={switchable ? "Opens the clubs, teams and children you can switch to" : undefined}
        accessibilityState={{ disabled: !switchable }}
        disabled={!switchable}
        onPress={onOpenContexts}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          minHeight: TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.sm,
          marginLeft: -space.xs,
          borderRadius: radius.md,
          backgroundColor: pressed
            ? onForestGround
              ? "rgba(255,255,255,0.08)"
              : "rgba(16,21,18,0.05)"
            : "transparent",
        })}
      >
        {active &&
          !active.subjectName &&
          (club.canManageCrest && crestAction ? (
            /* The crest is its own control, so tapping it changes the crest
               rather than opening the context switcher it sits inside. */
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${clubName ?? active.label} crest. Change it`}
              accessibilityHint="Opens Take Photo and Choose Photo"
              onPress={() => setPicture(crestAction)}
              hitSlop={6}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <ClubCrest clubName={clubName ?? active.label} url={crestUrl ?? active.logoUrl} size={30} />
            </Pressable>
          ) : (
            <ClubCrest clubName={clubName ?? active.label} url={crestUrl ?? active.logoUrl} size={30} />
          ))}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* BOLD, because it is the answer to "who am I looking at". */}
          <Text style={[type.bodyMedium, { color: ink, fontFamily: "Inter_600SemiBold", fontSize: 15 }]} numberOfLines={1}>
            {title}
          </Text>
          {!!caption && (
            <Text style={[type.caption, { color: inkQuiet }]} numberOfLines={1}>
              {caption}
            </Text>
          )}
        </View>
        {switchable && <ChevronDown size={16} color={inkQuiet} />}
      </Pressable>

      {/* MESSAGES · NOTIFICATIONS · SUPPORT.
          Three utilities rather than one bell, in the same order the website's
          own header has carried them since Support was built. Three independent
          counts, from the one canonical read -- deriving any of them from
          another is how a bell stops going down when you clear your messages. */}
      <HeaderUtilities unread={unread} tone={tone} />

      {/* One sheet for either picture. It stays open while the write is in
          flight and closes on the server's success, so nobody is left looking
          at the old picture wondering whether anything happened. */}
      <PictureSheet action={picture} onClose={() => setPicture(null)} />
      </View>
    </>
  )
}

/**
 * THE OTHER HALF OF THE SAME SYSTEM -- a detail/flow screen's own header (owner chrome pass): back,
 * a title, an optional legitimate action, on the SAME forest ground and the SAME status-bar handling
 * as `AppHeader`, so a tap from a root screen into a fixture, a request or any other detail never drops
 * from forest into an accidental white bar. Not a copy: every screen that has been hand-copying this
 * back-chevron block (31 of them, at last count) is a candidate to move onto this one component, not a
 * reason to invent a second version of it -- but that migration is its own pass, not tonight's.
 *
 * NEVER THE ROOT IDENTITY HEADER'S CONTENT. A detail screen is "where am I, how do I leave", not "who
 * am I and what am I standing in" -- copying `AppHeader`'s avatar/context/switcher onto every fixture
 * and request screen would be answering a question nobody is asking there.
 */
export function OvalballDetailHeader({
  title,
  onBack,
  tone = "forest",
  rightAction,
}: {
  title: string
  onBack: () => void
  /** "chalk" only for a screen with a genuine, deliberate reason to differ -- see `AppHeader`'s own note. */
  tone?: "chalk" | "forest"
  /** A single legitimate action this specific screen needs beside its title -- never a second identity block. */
  rightAction?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const onForestGround = tone === "forest"
  const ink = onForestGround ? onForest.primary : colour.ink

  return (
    <>
      <StatusBar style={onForestGround ? "light" : "dark"} />
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          backgroundColor: onForestGround ? surface.forest : colour.chalk,
          borderBottomWidth: 1,
          borderBottomColor: onForestGround ? onForest.line : colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: ink, flex: 1 }]}>
          {title}
        </Text>
        {rightAction}
      </View>
    </>
  )
}
