import { BookOpen, Check, CirclePlay, Clock } from "lucide-react";

export type PathStepView = {
  title: string;
  hours: number;
  closes?: string;
  doneOn?: string;
  resources?: { title: string; provider: string; kind: "video" | "course" | "article"; url: string }[];
  proofTask?: string;
};

export function PathSteps({ steps, currentIndex }: { steps: PathStepView[]; currentIndex: number }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const now = i === currentIndex;
        const last = i === steps.length - 1;
        return (
          <li key={step.title} className="relative grid grid-cols-[28px_1fr] gap-3 pb-[18px]">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-[13px] top-7 w-0.5 ${done ? "bg-accent" : "bg-line"}`}
              />
            )}
            <span
              className={`grid size-7 place-items-center rounded-full border-2 font-mono text-xs ${
                done
                  ? "border-accent bg-accent text-on-accent"
                  : now
                    ? "border-accent bg-surface text-accent"
                    : "border-line bg-surface text-muted"
              }`}
            >
              {done ? <Check size={14} strokeWidth={2.5} aria-label="Done" /> : i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="font-semibold">{step.title}</p>
              <p className="flex flex-wrap gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
                  {step.hours} hrs
                </span>
                {step.doneOn && <span>Done {step.doneOn}</span>}
                {step.closes && <span>Closes: {step.closes}</span>}
              </p>
              {now &&
                step.resources?.map((r) => {
                  const Icon = r.kind === "video" ? CirclePlay : BookOpen;
                  return (
                    <a
                      key={r.url}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-sm bg-surface-2 px-2.5 py-2 text-[13px] hover:text-accent"
                    >
                      <Icon size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
                      {r.title} · {r.provider} · free
                    </a>
                  );
                })}
              {now && step.proofTask && (
                <p className="border-l-2 border-accent pl-2.5 text-[13px]">
                  <span className="font-semibold">Prove it:</span> {step.proofTask}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
