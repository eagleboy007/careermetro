import { TrainFront } from "lucide-react";
import type { TodayView } from "@/lib/schemas/today";
import { weekStrip } from "@/lib/today/logic";
import { DeparturesBoard } from "./departures-board";
import { FirstSignupHero } from "./first-signup-hero";
import { NoResumeHero } from "./no-resume-hero";
import { RideCard } from "./ride-card";
import { SignalCheckCard } from "./signal-check";
import { YourGoals } from "./your-goals";

type Props = {
  view: TodayView;
  /** "Evening, Priya." and "Thursday", worked out by the caller in India time. */
  greeting: string;
  dayLabel: string;
  /** The board clock, "19:42". */
  clock: string;
  /** For /design: never uploads. */
  demo?: boolean;
};

/**
 * The Today screen body for any user state (handoff 4 and 5): the ride or a welcome on top, then the signal check and
 * Your goals on the left and the departures board on the right; one column on small screens.
 * The caller wraps it in a RideProvider with `view.ride?.tasks`, so the streak chip in the app bar shares the ticks.
 */
export function TodayScreen({ view, greeting, dayLabel, clock, demo = false }: Props) {
  const week = weekStrip(view.rideDays, view.today);
  const board = view.jobSearch ? (
    <DeparturesBoard rows={view.departures} clock={clock} locked={view.state === "no_resume"} />
  ) : (
    <section aria-label="Job search is off" className="flex items-start gap-3 rounded-lg border border-line bg-surface px-[22px] py-5 text-[0.88rem]">
      <TrainFront size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <span>
        <b className="font-semibold">Job search is off.</b> Your ride keeps going. Departures come back when you switch it on.
      </span>
    </section>
  );

  let top: React.ReactNode = null;
  if (view.state === "no_resume") top = <NoResumeHero firstName={view.firstName} demo={demo} />;
  else if (view.state === "first_signup" && view.firstSignup && view.ride)
    top = <FirstSignupHero firstName={view.firstName} destination={view.destination} summary={view.firstSignup} ride={view.ride} />;
  else if (view.ride) top = <RideCard ride={view.ride} greeting={greeting} dayLabel={dayLabel} week={week} />;

  return (
    <div className="grid min-w-0 items-start gap-[22px] lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      {top && <div className="min-w-0 lg:col-span-2">{top}</div>}
      <div className="flex min-w-0 flex-col gap-[22px]">
        {view.signalCheck && <SignalCheckCard check={view.signalCheck} />}
        {view.goals.length > 0 && (
          <YourGoals
            goals={view.goals}
            track={view.track}
            moreGoals={view.moreGoals}
            goalsMetThisMonth={view.goalsMetThisMonth}
            suggestedGoal={view.suggestedGoal}
            showExtras={view.state === "returning"}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-[22px]">{board}</div>
    </div>
  );
}
