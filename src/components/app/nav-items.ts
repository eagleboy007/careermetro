import { BookOpen, Building2, CalendarDays, FileText, House, Inbox, Map as MapIcon, MessageSquare, MessageSquareText, MessagesSquare, Play, Route, Shield, TrainFront, TrendingUp, Users, type LucideIcon } from "lucide-react";

export type NavKey = "today" | "map" | "departures" | "arrivals" | "timetable" | "junction" | "network" | "library" | "inbox" | "corporate" | "market" | "match" | "practice" | "mock" | "builder";
/** `elite` marks an Elite screen: the menu shows an Elite label next to it (handoff 12l). */
export type NavItem = { key: NavKey; label: string; href: string; Icon: LucideIcon; built: boolean; elite?: boolean };

/** Signed-in sections (handoff section 3). `built` is false until the screen exists; those show as "Soon". */
export const NAV = {
  today: { key: "today", label: "Today", href: "/today", Icon: House, built: true },
  map: { key: "map", label: "Map", href: "/map", Icon: MapIcon, built: true },
  departures: { key: "departures", label: "Departures", href: "/departures", Icon: TrainFront, built: true },
  arrivals: { key: "arrivals", label: "Arrivals", href: "/arrivals", Icon: Inbox, built: true },
  timetable: { key: "timetable", label: "Timetable", href: "/timetable", Icon: CalendarDays, built: false },
  junction: { key: "junction", label: "Junction", href: "/junction", Icon: MessagesSquare, built: false },
  /** Connections and name search (FR-49, handoff 12j). In the avatar menu, with a count of requests waiting. */
  network: { key: "network", label: "Network", href: "/network", Icon: Users, built: true },
  /** Free resources by goal (FR-51, handoff 12a). In the avatar menu. */
  library: { key: "library", label: "Library", href: "/library", Icon: BookOpen, built: true },
  inbox: { key: "inbox", label: "Inbox", href: "/inbox", Icon: MessageSquare, built: true },
  /** The employer side (dev/corporate-plan.md): set up a company, or work in one a Recruiter admin added you to. */
  corporate: { key: "corporate", label: "Corporate", href: "/corporate", Icon: Building2, built: true },
  /** Openings, pay and trends by role and place (handoff C6). Example figures until a licensed source exists. */
  market: { key: "market", label: "Market", href: "/market", Icon: TrendingUp, built: true },
  /** Roles the person is ready for now, and the ones a few weeks away (handoff 12i). */
  match: { key: "match", label: "Match", href: "/match", Icon: Route, built: true },
  /** Interview questions on the person's goals, with feedback in words (handoff 12h). Never fills a goal. */
  practice: { key: "practice", label: "Practice", href: "/practice", Icon: MessageSquareText, built: true },
  /** Interview prep (FR-50, handoff 12l): the question bank, timed tests and, next, mock interviews. In the avatar menu. */
  mock: { key: "mock", label: "Interview prep", href: "/mock", Icon: Play, built: true, elite: true },
  /** Build your resume from answers (FR-36, handoff 12k); in the avatar menu since handoff 12l. */
  builder: { key: "builder", label: "Build your resume", href: "/builder", Icon: FileText, built: true },
} satisfies Record<NavKey, NavItem>;

/** Desktop top bar. */
export const TOP_NAV = (["today", "map", "departures", "arrivals", "timetable", "junction", "market"] as const).map((k) => NAV[k]);
/** Phone tab bar; Network, Library, Market and Timetable move to the avatar menu. */
export const TAB_NAV = (["today", "map", "departures", "arrivals", "junction"] as const).map((k) => NAV[k]);
export const MENU_NAV = (["inbox", "corporate", "library", "practice", "mock", "builder", "match", "market", "network", "timetable"] as const).map((k): NavItem => NAV[k]);
/** CareerMetro's own company review page. In the avatar menu only for admins, decided on the server (src/lib/admin). */
export const ADMIN_LINK = { label: "Admin", href: "/admin/companies", Icon: Shield } as const;
