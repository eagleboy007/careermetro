import { certifications } from "@/content";

/**
 * Certificates on our list that fill a goal: those that fully prove one of its skills (dev/proof-plan.md). `lifetime`
 * marks one that never expires, the only kind Add a certificate offers "It never expires" for (T156).
 */
export function certificatesFor(proofSkills: readonly string[]): { id: string; name: string; issuer: string; lifetime?: true }[] {
  return certifications
    .filter((c) => c.proves.some((s) => proofSkills.includes(s)))
    .map(({ id, name, issuer, lifetime }) => ({ id, name, issuer, ...(lifetime ? { lifetime } : {}) }));
}
