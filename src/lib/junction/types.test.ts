import { describe, expect, it } from "vitest";
import { EDIT_WINDOW_MINUTES } from "@/lib/schemas/legal-timings";
import { agoWords, EDIT_WINDOW_MINUTES_SHOWN, editableAt } from "./types";

const NOW = "2026-10-31T12:00:00.000Z";
const day = (at: string) => `day ${at.slice(0, 10)}`;

describe("Junction screen helpers", () => {
  it("shows the same edit window the store enforces", () => {
    expect(EDIT_WINDOW_MINUTES_SHOWN).toBe(EDIT_WINDOW_MINUTES);
  });

  it("offers Edit for 30 minutes after posting, by the server's clock", () => {
    expect(editableAt("2026-10-31T11:31:00.000Z", NOW, EDIT_WINDOW_MINUTES_SHOWN)).toBe(true);
    expect(editableAt("2026-10-31T11:30:00.000Z", NOW, EDIT_WINDOW_MINUTES_SHOWN)).toBe(true);
    expect(editableAt("2026-10-31T11:29:59.000Z", NOW, EDIT_WINDOW_MINUTES_SHOWN)).toBe(false);
  });

  it("says how long ago in words, then the day", () => {
    expect(agoWords("2026-10-31T11:59:30.000Z", NOW, day)).toBe("just now");
    expect(agoWords("2026-10-31T11:48:00.000Z", NOW, day)).toBe("12 min ago");
    expect(agoWords("2026-10-31T09:00:00.000Z", NOW, day)).toBe("3 h ago");
    expect(agoWords("2026-10-29T09:00:00.000Z", NOW, day)).toBe("day 2026-10-29");
  });
});
