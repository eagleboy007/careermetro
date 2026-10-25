import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NEXT } from "./path-end";
import { CONTINUE_LABEL, PathOnward, todayText } from "./path-onward";

// The owner's flow fix (Milin, 2026-10-25): the Path page always offers a way on, so no one thinks every step comes first.
describe("the path's way on", () => {
  it("signed in, leads to Today and says the goals stay on the ride and the Map when Today shows this path", () => {
    const html = renderToStaticMarkup(createElement(PathOnward, { next: { kind: "today", ride: { is: "this-path" } } }));
    expect(html).toContain(CONTINUE_LABEL);
    expect(html).toContain('href="/today"');
    expect(html).toContain("Your goals for this role stay on Today and your Map");
    expect(html).not.toMatch(/courses|practice tasks/);
    expect(html).toContain("finish every step first");
  });

  it("never claims this path is on Today when Today follows another gap check", () => {
    const text = todayText({ is: "other-check", roleTitle: "Data Engineer" });
    expect(text).toContain("for Data Engineer, not this path");
    expect(text).not.toContain("stay on Today");
    const newer = todayText({ is: "other-resume" });
    expect(newer).toContain("the gap check on another of your resumes, not this one");
    expect(newer).not.toContain("stay on Today");
    expect(todayText({ is: "other-check", roleTitle: null })).toContain("latest gap check, not this path");
    expect(todayText({ is: "unknown" })).toBe("Today shows your goals and daily ride.");
  });

  it("signed out, keeps the sign-in and waitlist words of the path's end", () => {
    const signIn = renderToStaticMarkup(createElement(PathOnward, { next: { kind: "sign-in", href: "/sign-in?next=%2Fx" } }));
    expect(signIn).toContain(NEXT["sign-in"].label);
    expect(signIn).toContain('href="/sign-in?next=%2Fx"');
    expect(signIn).not.toContain(CONTINUE_LABEL);
    const waitlist = renderToStaticMarkup(createElement(PathOnward, { next: { kind: "waitlist" } }));
    expect(waitlist).toContain(NEXT.waitlist.label);
    expect(waitlist).toContain('href="/#waitlist"');
  });

  it("sits after the steps on the Path page, with the finished card only in its place", () => {
    const page = readFileSync(join(__dirname, "../../app/resume/[id]/path/[slug]/page.tsx"), "utf8");
    const steps = page.indexOf("<PathSteps");
    const onward = page.indexOf("<PathOnward");
    expect(steps).toBeGreaterThan(0);
    expect(onward).toBeGreaterThan(steps);
    expect(page).toContain("{finished ? <PathEnd next={pathNext(!!account, here)} /> : onward && <PathOnward next={onward} />}");
    // No way on for a path with no steps.
    expect(page).toContain("path.steps.length > 0 && !finished ? onwardNext(");
  });
});

// The Gaps page ends on its next step: Build my path comes after the screening and job checks, before the rating.
describe("the Gaps page's order", () => {
  it("puts Build my path after the screening and job checks and before the rating", () => {
    const page = readFileSync(join(__dirname, "../../app/resume/[id]/gaps/[slug]/page.tsx"), "utf8");
    const at = (marker: string) => {
      const i = page.indexOf(marker);
      expect(i, marker).toBeGreaterThan(0);
      return i;
    };
    const build = at("Build my path");
    expect(build).toBeGreaterThan(at("<ScreeningCheck"));
    expect(build).toBeGreaterThan(at("<JobCheck"));
    expect(build).toBeLessThan(at("<GapRating"));
    expect(build).toBeLessThan(at("Pick another role"));
  });
});
