import type { RoleSkillView } from "@/lib/role-view";
import { PostingShareBar } from "./posting-share-bar";

/** Skills a role asks for, each with what employers expect and how often postings mention it. */
export function RoleSkillList({ skills }: { skills: RoleSkillView[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {skills.map((s) => (
        <li key={s.skillId} className="grid gap-2 p-4 sm:grid-cols-[1fr_200px] sm:items-center sm:gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium">{s.name}</p>
            <p className="text-sm text-muted">{s.expectation}</p>
          </div>
          <PostingShareBar share={s.postingShare} />
        </li>
      ))}
    </ul>
  );
}
