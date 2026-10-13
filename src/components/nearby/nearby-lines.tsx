import { ArrowRight, Route } from "lucide-react";
import Link from "next/link";
import type { NearbyLine, NearbyLines } from "@/lib/schemas";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
/** "To add" names shown before folding the rest into "and N more", as the prototype does. */
const ADD_SHOWN = 3;

const names = (list: string[]) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** "Data Analyst shares 4 of its 7 key skills with you." The one sentence each line says, on Me and on the Map. */
export const sharesSentence = (l: Pick<NearbyLine, "title" | "shared" | "total">) =>
  `${l.title} shares ${l.shared} of its ${l.total} key ${l.total === 1 ? "skill" : "skills"} with you.`;

/** The plain empty state: no line is near; say how close the closest one is, when one shares anything. */
export const emptySentence = (closest: NearbyLines["closest"]) =>
  closest
    ? `None of our other roles shares at least half its key skills with you yet. The closest, ${closest.title}, shares ${closest.shared} of its ${closest.total}.`
    : "None of our other roles shares a key skill with you yet.";

/** What a line asks for that the person doesn't show yet, as the prototype words it: "Add: A, B, C and 2 more". */
export function toAddText(l: Pick<NearbyLine, "toAdd">): string {
  if (!l.toAdd.length) return "No key skills to add";
  const shown = l.toAdd.slice(0, ADD_SHOWN).map((s) => (s.outdated ? `${s.name} (refresh)` : s.name));
  const more = l.toAdd.length - shown.length;
  return `Add: ${more ? `${shown.join(", ")} and ${more} more` : names(shown)}`;
}

/**
 * Nearby lines (pending item 24a; prototype v2 Market "Nearby lines"): roles that share at least half their key skills
 * with the person, each with the share, a bar, the skills to add and the ones only listed on the resume. Looking only:
 * nothing here changes goals, gaps or the match. Switching target role goes through the existing role picker.
 */
export function NearbyLinesList({ nearby, changeRoleHref }: { nearby: NearbyLines; changeRoleHref?: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      {nearby.lines.length ? (
        <ul className="grid gap-2.5 min-[760px]:grid-cols-2">
          {nearby.lines.map((l) => (
            <NearbyCard key={l.slug} line={l} />
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-2.5 rounded-[14px] border border-dashed border-line px-3.5 py-3 text-[0.86rem] text-muted">
          <Route size={18} {...ICON} className="mt-0.5 shrink-0" />
          {emptySentence(nearby.closest)}
        </p>
      )}
      <p className="text-[0.76rem] text-muted">
        From CareerMetro role profiles and your resume. Only skills shown in your work, or proved, count as shared. Looking here changes none of your goals.
      </p>
      {changeRoleHref && (
        <Link href={changeRoleHref} className="inline-flex min-h-11 items-center gap-1 self-start text-[0.84rem] font-[550] text-muted hover:text-ink">
          Change your target role
          <ArrowRight size={15} {...ICON} />
        </Link>
      )}
    </div>
  );
}

export function NearbyCard({ line: l }: { line: NearbyLine }) {
  const proved = l.sharedSkills.filter((s) => s.byProof).length;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <Route size={18} {...ICON} className="shrink-0 text-muted" />
        <b className="min-w-0 flex-1 text-[0.92rem] font-semibold">{l.title}</b>
        <span aria-hidden="true" className="whitespace-nowrap font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
          {l.shared} of {l.total} skills
        </span>
      </div>
      <p className="text-[0.84rem]">
        {sharesSentence(l)}
        {proved > 0 && <span className="text-muted"> {proved === 1 ? "One of them is" : `${proved} of them are`} proved.</span>}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((l.shared / l.total) * 100)}%` }} />
      </div>
      <p className="text-[0.8rem] text-muted">{toAddText(l)}</p>
      {l.onResume.length > 0 && (
        <p className="text-[0.8rem] text-muted">On your resume, not yet shown in work: {names(l.onResume)}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">{l.experience}</span>
        <Link href={`/roles/${l.slug}`} className="ml-auto inline-flex min-h-11 items-center gap-1 text-[0.82rem] font-[550] text-ink underline-offset-2 hover:underline">
          See the role
          <span className="sr-only">: {l.title}</span>
          <ArrowRight size={15} {...ICON} />
        </Link>
      </div>
    </li>
  );
}
