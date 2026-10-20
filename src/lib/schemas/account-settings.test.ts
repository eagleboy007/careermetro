import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_SEARCH,
  DEFAULT_SETTINGS,
  jobSearchInput,
  jobSearchView,
  noticeDays,
  noticeInput,
  openToWorkIn,
  settingsErrors,
  settingsInput,
  userSettings,
  usuallyFreeInput,
} from "./account-settings";
import { FREE_DAYS, NOTICE_DAYS, SLOT_TIMES, USUALLY_FREE_MAX } from "./constants";

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
    expect(DEFAULT_SETTINGS.visibility).toBe("connections");
    expect(DEFAULT_SETTINGS.showTargetRole).toBe(false);
    expect(DEFAULT_SETTINGS.showGaps).toBe(false);
    expect(userSettings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("keep companies out until the person lets them find them (pending item 19)", () => {
    expect(DEFAULT_SETTINGS.companiesCanFind).toBe(false);
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, companiesCanFind: "on" }).success).toBe(false);
    const without: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete without.companiesCanFind;
    expect(userSettings.safeParse(without).success).toBe(false);
  });
  it("take Connection requests from as Anyone or Nobody, or leave it out (gap list item 32)", () => {
    expect(userSettings.parse({ ...DEFAULT_SETTINGS, requestsFrom: "nobody" }).requestsFrom).toBe("nobody");
    expect(userSettings.parse({ ...DEFAULT_SETTINGS, requestsFrom: "anyone" }).requestsFrom).toBe("anyone");
    expect(userSettings.parse(DEFAULT_SETTINGS).requestsFrom).toBeUndefined();
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, requestsFrom: "connections" }).success).toBe(false);
  });
  it("take an optional city from the list only (T44)", () => {
    expect(settingsInput.parse({ ...base, city: "Pune" }).city).toBe("Pune");
    expect(settingsInput.parse({ ...base, city: "" }).city).toBeNull();
    expect(settingsInput.parse(base).city).toBeUndefined();
    for (const city of ["Pune, Maharashtra", "pune", "Flat 4, MG Road", 42]) {
      const r = settingsInput.safeParse({ ...base, city });
      expect(r.success).toBe(false);
      if (!r.success) expect(settingsErrors(r.error)).toEqual({ city: "Pick a city from the list." });
    }
  });
});

describe("settings columns (FR-55, gap list items 31, 33 and 36)", () => {
  it("allow message requests by default, take on or off, and keep what is stored when an older page leaves it out", () => {
    expect(DEFAULT_SETTINGS.messageRequests).toBe(true);
    expect(userSettings.parse({ ...DEFAULT_SETTINGS, messageRequests: false }).messageRequests).toBe(false);
    const older: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete older.messageRequests;
    expect(userSettings.parse(older).messageRequests).toBeUndefined();
    expect(userSettings.safeParse({ ...DEFAULT_SETTINGS, messageRequests: "off" }).success).toBe(false);
  });

  it("take Open to work in as Remote and listed cities, each once, up to 6, Remote first", () => {
    expect(openToWorkIn.parse(["Remote"])).toEqual(["Remote"]);
    expect(openToWorkIn.parse(["Pune", "Remote", "Kochi"])).toEqual(["Remote", "Pune", "Kochi"]);
    expect(openToWorkIn.parse([])).toEqual([]);
    expect(openToWorkIn.safeParse(["Delhi NCR"]).success).toBe(false);
    expect(openToWorkIn.safeParse(["remote"]).success).toBe(false);
    expect(openToWorkIn.safeParse(["Pune", "Pune"]).success).toBe(false);
    expect(openToWorkIn.safeParse(["Remote", "Pune", "Kochi", "Mumbai", "Chennai", "Noida", "Indore"]).success).toBe(false);
    expect(openToWorkIn.safeParse(["Remote", "Pune", "Kochi", "Mumbai", "Chennai", "Noida"]).success).toBe(true);
  });

  it("save Open to work in with the form, keep it when an older page leaves it out, and say what went wrong", () => {
    expect(settingsInput.parse({ ...base, openToWorkIn: ["Pune", "Remote"] }).openToWorkIn).toEqual(["Remote", "Pune"]);
    expect(settingsInput.parse(base).openToWorkIn).toBeUndefined();
    const r = settingsInput.safeParse({ ...base, openToWorkIn: ["Pune", "Pune"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(settingsErrors(r.error)).toEqual({ openToWorkIn: "Pick up to 6 places from the list, each once." });
  });

  it("take Usually free as weekday picker hours, each once, Monday first", () => {
    expect(usuallyFreeInput.parse(["tue 10:00", "mon 18:00", "mon 17:00"])).toEqual(["mon 17:00", "mon 18:00", "tue 10:00"]);
    expect(usuallyFreeInput.parse([])).toEqual([]);
    for (const bad of [["sat 10:00"], ["mon 13:00"], ["mon 9:00"], ["Mon 10:00"], ["mon 10:00", "mon 10:00"], [42]]) expect(usuallyFreeInput.safeParse(bad).success).toBe(false);
    const every = FREE_DAYS.flatMap((d) => SLOT_TIMES.map((t) => `${d} ${t}`));
    expect(every).toHaveLength(USUALLY_FREE_MAX);
    expect(usuallyFreeInput.parse(every)).toHaveLength(40);
    expect(usuallyFreeInput.safeParse([...every, "mon 10:00"]).success).toBe(false);
  });
});

describe("job search and notice period schemas", () => {
  it("take the switch as on or off only", () => {
    expect(jobSearchInput.parse(false)).toBe(false);
    expect(jobSearchInput.safeParse("off").success).toBe(false);
  });

  it("take 15, 30, 60 or 90 days, and nothing else", () => {
    for (const d of NOTICE_DAYS) expect(noticeDays.parse(d)).toBe(d);
    for (const d of [0, 45, 91, "30", null]) expect(noticeDays.safeParse(d).success).toBe(false);
  });

  it("take a real resignation date with the days, or clear either", () => {
    expect(noticeInput.parse({ days: 60, resignedOn: "2026-10-01" })).toEqual({ days: 60, resignedOn: "2026-10-01" });
    expect(noticeInput.parse({ days: 30, resignedOn: null })).toEqual({ days: 30, resignedOn: null });
    expect(noticeInput.parse({ days: null, resignedOn: null })).toEqual({ days: null, resignedOn: null });
    for (const resignedOn of ["2026-02-30", "1 Oct 2026", "2026-10-1", "1999-12-31"]) expect(noticeInput.safeParse({ days: 60, resignedOn }).success).toBe(false);
  });

  it("refuse a resignation date without the days, and anything extra", () => {
    const r = noticeInput.safeParse({ days: null, resignedOn: "2026-10-01" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Pick your notice period first.");
    expect(noticeInput.safeParse({ days: 60, resignedOn: null, lastDay: "2026-11-30" }).success).toBe(false);
  });

  it("start everyone with job search on and no notice period", () => {
    expect(jobSearchView.parse(DEFAULT_JOB_SEARCH)).toEqual({ on: true, noticeDays: null, resignedOn: null });
  });
});
