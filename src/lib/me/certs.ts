import { certifications } from "@/content";
import { readYearMonth } from "@/lib/map/life-layout";
import { credlyBadgeId, credlyBadgePage } from "@/lib/proofs/credly";
import { CREDLY_NOTE_MESSAGES } from "@/lib/proofs/messages";
import type { Certification, CredlyCheckNote, HeldCertification, MeCertification } from "@/lib/schemas";

/** One accepted certificate proof, as src/lib/me/store.ts reads it from gap_proofs. Never the credential id or a name. */
export type ProofCertRow = {
  proofId: string;
  certId: string | null;
  credentialKey: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifier: string | null;
  url: string | null;
  badgeId: string | null;
  checkNote: CredlyCheckNote | null;
  createdAt: Date;
};

/** Today in India as YYYY-MM-DD: a certificate is current through its expiry date there. */
export const indiaDate = (now: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/** Profiles keep at most this many certifications; the public profile shows at most PUBLIC_CERTIFICATIONS of them. */
const MAX = 30;

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** "Mar 2025" from a date, "2024" or "May 2024" from a resume's YYYY or YYYY-MM. */
const month = (value: string | null) => (value ? (readYearMonth(value.slice(0, 7))?.label ?? null) : null);

const byName = new Map<string, Certification>();
for (const c of certifications) for (const n of [c.name, ...c.aliases]) if (!byName.has(key(n))) byName.set(key(n), c);

/**
 * The certifications on a profile (pending item 13, dev/profile-certs-plan.md decisions 1 to 4), in the order they
 * show: current certificate proofs, Verified with Credly first and then the most recently issued; then the resume's
 * current ones; then expired ones, marked. One entry per certificate. The public profile takes the first current ones
 * (src/lib/me/public.ts); the owner sees them all, with the Credly reason and the Check button.
 */
export function profileCertifications(input: { proofs: ProofCertRow[]; resume: HeldCertification[]; today: string }): MeCertification[] {
  const { today } = input;
  // The best proof of each certificate: verified, then current, then the most recently issued.
  const rank = (p: ProofCertRow) => [p.verifier === "credly" ? 1 : 0, !p.expiresOn || p.expiresOn >= today ? 1 : 0, p.issuedOn ?? "", p.createdAt.toISOString()] as const;
  const better = (a: ProofCertRow, b: ProofCertRow) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const best = new Map<string, ProofCertRow & { verified: boolean }>();
  const credentialVerified = new Set(input.proofs.filter((p) => p.verifier === "credly").map((p) => `${p.certId}|${p.credentialKey ?? p.proofId}`));
  for (const p of input.proofs) {
    if (!p.certId || !certifications.some((c) => c.id === p.certId)) continue;
    // Rows of one credential (one per skill it proves) share a verification.
    const row = { ...p, verified: credentialVerified.has(`${p.certId}|${p.credentialKey ?? p.proofId}`) };
    if (row.verified) row.verifier = "credly";
    const held = best.get(p.certId);
    if (!held || better(row, held)) best.set(p.certId, row);
  }

  const fromProofs: MeCertification[] = [...best.values()]
    .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
    .map((p) => {
      const cert = certifications.find((c) => c.id === p.certId)!;
      const expired = p.expiresOn && p.expiresOn < today ? month(p.expiresOn) : null;
      const canCheck = !!(p.url && credlyBadgeId(p.url));
      return {
        proofId: p.proofId,
        name: cut(cert.name, 160),
        issuer: cut(cert.issuer, 120),
        date: month(p.issuedOn),
        status: p.verified ? "verified" : "added",
        fromResume: false,
        expired,
        badgeUrl: p.verified && p.badgeId ? credlyBadgePage(p.badgeId) : null,
        note: !p.verified && p.checkNote ? CREDLY_NOTE_MESSAGES[p.checkNote] : null,
        canCheck,
      };
    });

  // The resume's own list, without repeats or anything a proof already shows.
  const seen = new Set<string>();
  for (const id of best.keys()) {
    const c = certifications.find((x) => x.id === id)!;
    for (const n of [c.name, ...c.aliases]) seen.add(key(n));
  }
  const thisYearMonth = today.slice(0, 7);
  const fromResume: MeCertification[] = [];
  for (const held of input.resume) {
    const name = held.name.trim();
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    const known = byName.get(key(name));
    const ended = held.expires && held.expires !== "none" && held.expires < thisYearMonth.slice(0, held.expires.length) ? month(held.expires) : null;
    fromResume.push({
      proofId: null,
      name: cut(name, 160),
      issuer: known ? cut(known.issuer, 120) : null,
      date: month(held.earned),
      status: "added",
      fromResume: true,
      expired: ended,
      badgeUrl: null,
      note: null,
      canCheck: false,
    });
  }

  const current = (c: MeCertification) => c.expired === null;
  return [...fromProofs.filter(current), ...fromResume.filter(current), ...fromProofs.filter((c) => !current(c)), ...fromResume.filter((c) => !current(c))].slice(0, MAX);
}
