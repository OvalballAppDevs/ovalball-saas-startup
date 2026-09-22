import {
  Bell,
  BookOpen,
  Camera,
  Download,
  FileText,
  Image,
  Paperclip,
  Sparkles,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  House,
  IdCard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Receipt,
  Users,
  WifiOff,
  X,
} from "lucide-react-native"
import Svg, { Ellipse } from "react-native-svg"

/**
 * ONE ICON FAMILY, AND IT IS THE WEBSITE'S.
 *
 * Lucide, which `lucide-react` already draws on every web screen -- so a calendar is the same calendar
 * on both clients and nobody has to learn two visual languages for one product. No emoji, and no
 * second set borrowed for the one shape the first was missing.
 *
 * THE EXCEPTION IS FIXTURES, and it is the interesting one. There is no rugby ball in Lucide, and the
 * near misses -- a trophy, a flag, a generic ball -- all say something Ovalball does not mean. The
 * oval IS the brand mark and it IS a rugby ball, so Fixtures uses it. It is the one place in the app
 * where the icon is drawn rather than imported, and it is drawn from the same geometry as the logo.
 */

export {
  Bell,
  BookOpen,
  Camera,
  Download,
  FileText,
  Image,
  Paperclip,
  Sparkles,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  House,
  IdCard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Receipt,
  Users,
  WifiOff,
  X,
}

/** The rugby ball, as an icon, in the brand's own geometry. Matches Lucide's 24-unit grid and weight. */
export function OvalIcon({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Ellipse cx={12} cy={12} rx={10.5} ry={6} stroke={color} strokeWidth={2} transform="rotate(-38 12 12)" />
    </Svg>
  )
}
