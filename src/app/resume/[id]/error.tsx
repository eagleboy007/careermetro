"use client";

/** Shown when a resume, role or gaps page fails to load. The error itself is logged on the server. */
export default function ResumeError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16">
      <p className="font-semibold">Something went wrong loading this page.</p>
      <p className="text-sm text-muted">Your resume is safe. Please try again in a minute.</p>
      <button type="button" onClick={() => retry()} className="self-start text-sm font-medium underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}
