"use client";

import { FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readApiReply } from "@/lib/api-reply";

type Mode = "file" | "text";
type State = { kind: "idle" } | { kind: "reading" } | { kind: "error"; message: string };

const MAX_MB = 4;
const field = "rounded-sm border border-line bg-surface px-3 py-2.5 text-ink";

/** Upload a resume or paste it (FR-4). Consent is required before anything is sent (SEC-1). `demo` never uploads, for /design. */
export function UploadForm({ demo = false }: { demo?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    setState({ kind: "reading" });
    if (demo) return;
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

  const reading = state.kind === "reading";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
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
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center hover:border-ink"
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
          <span className="font-medium">{fileName ?? "Choose a PDF or Word file"}</span>
          <span className="text-sm text-muted">{fileName ? "Click to choose a different file" : `Or drop it here. Up to ${MAX_MB} MB.`}</span>
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
        <Button type="submit" disabled={reading}>
          {reading ? "Reading your resume…" : "Read my resume"}
        </Button>
        {reading && (
          <span role="status" className="text-sm text-muted">
            This usually takes 10 to 30 seconds.
          </span>
        )}
      </div>
    </form>
  );
}
