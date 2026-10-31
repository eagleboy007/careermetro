/*
 * Junction's shared classes (docs/plans/junction-plan.md section 4, design rules): cobalt means progress only, so Post,
 * an upvote that is on and Save use ink and line-strong, never accent; kind and interest tags are neutral chips (red,
 * amber and green stay for gap status); every control is at least 44 px tall.
 */

export const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
export const card = "flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-surface p-4";
export const ink = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-[0.84rem] font-semibold text-bg hover:opacity-90 aria-disabled:opacity-60";
export const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.82rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
export const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";
/** A toggle (Upvote, Reshare, Save): on is ink with a strong edge, in words through aria-pressed. */
export const toggle =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-pressed:border-line-strong aria-pressed:bg-surface-2 aria-pressed:text-ink aria-disabled:opacity-60";
export const chip = "inline-flex min-h-8 items-center rounded-full bg-surface-2 px-2.5 text-[0.76rem] font-medium text-ink";
export const label = "font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted";
export const field = "w-full rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-[0.88rem] text-ink placeholder:text-muted";
export const note = "rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted";
