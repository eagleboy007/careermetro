import Link from "next/link";

/** Shown when a resume link is expired, wrong, or opened in another browser. */
export function ResumeNotFound() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <p className="font-semibold">We couldn&apos;t find this resume.</p>
      <p className="text-sm text-muted">
        Resumes added without an account are deleted after 24 hours, and can only be opened in the browser that added them.
      </p>
      <Link href="/start" className="text-sm font-medium underline underline-offset-2">
        Add your resume again
      </Link>
    </div>
  );
}
