"use client";

import { Check, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readApiReply } from "@/lib/api-reply";
import { currentParseStep, parseSteps } from "@/lib/resume/parse-steps";
import { TARGET_ROLE_CHIPS, saveTargetRole } from "@/lib/target-role";

type Mode = "file" | "text";
type State = { kind: "idle" } | { kind: "reading" } | { kind: "error"; message: string };

const MAX_MB = 4;
const field = "rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-ink";
const CHIP =
  "inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[0.84rem] font-[550] text-ink hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg";
/** "More roles": no chip role; the role step after the parse shows them all. */
const MORE = "more";

/** Upload a resume or paste it (FR-4). Consent is required before anything is sent (SEC-1). `demo` never uploads, for /design. */
/** `builder` shows "No resume yet? Build one" (FR-36), only where the signed-in screens exist. `rolePick` shows the */
/** target role chips (Today, No resume): the picked role is carried to the role step in this tab (src/lib/target-role.ts). */
export function UploadForm({ demo = false, builder = false, rolePick = false }: { demo?: boolean; builder?: boolean; rolePick?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [role, setRole] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const reading = state.kind === "reading";

  // The steps move on a timer while the one request runs (src/lib/resume/parse-steps.ts).
  useEffect(() => {
    if (!reading) return;
    const start = Date.now();
    const timer = setInterval(() => setStep(currentParseStep(Date.now() - start)), 500);
    return () => clearInterval(timer);
  }, [reading]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "reading") return;
    const form = new FormData(event.currentTarget);
    if (form.get("consent") !== "yes") {
      setState({ kind: "error", message: "Please tick the box to agree to how we use your resume." });
      return;
    }
    const file = form.get("file");
    if (mode === "file" && file instanceof File && file.size > MAX_MB * 1024 * 1024) {
      setState({ kind: "error", message: `This file is larger than ${MAX_MB} MB. Please upload a smaller file.` });
      return;
    }
    if (mode === "file") form.delete("text");
    else form.delete("file");

    setStep(0);
    setState({ kind: "reading" });
    if (demo) return;
    if (rolePick) saveTargetRole(role === MORE ? null : role);
    try {
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const data = await readApiReply(res);
      if (data.ok && typeof data.resumeId === "string") {
        router.push(`/resume/${data.resumeId}`);
        return;
      }
      setState({ kind: "error", message: data.error ?? "Something went wrong. Please try again." });
    } catch {
      setState({ kind: "error", message: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  const roleTitle = TARGET_ROLE_CHIPS.find((c) => c.slug === role)?.title ?? null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {rolePick && (
        <div className={reading ? "hidden" : "flex flex-col gap-2"}>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Target role</span>
          <div role="group" aria-label="Target role" className="flex flex-wrap gap-2">
            {[...TARGET_ROLE_CHIPS, { slug: MORE, title: "More roles" }].map((c) => (
              <button key={c.slug} type="button" aria-pressed={role === c.slug} onClick={() => setRole(c.slug)} className={CHIP}>
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Hidden, not removed, while reading: a failed reading leaves the chosen file in place for another try. */}
      <div className={reading ? "hidden" : "flex flex-col gap-5"}>
        <div role="group" aria-label="How to add your resume" className="flex gap-2">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                mode === m ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"
              }`}
            >
              {m === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "file" ? (
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-bg px-4 py-8 text-center hover:border-ink"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files[0];
              if (dropped && fileInput.current) {
                const list = new DataTransfer();
                list.items.add(dropped);
                fileInput.current.files = list.files;
                setFileName(dropped.name);
              }
            }}
          >
            {fileName ? (
              <FileText size={28} strokeWidth={1.75} className="text-ink" aria-hidden="true" />
            ) : (
              <Upload size={28} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
            )}
            <span className="font-display text-[1.2rem] font-semibold tracking-[-0.02em]">{fileName ?? "Drop your resume here"}</span>
            <span className="max-w-[42ch] text-[0.82rem] text-muted">
              {fileName ? "Click to choose a different file" : `PDF or DOCX, up to ${MAX_MB} MB. Read once to find your skills; never shown to anyone.`}
            </span>
            {!fileName && (
              <span aria-hidden="true" className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent">
                <FileText size={16} strokeWidth={1.75} />
                Choose file
              </span>
            )}
            <input
              ref={fileInput}
              name="file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Your resume
            <textarea name="text" rows={12} placeholder="Paste the full text of your resume" className={`${field} font-normal`} />
          </label>
        )}
      </div>

      {reading && (
        <div role="status" className="flex flex-col gap-3">
          <ol className="flex flex-col gap-2.5">
            {parseSteps(roleTitle).map((label, i) => (
              <li key={label} className={`flex items-center gap-3 text-[0.95rem] ${i <= step ? "text-ink" : "text-muted"}`}>
                {i < step ? (
                  <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                    <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`size-[22px] shrink-0 rounded-full border-2 ${i === step ? "border-accent border-r-transparent motion-safe:animate-spin" : "border-line"}`}
                  />
                )}
                {label}
                {i < step && <span className="sr-only">, done</span>}
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">This usually takes 10 to 30 seconds.</p>
        </div>
      )}

      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input name="consent" value="yes" type="checkbox" required className="mt-1 accent-[var(--ink)]" />
        <span>
          I agree that CareerMetro reads my resume to show my skill gaps. Phone, email and address are removed first. The rest
          is sent to Anthropic, our AI provider, and is never used to train models. Without an account, everything is deleted
          after 24 hours.
        </span>
      </label>

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-bad">
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={reading}>
          {reading ? "Reading your resume…" : "Read my resume"}
        </Button>
      </div>
      {builder && !demo && (
        <p className="text-sm text-muted">
          No resume yet?{" "}
          <Link href="/builder" className="font-medium text-ink underline underline-offset-2">
            Build one in about 10 minutes
          </Link>
        </p>
      )}
    </form>
  );
}
