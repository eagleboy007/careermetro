/** What someone in a role does on a normal day, one line each, as the role page lists it under "A normal day". */
export function RoleDay({ duties }: { duties: string[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {duties.map((d) => (
        <li key={d} className="p-4 text-sm">
          {d}
        </li>
      ))}
    </ul>
  );
}
