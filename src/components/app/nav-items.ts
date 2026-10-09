import { BookOpen, CalendarDays, House, Inbox, Map, MessagesSquare, TrainFront, Users, type LucideIcon } from "lucide-react";

export type NavItem = { key: string; label: string; href: string; Icon: LucideIcon; built: boolean };

/** Signed-in sections (handoff section 3). `built` is false until the screen exists; those show as "Soon". */
export const NAV: Record<string, NavItem> = {
  today: { key: "today", label: "Today", href: "/today", Icon: House, built: true },
  map: { key: "map", label: "Map", href: "/map", Icon: Map, built: false },
  departures: { key: "departures", label: "Departures", href: "/departures", Icon: TrainFront, built: false },
  arrivals: { key: "arrivals", label: "Arrivals", href: "/arrivals", Icon: Inbox, built: false },
  timetable: { key: "timetable", label: "Timetable", href: "/timetable", Icon: CalendarDays, built: false },
  junction: { key: "junction", label: "Junction", href: "/junction", Icon: MessagesSquare, built: false },
  network: { key: "network", label: "Network", href: "/network", Icon: Users, built: false },
  library: { key: "library", label: "Library", href: "/library", Icon: BookOpen, built: false },
};

/** Desktop top bar. */
export const TOP_NAV = ["today", "map", "departures", "arrivals", "timetable", "junction"].map((k) => NAV[k]);
/** Phone tab bar; Network, Library and Timetable move to the avatar menu. */
export const TAB_NAV = ["today", "map", "departures", "arrivals", "junction"].map((k) => NAV[k]);
export const MENU_NAV = ["network", "library", "timetable"].map((k) => NAV[k]);
