"use client";

import { useEffect, useState } from "react";

/** The section list beside the settings (a scrolling row on phones). It marks the section in view. */
export function SettingsNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [current, setCurrent] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-line px-3.5 py-2.5 min-[760px]:sticky min-[760px]:top-[61px] min-[760px]:flex-col min-[760px]:gap-0.5 min-[760px]:self-start min-[760px]:border-b-0 min-[760px]:border-r min-[760px]:py-7 min-[760px]:pl-5 min-[760px]:pr-3"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={current === s.id ? "true" : undefined}
          onClick={() => setCurrent(s.id)}
          className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[0.8rem] font-[550] no-underline min-[760px]:px-3 min-[760px]:py-2 min-[760px]:text-[0.86rem] ${
            current === s.id ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
