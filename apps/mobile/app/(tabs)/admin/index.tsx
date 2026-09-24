import { Pressable, Text, View } from "react-native"
import { useRouter } from "expo-router"
import * as Linking from "expo-linking"
import type { AdminCentreSection } from "@ovalball/contracts/club/admin-centre"

import { AdminScreen } from "../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../src/admin/access"
import { webUrl } from "../../../src/config/environment"
import { ChevronRight, ExternalLink, Landmark, SlidersHorizontal } from "../../../src/components/icons"
import { CardSkeleton, EmptyState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * THE ADMIN CENTRE LANDING -- the club's jobs, for the person who may do them.
 *
 * Every row is a section the SERVER says this person may use at this club (`useAdminCentreAccess`,
 * from `my_capabilities`). Rows are never invented from a role label, and there are no dead rows:
 * a section the app does natively opens its screen; one that is deliberately on the web today says
 * so and opens the website's own page in the system browser -- the same job, the same authority,
 * never a WebView.
 */
export default function AdminCentre() {
  const router = useRouter()
  const { loading, clubId, sections, refresh } = useAdminCentreAccess()
  const native = sections.filter((s) => s.native)
  const web = sections.filter((s) => !s.native)

  return (
    <AdminScreen section="Admin Centre" onRefresh={() => void refresh()} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Admin Centre
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Running the club. Every change here is the club's own record, wherever it is made.</Text>
      </View>

      {loading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </View>
      )}

      {!loading && !clubId && <EmptyState title="Choose a club context" body="The Admin Centre works on the club you are viewing. Switch to a club context from the header." />}
      {!loading && clubId && sections.length === 0 && <EmptyState title="Nothing to administer here" body="You do not currently hold any administrative permission at this club." />}

      {native.length > 0 && (
        <Group title="In the App">
          {native.map((s) => (
            <SectionRow key={s.key} section={s} icon={<Landmark size={20} color={colour.forest800} strokeWidth={1.9} />} onPress={() => router.push(`/admin/${s.key}` as never)} />
          ))}
        </Group>
      )}

      {web.length > 0 && (
        <Group title="On the Web Today">
          {web.map((s) => (
            <SectionRow key={s.key} section={s} external icon={<SlidersHorizontal size={20} color={colour.forest800} strokeWidth={1.9} />} onPress={() => void Linking.openURL(`${webUrl}${s.webPath}`)} />
          ))}
        </Group>
      )}
    </AdminScreen>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={[type.overline, { color: colour.inkSubtle, marginBottom: space.sm }]}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>{children}</View>
    </View>
  )
}

function SectionRow({ section, icon, onPress, external = false }: { section: AdminCentreSection; icon: React.ReactNode; onPress: () => void; external?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={external ? `${section.label}. ${section.caption}. Opens the Ovalball website` : `${section.label}. ${section.caption}`}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 12, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent" })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{section.label}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, marginTop: 1 }]}>{section.caption}</Text>
      </View>
      {external ? <ExternalLink size={15} color={colour.inkSubtle} /> : <ChevronRight size={17} color={colour.inkSubtle} />}
    </Pressable>
  )
}
