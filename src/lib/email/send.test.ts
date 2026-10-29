import { afterEach, describe, expect, it, vi } from "vitest";
import { emailReady, sendEmail, weeklyFrom } from "./send";

const env = { RESEND_API_KEY: "re_test", EMAIL_FROM: "CareerMetro <codes@careermetro.com>" };
const message = { to: "meera.iyer@example-labs.test", subject: "Your CareerMetro work email code", text: "Your code is 123456." };

describe("the app's email sender", () => {
  const lines: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    // Nothing logged ever holds the address, the subject, the body or the key.
    for (const secret of ["meera.iyer", "123456", "work email code", "re_test"]) expect(lines.join("\n")).not.toContain(secret);
  });
  const quiet = () => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  };

  it("is ready only with a key and a sender address", () => {
    expect(emailReady(env)).toBe(true);
    expect(emailReady({ ...env, EMAIL_FROM: "codes@careermetro.com" })).toBe(true);
    expect(emailReady({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(emailReady({ EMAIL_FROM: env.EMAIL_FROM })).toBe(false);
    expect(emailReady({ ...env, EMAIL_FROM: "CareerMetro" })).toBe(false);
    expect(emailReady({ ...env, RESEND_API_KEY: "  " })).toBe(false);
  });

  it("sends HTML and headers with the plain text, from another sender when given", async () => {
    const fetch = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    const headers = { "List-Unsubscribe": "<https://careermetro.test/api/email/off?t=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    await sendEmail({ ...message, html: "<p>Hi</p>", headers, from: "CareerMetro <hello@careermetro.com>" }, env, { fetch });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ from: "CareerMetro <hello@careermetro.com>", to: [message.to], subject: message.subject, text: message.text, html: "<p>Hi</p>", headers });
  });

  it("sends the weekly email from hello@ on the code sender's own domain", () => {
    expect(weeklyFrom(env)).toBe("CareerMetro <hello@careermetro.com>");
    expect(weeklyFrom({ ...env, EMAIL_FROM: "codes@mail.careermetro.com" })).toBe("CareerMetro <hello@mail.careermetro.com>");
    expect(weeklyFrom({})).toBeNull();
  });

  it("sends nothing without the sender set up", async () => {
    const fetch = vi.fn();
    expect(await sendEmail(message, {}, { fetch })).toEqual({ ok: false, reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one plain-text email to Resend", async () => {
    const fetch = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    expect(await sendEmail(message, env, { fetch })).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text });
  });

  it("says it failed, without throwing or logging the message, when Resend refuses or the network fails", async () => {
    quiet();
    expect(await sendEmail(message, env, { fetch: vi.fn(async () => new Response("{}", { status: 422 })) })).toEqual({ ok: false, reason: "failed" });
    // Resend's rate or daily limit: a batch stops on it (T142).
    expect(await sendEmail(message, env, { fetch: vi.fn(async () => new Response("{}", { status: 429 })) })).toEqual({ ok: false, reason: "limited" });
    expect(await sendEmail(message, env, { fetch: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) })).toEqual({ ok: false, reason: "failed" });
    expect(lines.join("\n")).toContain("email_send_refused");
    expect(lines.join("\n")).toContain("email_send_failed");
  });
});
