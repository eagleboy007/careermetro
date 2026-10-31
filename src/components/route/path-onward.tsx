import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { ButtonLink } from "@/components/ui/button";
import { NEXT, type PathNext } from "./path-end";

/**
 * What Today shows for a signed-in person, compared with this path: Today and the Map follow their destination
 * (`currentAnalysis`), so this path's goals are there only when that check is for this resume and role;
 * `other-resume` is the same role checked on another resume (the newest gap check, not necessarily the newest resume; T123). `unknown` when there is no check or it couldn't be read.
 */
export type TodayRide =
  | { is: "this-path" }
  | { is: "other-resume" }
  | { is: "other-check"; roleTitle: string | null }
  | { is: "unknown" };

/** The way on from a path that isn't finished: Today when signed in, else sign in (when accounts are on) or the waitlist. */
export type PathOnwardNext = { kind: "today"; ride: TodayRide } | Exclude<PathNext, { kind: "today" }>;

export const CONTINUE_LABEL = "Continue to Today";

/** The line under the heading for a signed-in person, true to what Today and the Map show. */
export function todayText(ride: TodayRide): string {
  if (ride.is === "this-path") {
    return "Your goals for this role stay on Today and your Map, so you can tick them off as you go.";
  }
  if (ride.is === "other-resume") return "Today and your Map follow the gap check on another of your resumes, not this one. You can still mark steps done here.";
  if (ride.is === "other-check") {
    return `Today and your Map follow your destination${ride.roleTitle ? `, ${ride.roleTitle}` : ""}, not this path. To change it, use Make this my destination on this role's gaps. You can still mark steps done here.`;
  }
  return "Today shows your goals and daily ride.";
}

/**
 * The way forward from a path, always there below the steps until every step is done (then PathEnd takes its place),
 * so no one thinks they must finish every step before moving on.
 */
export function PathOnward({ next }: { next: PathOnwardNext }) {
  const text = next.kind === "today" ? todayText(next.ride) : NEXT[next.kind].text;
  const label = next.kind === "today" ? CONTINUE_LABEL : NEXT[next.kind].label;
  const href = next.kind === "today" ? "/today" : next.kind === "sign-in" ? next.href : "/#waitlist";
  // /design shows several at once, so each heading gets its own id.
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5">
      <h2 id={titleId} className="font-sans text-lg font-semibold tracking-normal">
        You don&apos;t need to finish every step first
      </h2>
      <p className="text-sm text-muted">{text}</p>
      <ButtonLink href={href}>
        {label}
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </ButtonLink>
    </section>
  );
}
