import { roleProfiles } from "@/content";
import type { Gap } from "@/lib/schemas";

const labels = new Map(roleProfiles.flatMap((r) => r.groups.map((g) => [`${r.slug}:${g.id}`, g.label] as const)));

/**
 * The name a goal shows. A "one of these" goal can be proved with any of its skills, so once it is proved it shows the
 * group's label, not the skill the gap suggested (proof of Azure must not read as "AWS").
 */
export function goalName(gap: Pick<Gap, "skillName" | "groupId">, proved: boolean, roleSlug: string): string {
  if (!proved || !gap.groupId) return gap.skillName;
  return labels.get(`${roleSlug}:${gap.groupId}`) ?? gap.skillName;
}
