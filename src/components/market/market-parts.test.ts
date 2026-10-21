import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExampleDataBadge } from "./market-parts";

// The Example data badge (T120): the Market's header on example figures, and /design over the live sections, whose
// counts are synthetic.
describe("the Example data badge", () => {
  it("reads Example data in capitals, in the neutral chip style, never cobalt or a gap colour", () => {
    const html = renderToStaticMarkup(createElement(ExampleDataBadge));
    expect(html).toContain("Example data");
    expect(html).toContain("uppercase");
    expect(html).toContain("bg-surface-2");
    expect(html).not.toMatch(/accent|bg-good|bg-warn|bg-bad/);
    expect(html).toContain('aria-hidden="true"');
  });

  it("sits over the live Market sections on /design", () => {
    const page = readFileSync(join(__dirname, "../../app/design/page.tsx"), "utf8");
    const live = page.slice(page.indexOf("Market on live counts (signed in)"), page.indexOf('ids="design-market-live"'));
    expect(live).toContain("<ExampleDataBadge />");
  });
});
