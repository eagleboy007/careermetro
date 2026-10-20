import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exampleApplyPacket } from "@/components/corporate/fixtures";
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

  it("shows Open to work in next to Can join, with where to change it, and leaves it out when empty (FR-55)", () => {
    const render = (openToWorkIn: string[]) =>
      renderToStaticMarkup(
        createElement(ApplyPreview, {
          jobId: "00000000-0000-4000-8000-000000000001",
          company: "Example Labs",
          title: "SOC Analyst L1",
          sent: false,
          example: { ...exampleApplyPacket, openToWorkIn },
          form: { canJoin: "30", note: "", consent: false, setCanJoin: () => {}, setNote: () => {}, setConsent: () => {} },
          onClose: () => {},
        }),
      );
    const html = render(["Remote", "Pune"]);
    expect(html).toContain("Open to work in:</span> Remote, Pune.");
    expect(html).toContain('href="/settings#acc-pay"');
    expect(html).toContain("Change in Settings");
    expect(render([])).not.toContain("Open to work in");
  });
});
