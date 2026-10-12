/**
 * The tag on a "Your choice" goal: a goal the person added themselves, such as from a job check. It never changes the
 * match, so it takes the neutral chip style, not a gap colour or the progress colour.
 */
export function ChoiceTag({ company }: { company: string | null }) {
  const text = `Your choice${company ? ` · for ${company}` : ""}`;
  return (
    <span title={text} className="inline-block min-w-0 max-w-full truncate whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
      {text}
    </span>
  );
}
