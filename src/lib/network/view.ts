import type { NetworkPerson } from "./store";
import type { NetworkRow } from "./types";

/* Turns store rows into what the /network page shows. Dates are written in India time, as everywhere in the app. */

const IST = "Asia/Kolkata";
const day = (d: Date, withYear: boolean) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: IST });

/** How each tab dates a row: when they connected, when the request came, or when it was sent and when it ends. */
export function networkRow(p: NetworkPerson, tab: "connections" | "requests" | "sent" | "find"): NetworkRow {
  const when =
    !p.at || tab === "find"
      ? null
      : tab === "connections"
        ? `Connected ${day(p.at, true)}`
        : tab === "requests"
          ? `Asked ${day(p.at, false)}`
          : `Sent ${day(p.at, false)}${p.endsAt ? ` · ends ${day(p.endsAt, false)} if not answered` : ""}`;
  return { id: p.id, name: p.name, username: p.username, aim: p.aim, city: p.city, verified: p.verified, common: p.common, mutual: p.mutual, state: p.state, how: p.how, when };
}
