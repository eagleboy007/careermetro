import { certifications } from "@/content";
import type { JobCriteria } from "@/lib/schemas/corporate";
import { skillName } from "./job-content";
import type { CertificateOptionView, CriteriaView, JobCriteriaNames } from "./types";

/*
 * Express apply criteria (pending item 16; dev/express-apply-plan.md): what a job asks to be proved before applying,
 * and whether a person's proof meets it. Plain code over current accepted proofs; the model is never asked and the
 * resume alone never meets a criterion. Unmet criteria warn and never block. Server only: it reads the content files.
 */

const certById = new Map(certifications.map((c) => [c.id, c]));

/** A certificate's name, or its id if it has left our list since the job was saved. */
export const certificateName = (id: string): string => certById.get(id)?.name ?? id;

/** Certificate ids in the criteria that aren't on our list. */
export const unknownCertificates = (c: JobCriteria): string[] => c.certificates.filter((id) => !certById.has(id));

/** Our certificate list for the Post a job picker, by issuer then name. */
export const certificateOptions = (): CertificateOptionView[] =>
  certifications.map(({ id, name, issuer }) => ({ id, name, issuer })).sort((a, b) => a.issuer.localeCompare(b.issuer) || a.name.localeCompare(b.name));

/** The criteria as names, for Departures. */
export const criteriaNames = (c: JobCriteria): JobCriteriaNames => ({ verifiedSkills: c.verifiedSkills.map(skillName), certificates: c.certificates.map(certificateName) });

/**
 * Each criterion with met or not yet: a verified skill is met by current accepted proof of that skill, a certificate by
 * a current accepted certificate proof with that id. `proved` and `certificates` come from the person's proofs.
 */
export function criteriaStatus(c: JobCriteria, proved: ReadonlySet<string>, certificates: ReadonlySet<string>): CriteriaView {
  const lines = [
    ...c.verifiedSkills.map((id) => ({ kind: "skill" as const, label: skillName(id), met: proved.has(id) })),
    ...c.certificates.map((id) => ({ kind: "certificate" as const, label: certificateName(id), met: certificates.has(id) })),
  ];
  return { lines, met: lines.filter((l) => l.met).length, total: lines.length };
}
