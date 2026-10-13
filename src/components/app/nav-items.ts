import { BookOpen, Building2, CalendarDays, House, Inbox, Map as MapIcon, MessageSquare, MessagesSquare, Shield, TrainFront, TrendingUp, Users, type LucideIcon } from "lucide-react";

export type NavKey = "today" | "map" | "departures" | "arrivals" | "timetable" | "junction" | "network" | "library" | "inbox" | "corporate" | "market";
export type NavItem = { key: NavKey; label: string; href: string; Icon: LucideIcon; built: boolean };

/** Signed-in sections (handoff section 3). `built` is false until the screen exists; those show as "Soon". */
export const NAV = {
  today: { key: "today", label: "Today", href: "/today", Icon: House, built: true },
  map: { key: "map", label: "Map", href: "/map", Icon: MapIcon, built: true },
  departures: { key: "departures", label: "Departures", href: "/departures", Icon: TrainFront, built: true },
  arrivals: { key: "arrivals", label: "Arrivals", href: "/arrivals", Icon: Inbox, built: true },
  timetable: { key: "timetable", label: "Timetable", href: "/timetable", Icon: CalendarDays, built: false },
  junction: { key: "junction", label: "Junction", href: "/junction", Icon: MessagesSquare, built: false },
  network: { key: "network", label: "Network", href: "/network", Icon: Users, built: false },
  library: { key: "library", label: "Library", href: "/library", Icon: BookOpen, built: false },
  inbox: { key: "inbox", label: "Inbox", href: "/inbox", Icon: MessageSquare, built: true },
  /** The employer side (dev/corporate-plan.md): set up a company, or work in one a Recruiter admin added you to. */
  corporate: { key: "corporate", label: "Corporate", href: "/corporate", Icon: Building2, built: true },
  /** Openings, pay and trends by role and place (handoff C6). Example figures until a licensed source exists. */
  market: { key: "market", label: "Market", href: "/market", Icon: TrendingUp, built: true },
} satisfies Record<NavKey, NavItem>;

/** Desktop top bar. */
export const TOP_NAV = (["today", "map", "departures", "arrivals", "timetable", "junction", "market"] as const).map((k) => NAV[k]);
/** Phone tab bar; Network, Library, Market and Timetable move to the avatar menu. */
export const TAB_NAV = (["today", "map", "departures", "arrivals", "junction"] as const).map((k) => NAV[k]);
export const MENU_NAV = (["inbox", "corporate", "library", "market", "network", "timetable"] as const).map((k) => NAV[k]);
/** CareerMetro's own company review page. In the avatar menu only for admins, decided on the server (src/lib/admin). */
export const ADMIN_LINK = { label: "Admin", href: "/admin/companies", Icon: Shield } as const;
