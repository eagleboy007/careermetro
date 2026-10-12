import { Download } from "lucide-react";

/**
 * FR-20: download the confirmed resume as PDF or Word. Plain links: the route sends the file as an attachment, and a
 * refusal (say the session expired) opens as a short page instead of a saved error file.
 * `demo` points nowhere (/design).
 */
/** `named`: the file will carry the account's name; otherwise the person adds it. */
export function ResumeDownload({ resumeId, named, demo = false }: { resumeId: string; named: boolean; demo?: boolean }) {
  const href = (format: "pdf" | "docx") => (demo ? undefined : `/api/resume/${resumeId}/export?format=${format}`);
  return (
    <section aria-labelledby="resume-download" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 id="resume-download" className="text-base font-semibold">
          Download your resume
        </h2>
        <p className="text-sm text-muted">
          One-column layout with standard headings, made from what you confirmed, so screening software can read it. We don&apos;t keep your
          phone or email, so add them in the Word file{named ? "" : ", with your name"}.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["pdf", "PDF"],
            ["docx", "Word"],
          ] as const
        ).map(([format, label]) => (
          <a
            key={format}
            href={href(format)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <Download size={16} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </a>
        ))}
      </div>
    </section>
  );
}
