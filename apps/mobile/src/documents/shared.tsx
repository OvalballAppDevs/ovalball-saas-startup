import { Pressable, Text, View } from "react-native"
import { documentFileKind, formatFileSize, type LibraryDocument } from "@ovalball/contracts/documents/library"

import { useAppContexts } from "../context/contexts"
import { ChevronRight, Ellipsis, FileText, Folder, Image as ImageIcon } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE CLUB DOCUMENTS KIT -- the few shapes the library is drawn from, so a folder, a team and a document
 * read as one list on every level of it.
 */

/** The club of the context the person stands in. The library only ever shows that club's files. */
export function useLibraryClubId(): string | null {
  const { active } = useAppContexts()
  return active?.kind === "club" ? (active.clubId ?? active.id) : null
}

/**
 * The day a timestamp falls on IN THE UK. A document changed at 00:40 on a summer morning was changed
 * that morning, not the evening before, which is what reading the date straight off a UTC string says.
 */
function ukDay(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })
}

/** "Visitor Guide · 1.2 MB · 3 Oct 2026" -- what a document is, how big, and when it last changed. */
export function documentMetaLine(doc: LibraryDocument): string {
  const when = doc.archivedAt ? `Archived ${ukDay(doc.archivedAt)}` : ukDay(doc.updatedAt)
  return [doc.categoryLabel, formatFileSize(doc.sizeBytes), when].filter(Boolean).join(" · ")
}

export function ListGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text accessibilityRole="header" style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>
        {title.toUpperCase()}
      </Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>{children}</View>
    </View>
  )
}

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <View accessible={false} style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  )
}

/** A folder or a team's virtual folder: a destination, so a chevron. */
export function FolderRow({ name, detail, first, onPress }: { name: string; detail?: string | null; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[`Folder, ${name}`, detail].filter(Boolean).join(". ")}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET + 16,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <Tile>
        <Folder size={19} color={colour.forest800} />
      </Tile>
      <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={2}>
        {name}
      </Text>
      {!!detail && <Text style={[type.caption, { color: colour.inkMuted }]}>{detail}</Text>}
      <ChevronRight size={17} color={colour.inkSubtle} />
    </Pressable>
  )
}

/**
 * A document: tapping it opens it; the ellipsis offers everything else. Two sibling Pressables, never one
 * nested in the other, so VoiceOver reaches "More actions" as its own element (Team Documents found the
 * nested shape swallowed the inner button's label).
 */
export function DocumentRow({ doc, first, busy, onOpen, onMore }: { doc: LibraryDocument; first: boolean; busy: boolean; onOpen: () => void; onMore: () => void }) {
  const kind = documentFileKind(doc.mimeType)
  const meta = documentMetaLine(doc)
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: TOUCH_TARGET + 20,
        paddingLeft: space.lg,
        paddingRight: space.xs,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${doc.title}. ${kind.label}. ${meta}`}
        accessibilityHint="Opens the document"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onOpen}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed || busy ? 0.6 : 1 })}
      >
        <Tile>{kind.kind === "image" ? <ImageIcon size={19} color={colour.forest800} /> : <FileText size={19} color={colour.forest800} />}</Tile>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
            {doc.title}
          </Text>
          <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted }]}>
            {busy ? "Opening…" : meta}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${doc.title}`}
        onPress={onMore}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: TOUCH_TARGET / 2, backgroundColor: pressed ? "rgba(16,21,18,0.05)" : "transparent" })}
      >
        <Ellipsis size={20} color={colour.inkSubtle} />
      </Pressable>
    </View>
  )
}

/** One choice from a list, as rows: the Upload and Move destinations, the category. */
export function RadioList({ label, options, value, onChange }: { label: string; options: { key: string; label: string }[]; value: string; onChange: (key: string) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
      {options.map((o, index) => {
        const on = o.key === value
        return (
          <Pressable
            key={o.key || "root"}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 4,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colour.line,
              backgroundColor: pressed ? "rgba(16,21,18,0.03)" : on ? colour.mint100 : "transparent",
            })}
          >
            <View
              accessible={false}
              style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? colour.forest800 : colour.lineStrong, alignItems: "center", justifyContent: "center" }}
            >
              {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour.forest800 }} />}
            </View>
            <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}
