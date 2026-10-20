import { describe, expect, it, vi } from "vitest";
import { answeredText, lengthNote, mayFollowUp, SETUP_NOTE, shortAnswer, unsaved, unsavedFollowUps } from "./mock-interview";
import { finalText, listen, localLanguage, onDeviceRecognition, withSpoken, type RecognitionCtor, type SpeechEvent } from "./speech";

// The mock interview screen's words and the on-device speech helper (FR-50 part 3). No score anywhere.
describe("mock interview screen", () => {
  it("words the lengths and how much was answered, never as a score", () => {
    expect(lengthNote("quick")).toBe("10 min · 4 questions");
    expect(lengthNote("full")).toBe("20 min · 8 questions");
    expect(answeredText(2, 4)).toBe("2 of 4 answered");
  });

  it("cuts a long answer for the feedback screen", () => {
    expect(shortAnswer("short")).toBe("short");
    expect(shortAnswer("a".repeat(300))).toBe(`${"a".repeat(220)}…`);
  });

  it("sends with End only the answers the server doesn't have yet, trimmed; a cleared one goes as empty", () => {
    expect(unsaved(["  one ", "two", "", "four"], ["one", "", "", "old"])).toEqual([
      { position: 2, answer: "two" },
      { position: 4, answer: "four" },
    ]);
    expect(unsaved(["", "x"], ["was", "x"])).toEqual([{ position: 1, answer: "" }]);
    expect(unsaved([], [])).toEqual([]);
  });

  it("waits for the server on Next only for a changed answer of 20 words or more, which may get a follow-up", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(mayFollowUp(twenty, "")).toBe(true);
    expect(mayFollowUp(twenty, twenty)).toBe(false);
    expect(mayFollowUp("Too short to follow up.", "")).toBe(false);
  });

  it("sends with End the follow-up replies not saved yet and the open draft, never an empty draft", () => {
    const pending = new Map([[1, "First reply"]]);
    expect(unsavedFollowUps(pending, { position: 3 }, "  Open draft  ")).toEqual([
      { position: 1, answer: "First reply" },
      { position: 3, answer: "Open draft" },
    ]);
    expect(unsavedFollowUps(pending, { position: 3 }, "   ")).toEqual([{ position: 1, answer: "First reply" }]);
    expect(unsavedFollowUps(new Map([[2, "Old"]]), { position: 2 }, "New")).toEqual([{ position: 2, answer: "New" }]);
    expect(unsavedFollowUps(new Map(), null, "ignored")).toEqual([]);
  });

  it("says follow-ups are asked only for a role whose rounds ask them, and that the bank was checked only once it is", () => {
    expect(SETUP_NOTE.none).not.toMatch(/follow-up/);
    expect(SETUP_NOTE.draft).toMatch(/It asks follow-ups like a person would, and it can be wrong\./);
    expect(SETUP_NOTE.draft).not.toMatch(/checked/);
    expect(SETUP_NOTE.checked).toContain("Questions come from a bank checked by people who work in the role.");
    for (const note of Object.values(SETUP_NOTE)) expect(note).toContain("We keep the text of your answers 30 days.");
  });
});

describe("on-device speech", () => {
  function fakeRecognition(state: string, installs = true) {
    const made: { started: boolean; stopped: boolean; processLocally?: boolean; lang?: string; onresult?: (e: SpeechEvent) => void; onerror?: (e: { error: string }) => void; onend?: () => void }[] = [];
    class Rec {
      lang = "";
      continuous = false;
      interimResults = true;
      processLocally?: boolean;
      onresult: ((e: SpeechEvent) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        made.push(this as unknown as (typeof made)[number]);
      }
      start() {
        (this as unknown as { started: boolean }).started = true;
      }
      stop() {
        (this as unknown as { stopped: boolean }).stopped = true;
        this.onend?.();
      }
      static available = vi.fn(async ({ langs }: { langs: string[] }) => (langs[0] === "en-IN" ? state : "unavailable"));
      static install = vi.fn(async () => installs);
    }
    return { C: Rec as unknown as RecognitionCtor, made, Rec };
  }

  it("is offered only where the browser can recognise speech on the device", () => {
    expect(onDeviceRecognition(undefined)).toBeNull();
    expect(onDeviceRecognition({})).toBeNull();
    // A recogniser without the on-device check may send audio to a server: not offered.
    expect(onDeviceRecognition({ webkitSpeechRecognition: class {} })).toBeNull();
    const { C } = fakeRecognition("available");
    expect(onDeviceRecognition({ SpeechRecognition: C })).toBe(C);
  });

  it("uses English as spoken in India when the device has it, installing its pack when offered", async () => {
    expect(await localLanguage(fakeRecognition("available").C)).toBe("en-IN");
    const downloadable = fakeRecognition("downloadable");
    expect(await localLanguage(downloadable.C)).toBe("en-IN");
    expect(downloadable.Rec.install).toHaveBeenCalledWith({ langs: ["en-IN"], processLocally: true });
    expect(await localLanguage(fakeRecognition("downloadable", false).C)).toBeNull();
    expect(await localLanguage(fakeRecognition("unavailable").C)).toBeNull();
  });

  it("listens on the device only and passes on finished phrases", () => {
    const { C, made } = fakeRecognition("available");
    const heard: string[] = [];
    const ended: (string | null)[] = [];
    const stop = listen(C, "en-IN", (t) => heard.push(t), (e) => ended.push(e));
    const r = made[0];
    expect(r).toMatchObject({ started: true, processLocally: true, lang: "en-IN" });
    r.onresult!({ resultIndex: 0, results: { length: 2, 0: { isFinal: true, length: 1, 0: { transcript: " I would check " } }, 1: { isFinal: false, length: 1, 0: { transcript: "the" } } } });
    expect(heard).toEqual(["I would check"]);
    r.onerror!({ error: "network" });
    stop();
    expect(ended).toEqual(["network"]);
  });

  it("adds spoken words after the typed ones, within the limit", () => {
    expect(withSpoken("", "first", 10)).toBe("first");
    expect(withSpoken("typed  ", "spoken", 100)).toBe("typed spoken");
    expect(withSpoken("abc", "defghij", 6)).toBe("abc de");
    expect(withSpoken("abc", "", 6)).toBe("abc");
    expect(finalText({ resultIndex: 1, results: { length: 2, 0: { isFinal: true, length: 1, 0: { transcript: "old" } }, 1: { isFinal: true, length: 1, 0: { transcript: "new" } } } })).toBe("new");
  });
});
