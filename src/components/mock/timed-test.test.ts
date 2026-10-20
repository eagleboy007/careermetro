import { describe, expect, it } from "vitest";
import { clockText, pickedText, rightText } from "./timed-test";

describe("timed test wording (handoff 12l)", () => {
  it("shows the clock as minutes and seconds", () => {
    expect(clockText(900)).toBe("15:00");
    expect(clockText(545)).toBe("9:05");
    expect(clockText(0)).toBe("0:00");
  });

  it("gives the count right as the only number", () => {
    expect(rightText(9, 12)).toBe("9 of 12 right");
  });

  it("says what was picked and the right answer", () => {
    const options = ["WHERE", "HAVING", "LIMIT"];
    expect(pickedText(options, 1, 1)).toBe("You picked HAVING, the right answer.");
    expect(pickedText(options, 0, 1)).toBe("You picked WHERE. The answer is HAVING.");
    expect(pickedText(options, null, 1)).toBe("No answer. The answer is HAVING.");
  });
});
