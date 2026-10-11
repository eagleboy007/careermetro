import type { ReactNode } from "react";

/**
 * A full-page message for when a page can't show: an error, or a link to nothing. Says what happened, that the
 * person's data is safe when it is, and gives a way forward. Server-safe, so error and not-found pages share it.
 */
export function PageNotice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">{text}</p>
      {children ? <div className="mt-2 flex flex-wrap gap-3">{children}</div> : null}
    </div>
  );
}
