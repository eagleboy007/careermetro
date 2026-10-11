import { describe, expect, it } from "vitest";
import { exampleThreads } from "./fixtures";
import { filterThreads, initialsOf, lastMessage, unreadCount } from "./types";

describe("inbox helpers", () => {
  it("filters by kind and keeps the order", () => {
    expect(filterThreads(exampleThreads, "all").map((t) => t.id)).toEqual(["konark", "sameer", "arjun", "sahyadri"]);
    expect(filterThreads(exampleThreads, "application").map((t) => t.id)).toEqual(["konark", "sahyadri"]);
    expect(filterThreads(exampleThreads, "request").map((t) => t.id)).toEqual(["sameer"]);
    expect(filterThreads(exampleThreads, "person").map((t) => t.id)).toEqual(["arjun"]);
  });

  it("counts unread chats, with a pending request counting as one", () => {
    expect(unreadCount(exampleThreads)).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("previews the last message a person wrote, never a system line", () => {
    const thread = { ...exampleThreads[0]!, messages: [{ by: "them" as const, text: "Hello" }, { by: "system" as const, text: "You accepted." }] };
    expect(lastMessage(thread)?.text).toBe("Hello");
  });

  it("makes initials from the first two words", () => {
    expect(initialsOf("Konark Payments")).toBe("KP");
    expect(initialsOf("Arjun  Mehta Rao")).toBe("AM");
  });

  it("never shows a phone number or email in the example chats", () => {
    const text = JSON.stringify(exampleThreads);
    expect(text).not.toMatch(/@|\+91|\b\d{10}\b/);
  });
});
