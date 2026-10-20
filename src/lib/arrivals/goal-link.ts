import { pitstopsFor, type PitstopGoal } from "@/lib/map/layout";

/*
 * The line under a role that closed with Not this time (v44 gap list item 47; prototype "AWS security is a goal on
 * your line (Pitstop 9). Ask again once you prove it."). A person can't apply to the same job twice, so the line says
 * what proving it does instead. It shows only when the data links them: a skill the job asked for (required, or a "one
 * of these" group the person hasn't proved any of) is the skill an open goal on the person's line is on now (after a
 * "Not for me" swap, the swapped-to skill, which is the name the Map shows), not proved and not skipped. The pitstop is
 * that goal's prove pitstop, numbered as the Map numbers them.
 */

export type GoalLink = { name: string; pitstop: number };
/** A goal of the line. `learns` is the skill it is on now when the person swapped it ("Not for me"); else `skillId`. */
export type LinkGoal = PitstopGoal & { skillId: string; name: string; learns?: string };

/** The job's skills a closed application could point at: what the job required that isn't already proved. */
function askedFor(requirements: { required: readonly string[]; oneOf: readonly (readonly string[])[] }, proved: ReadonlySet<string>): Set<string> {
  return new Set([...requirements.required, ...requirements.oneOf.filter((g) => !g.some((id) => proved.has(id))).flat()].filter((id) => !proved.has(id)));
}

/** The first goal on the line (in Map order) that the closed job asked for, or null when none links them. */
export function goalLinkFor(
  requirements: { required: readonly string[]; oneOf: readonly (readonly string[])[] },
  line: readonly LinkGoal[],
  proved: ReadonlySet<string>,
): GoalLink | null {
  const asked = askedFor(requirements, proved);
  const stops = pitstopsFor(line);
  const i = stops.findIndex((p) => p.kind === "prove" && !p.goal.proved && !p.goal.skipped && asked.has(p.goal.learns ?? p.goal.skillId));
  return i === -1 ? null : { name: stops[i].goal.name, pitstop: i + 1 };
}

/** The line for each closed application whose job links to a goal. */
export function goalLinksFor(
  closed: readonly { applicationId: string; requirements: { required: readonly string[]; oneOf: readonly (readonly string[])[] } }[],
  line: readonly LinkGoal[],
  proved: ReadonlySet<string>,
): Record<string, GoalLink> {
  const out: Record<string, GoalLink> = {};
  for (const c of closed) {
    const link = goalLinkFor(c.requirements, line, proved);
    if (link) out[c.applicationId] = link;
  }
  return out;
}

/** The sentence: the prototype's first half; its "Ask again" is untrue, as each job takes one application. */
export const goalLinkText = (l: GoalLink) => `${l.name} is a goal on your line (Pitstop ${l.pitstop}). Prove it and roles like this one open up.`;
