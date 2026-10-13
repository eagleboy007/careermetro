import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsErrors, settingsInput, userSettings } from "./account-settings";

const base = { username: "Priya-N", headline: "  IT support  moving into SOC ", currentPay: "4.2", expectedPay: "", settings: DEFAULT_SETTINGS };

describe("account settings schemas", () => {
  it("clean what the person typed", () => {
    expect(settingsInput.parse(base)).toEqual({
      username: "priya-n",
      headline: "IT support moving into SOC",
      currentPay: 4.2,
      expectedPay: null,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("read a blank username as keep what I have, and a blank headline as none", () => {
    const out = settingsInput.parse({ ...base, username: "", headline: "   " });
    expect(out.username).toBeNull();
    expect(out.headline).toBeNull();
  });

  it("name the field that failed", () => {
    const r = settingsInput.safeParse({ ...base, username: "admin", headline: "mail me: a@b.in", currentPay: "4.255" });
    expect(r.success).toBe(false);
    const errors = settingsErrors(r.error!);
    expect(errors.username).toMatch(/reserved/);
    expect(errors.headline).toMatch(/email addresses and phone numbers/);
    expect(errors.currentPay).toMatch(/lakh a year/);
    expect(errors.expectedPay).toBeUndefined();
  });

  it("keep only the offered choices", () => {
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, visibility: "everyone" }).success).toBe(false);
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, rideReminder: "03:00" }).success).toBe(false);
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, showGaps: "yes" }).success).toBe(false);
    const r = settingsInput.safeParse({ ...base, settings: { ...DEFAULT_SETTINGS, visibility: "public" } });
    expect(settingsErrors(r.error!).settings).toMatch(/Reload the page/);
  });

  it("start hidden, with the target role and gaps off (decided 2026-10-13)", () => {
    expect(DEFAULT_SETTINGS.visibility).toBe("only_me");
    expect(DEFAULT_SETTINGS.showTargetRole).toBe(false);
    expect(DEFAULT_SETTINGS.showGaps).toBe(false);
    expect(userSettings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
