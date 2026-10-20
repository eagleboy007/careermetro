import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOTIFICATIONS_EMPTY } from "@/lib/schemas/constants";
import { NotificationsBell } from "./notifications-bell";

// The bell in the top bar (docs/plans/notifications-plan.md): the layout passes the count, and the label and dot follow it.
describe("the notifications bell", () => {
  it("reads 'Notifications, 2 new' with the dot, as the prototype", () => {
    const html = renderToStaticMarkup(createElement(NotificationsBell, { count: 2 }));
    expect(html).toContain('aria-label="Notifications, 2 new"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("data-bell-dot");
    // The dot is ink, never cobalt: cobalt means progress only.
    expect(html).toMatch(/data-bell-dot=""[^>]*bg-ink/);
    expect(html).not.toMatch(/data-bell-dot=""[^>]*bg-accent/);
  });

  it("reads 'Notifications' with no dot when nothing is new", () => {
    const html = renderToStaticMarkup(createElement(NotificationsBell, { count: 0 }));
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain("data-bell-dot");
  });

  it("says so when there is nothing to show", () => {
    const html = renderToStaticMarkup(createElement(NotificationsBell, { count: 0, startItems: [] }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(NOTIFICATIONS_EMPTY);
  });
});
