import { certifications } from "@/content";

/** Certificates on our list that fill a goal: those that fully prove one of its skills (dev/proof-plan.md). */
export function certificatesFor(proofSkills: readonly string[]): { id: string; name: string; issuer: string }[] {
  return certifications.filter((c) => c.proves.some((s) => proofSkills.includes(s))).map(({ id, name, issuer }) => ({ id, name, issuer }));
}
