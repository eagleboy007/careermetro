/** What a signed-in screen shows while its data loads: a few quiet blocks in the page's shape, never a blank page. */
export function PageLoading() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-56 rounded-[24px] border border-line bg-surface motion-safe:animate-pulse" />
      <div aria-hidden="true" className="grid gap-4 min-[960px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="h-40 rounded-[20px] border border-line bg-surface motion-safe:animate-pulse" />
        <div className="h-40 rounded-[20px] border border-line bg-surface motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
