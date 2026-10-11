import { Flag } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

/** Where someone goes after their path: Today when signed in, else sign in (when accounts are on) or the waitlist. */
export type PathNext = { kind: "today" } | { kind: "sign-in"; href: string } | { kind: "waitlist" };

const NEXT: Record<PathNext["kind"], { text: string; label: string }> = {
  today: { text: "Your goals on Today carry on from here, one proof at a time.", label: "Go to Today" },
  "sign-in": { text: "Sign in to keep your path and prove your goals one at a time.", label: "Sign in to keep your path" },
  waitlist: { text: "Join the waitlist to hear when you can prove your skills and see matching roles.", label: "Join the waitlist" },
};

/**
 * The end of a path, once every step is done. Learning works toward a gap but never fills it: only proof (an exam, a
 * certification or work experience) does, so this says the gaps are still open and what comes next.
 */
export function PathEnd({ next }: { next: PathNext }) {
  const { text, label } = NEXT[next.kind];
  const href = next.kind === "today" ? "/today" : next.kind === "sign-in" ? next.href : "/#waitlist";
  return (
    <section aria-labelledby="path-end-title" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h2 id="path-end-title" className="flex items-center gap-2 font-sans text-lg font-semibold tracking-normal">
        <Flag size={18} strokeWidth={1.75} aria-hidden="true" className="text-accent" />
        Every step done
      </h2>
      <p className="text-sm">
        Your gaps aren&apos;t filled yet. Each one fills when you prove it with an exam, a certification or work experience.
      </p>
      <p className="text-sm text-muted">
        Practice and Match are coming next: interview practice for this role, then roles that fit what you&apos;ve proved. {text}
      </p>
      <ButtonLink href={href} className="w-fit">
        {label}
      </ButtonLink>
    </section>
  );
}
