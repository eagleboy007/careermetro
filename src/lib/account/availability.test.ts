import { describe, expect, it } from "vitest";
import { SLOT_TIMES, SLOTS_MAX } from "@/lib/schemas/constants";
import { freeDayOf, preTicks, sortFree, usuallyFreeSummary } from "./availability";

const week = (times: string[]) => ["mon", "tue", "wed", "thu", "fri"].flatMap((d) => times.map((t) => `${d} ${t}`));

describe("Usually free summary", () => {
  it("says Not set with nothing picked", () => {
    expect(usuallyFreeSummary([])).toBe("Not set");
  });

  it("runs back-to-back hours and days with the same hours together", () => {
    expect(usuallyFreeSummary(week(["17:00", "18:00"]))).toBe("Mon to Fri 17:00 to 19:00");
    expect(usuallyFreeSummary(["mon 17:00", "mon 18:00"])).toBe("Mon 17:00 to 19:00");
    expect(usuallyFreeSummary(["mon 10:00", "tue 10:00"])).toBe("Mon and Tue 10:00 to 11:00");
    // 13:00 isn't a picker time, so 12:00 and 14:00 don't run together.
    expect(usuallyFreeSummary(["wed 12:00", "wed 14:00", "wed 15:00"])).toBe("Wed 12:00 to 13:00, 14:00 to 16:00");
    expect(usuallyFreeSummary(["mon 17:00", "wed 17:00", "fri 10:00"])).toBe("Mon 17:00 to 18:00; Wed 17:00 to 18:00; Fri 10:00 to 11:00");
  });

  it("keeps Monday first, then by time", () => {
    expect(sortFree(["fri 10:00", "mon 18:00", "mon 10:00"])).toEqual(["mon 10:00", "mon 18:00", "fri 10:00"]);
  });
});

describe("Usually free pre-ticks", () => {
  // Mon 19 to Fri 23 Oct 2026, as "Ask for times" sends them.
  const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((day) => ({ day }));
  const ask = { days, times: [...SLOT_TIMES], unavailable: [] as string[] };

  it("reads the weekday of an India date", () => {
    expect(days.map((d) => freeDayOf(d.day))).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(freeDayOf("2026-10-24")).toBeNull();
  });

  it("ticks nothing when Usually free isn't set", () => {
    expect(preTicks(ask, [])).toEqual([]);
  });

  it("ticks only open times that fall in Usually free, earliest first", () => {
    expect(preTicks(ask, ["mon 17:00", "wed 10:00"])).toEqual(["2026-10-19T17:00", "2026-10-21T10:00"]);
    // Too soon to offer: left unticked.
    expect(preTicks({ ...ask, unavailable: ["2026-10-19T17:00"] }, ["mon 17:00", "wed 10:00"])).toEqual(["2026-10-21T10:00"]);
  });

  it("ticks at most 12", () => {
    const ticked = preTicks(ask, week(["10:00", "11:00", "12:00"]));
    expect(ticked).toHaveLength(SLOTS_MAX);
    expect(ticked[0]).toBe("2026-10-19T10:00");
    expect(ticked).toEqual([...ticked].sort());
  });
});
