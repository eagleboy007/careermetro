import { Columns2, Download, Heading, Image as ImageIcon, PanelTop, SquareDashed, Table2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import { headingWords, LAYOUT_WORDS, screeningSummary, UNCHECKED_WORDS } from "@/lib/resume/screening";
import type { LayoutKind, ScreeningView } from "@/lib/schemas";
import { ConfirmKeyword } from "./confirm-keyword";

const LAYOUT_ICONS: Record<LayoutKind, LucideIcon> = {
  columns: Columns2,
  tables: Table2,
  images: ImageIcon,
  text_boxes: SquareDashed,
  header_footer: PanelTop,
};

/** The heading id, so other parts of the page can link to the check. */
export const SCREENING_ID = "screening-check";

const listWords = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="font-sans text-base font-semibold tracking-normal">{title}</h3>
      {children}
    </section>
  );
}

/**
 * FR-34, the screening-readiness check: keywords the target asks for that the resume doesn't name, layout that
 * screening software reads badly, and non-standard section headings, with the FR-20 download as the fix. Only the
 * keywords carry gap-status colour (they are gaps); layout and headings are neutral. Readiness is words, never a score.
 * `demo` saves nothing (for /design).
 */
export function ScreeningCheck({ view, resumeId, demo = false }: { view: ScreeningView; resumeId: string; demo?: boolean }) {
  const summary = screeningSummary(view);
  const target = view.against === "role" ? "this role" : "this job";
  const exportHref = (format: "pdf" | "docx") => (demo ? undefined : `/api/resume/${resumeId}/export?format=${format}`);
  const neverChecked = view.layout.state === "unknown" && view.headings.state === "unknown";
  return (
    <section aria-labelledby={SCREENING_ID} className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">Screening check</p>
        <h2 id={SCREENING_ID} className="text-xl font-semibold leading-tight">
          {summary.headline}
        </h2>
        <p className="text-sm text-muted">Many job portals use screening software that reads your resume before a person does. This is what it may miss.</p>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {summary.parts.map((p) => (
          <div key={p.label} className="contents">
            <dt className="font-mono text-xs uppercase tracking-wider text-muted sm:pt-0.5">{p.label}</dt>
            <dd className="mb-1 min-w-0 break-words sm:mb-0">{p.text}</dd>
          </div>
        ))}
      </dl>

      {view.keywords.missing.length > 0 && (
        <Part title={`Keywords ${target} asks for that your resume doesn't name`}>
          <p className="text-sm text-muted">
            Software looks for these words. Have one? Confirm it and we add its name to your skills list, nothing else. Don&apos;t have it? It stays a gap
            {view.against === "role" ? " above, and your path helps you learn it." : " for this job."}
          </p>
          <ul className="flex flex-col gap-3">
            {view.keywords.missing.map((k) => (
              <li key={k.skillId} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                <span className="flex min-w-0 flex-wrap items-center gap-2 sm:min-h-11">
                  <span className="min-w-0 break-words font-medium">{k.options.length > 1 ? `One of: ${listWords(k.options.map((o) => o.skillName))}` : k.skillName}</span>
                  <StatusChip status="missing" label="Not on your resume" />
                </span>
                <ConfirmKeyword resumeId={resumeId} keyword={k} demo={demo} />
              </li>
            ))}
          </ul>
        </Part>
      )}

      {neverChecked ? (
        <Part title="Layout and headings">
          <p className="text-sm">
            This resume was uploaded before we checked layout, so we can&apos;t tell you about it and won&apos;t guess.{" "}
            <Link href="/start" className="font-medium underline underline-offset-2">
              Upload again to check layout
            </Link>
          </p>
        </Part>
      ) : (
        <>
          <Part title="Layout">
            {view.layout.state === "unknown" && (
              <p className="text-sm">
                We couldn&apos;t read the layout of this file, so we won&apos;t guess.{" "}
                <Link href="/start" className="font-medium underline underline-offset-2">
                  Upload again to check layout
                </Link>
              </p>
            )}
            {view.layout.state === "pasted" && <p className="text-sm text-muted">You pasted your resume as text, so there is no layout to check.</p>}
            {view.layout.state === "checked" && (
              <>
                {view.layout.issues.length === 0 ? (
                  <p className="text-sm">We found nothing in your {view.layout.fileType === "pdf" ? "PDF" : "Word file"} that screening software reads badly.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {view.layout.issues.map((issue) => {
                      const Icon = LAYOUT_ICONS[issue.kind];
                      return (
                        <li key={issue.kind} className="flex gap-3 text-sm">
                          <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium">{LAYOUT_WORDS[issue.kind].title(issue.count)}</span>
                            <span className="text-muted">{LAYOUT_WORDS[issue.kind].why}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {view.layout.unchecked.length > 0 && (
                  <p className="text-xs text-muted">
                    A {view.layout.fileType === "pdf" ? "PDF" : "file like this"} doesn&apos;t tell us about {listWords(view.layout.unchecked.map((k) => UNCHECKED_WORDS[k]))}, so
                    those aren&apos;t checked.
                  </p>
                )}
              </>
            )}
          </Part>
          <Part title="Section headings">
            {view.headings.state === "unknown" ? (
              <p className="text-sm">
                Not checked for this upload.{" "}
                <Link href="/start" className="font-medium underline underline-offset-2">
                  Upload again to check layout
                </Link>
              </p>
            ) : view.headings.issues.length === 0 ? (
              <p className="text-sm">Your headings use names screening software knows, like Experience, Education and Skills.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {view.headings.issues.map((h) => (
                  <li key={h.section} className="flex gap-3 text-sm">
                    <Heading size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0">{headingWords(h.section, h.problem)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Part>
        </>
      )}

      <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <p className="text-sm font-semibold">The fix: download your resume from CareerMetro</p>
        <p className="text-sm text-muted">
          It uses one column and standard headings, with no tables, pictures, text boxes or headers, and holds only what you confirmed, including any skill
          you add here. Or fix your own file and upload it again.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pdf", "Download PDF"],
              ["docx", "Download Word"],
            ] as const
          ).map(([format, label]) => (
            <a
              key={format}
              href={exportHref(format)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
            >
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
