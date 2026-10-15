import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplyPreview } from "./apply-panel";

// T51: the preview is a snapshot, but the company's drawer reads the profile and proof live, so the preview says so.
describe("the Express apply preview", () => {
  it("tells the person the company sees their latest profile and proof", () => {
    const html = renderToStaticMarkup(
      createElement(ApplyPreview, {
        jobId: "00000000-0000-4000-8000-000000000001",
        company: "Example Labs",
        title: "SOC Analyst L1",
        sent: false,
        form: { canJoin: "30", note: "", consent: false, setCanJoin: () => {}, setNote: () => {}, setConsent: () => {} },
        onClose: () => {},
      }),
    );
    expect(html).toContain("If you update your profile or add proof later, the company sees the latest.");
  });
});
