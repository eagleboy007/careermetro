import { describe, expect, it, vi } from "vitest";
import { certifications } from "@/content";
import { CREDLY_BADGE_PAGE } from "@/lib/schemas";
import {
  CREDLY_MAX_BYTES,
  CREDLY_TIMEOUT_MS,
  allowedCredlyFetch,
  checkCredlyBadge,
  compareBadge,
  credlyBadgeId,
  credlyBadgePage,
  fetchCredlyBadge,
} from "./credly";
import { credlyFixtureFetcher, credlyFixtures } from "./credly-fixtures";

const env = { NAME_HASH_KEY: "test-key" };
const cert = (id: string) => certifications.find((c) => c.id === id)!;
const aws = cert("aws-cloud-practitioner");
const TODAY = "2026-10-13";
const id = (n: string) => `c4ed1100-0000-4000-8000-0000000000${n}`;
const ctx = { cert: aws, accountName: "Priya Sharma", today: TODAY, env };

describe("credlyBadgeId", () => {
  it("reads the badge id from a Credly badge link that rules.ts accepts", () => {
    expect(credlyBadgeId(`https://www.credly.com/badges/${id("01")}`)).toBe(id("01"));
    expect(credlyBadgeId(`https://credly.com/badges/${id("01").toUpperCase()}/public_url`)).toBe(id("01"));
    expect(credlyBadgeId(`https://www.youracclaim.com/badges/${id("01")}/linked_in_profile`)).toBe(id("01"));
    expect(credlyBadgeId(`https://www.credly.com/badges/${id("01")}?source=linked_in`)).toBe(id("01"));
  });

  it("refuses anything else: other hosts, other paths, plain http, ports, user info and ids that aren't UUIDs", () => {
    for (const url of [
      "https://www.credly.com/badges/walk-test",
      `http://www.credly.com/badges/${id("01")}`,
      `https://www.credly.com:8443/badges/${id("01")}`,
      `https://me@www.credly.com/badges/${id("01")}`,
      `https://www.credly.com/users/priya/badges/${id("01")}`,
      `https://credly.com.example.com/badges/${id("01")}`,
      `https://api.credly.com/badges/${id("01")}`,
      `https://learn.microsoft.com/api/credentials/share/en-us/x/${id("01")}`,
      "not a link",
    ])
      expect(credlyBadgeId(url), url).toBeNull();
  });

  it("rebuilds the public badge page from the id, never the link the person typed", () => {
    expect(credlyBadgePage(id("01"))).toBe(`https://www.credly.com/badges/${id("01")}`);
    expect(CREDLY_BADGE_PAGE.test(credlyBadgePage(id("01")))).toBe(true);
  });
});

describe("the Credly fetch", () => {
  it("allows only https on Credly's own hosts", () => {
    expect(allowedCredlyFetch("https://www.credly.com/badges/x.json")).toBe(true);
    expect(allowedCredlyFetch("https://credly.com/badges/x.json")).toBe(true);
    expect(allowedCredlyFetch("https://api.credly.com/v1/x")).toBe(true);
    for (const url of ["http://www.credly.com/x", "https://www.credly.com.evil.test/x", "https://evil.test/x", "https://www.credly.com:444/x", "https://a:b@www.credly.com/x", "ftp://credly.com/x", "nonsense"])
      expect(allowedCredlyFetch(url), url).toBe(false);
  });

  it("keeps to the limits: 5 seconds or less and a size cap", () => {
    expect(CREDLY_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(CREDLY_MAX_BYTES).toBeLessThanOrEqual(512 * 1024);
  });

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("asks for the badge's public JSON with no cookies, no credentials, no cache and no automatic redirects", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { id: id("01") } }));
    expect(await fetchCredlyBadge(id("01"), { fetchImpl })).toEqual({ kind: "ok", body: { data: { id: id("01") } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://www.credly.com/badges/${id("01")}.json`);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
  });

  it("never calls out for an id that isn't a badge id", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchCredlyBadge("../../users/x", { fetchImpl })).toEqual({ kind: "not_found" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("tells a missing badge, a private one and a failing Credly apart", async () => {
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({}, 404) })).toEqual({ kind: "not_found" });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({}, 410) })).toEqual({ kind: "not_found" });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({}, 403) })).toEqual({ kind: "private" });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({}, 500) })).toEqual({ kind: "unreachable" });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => new Response("<html>", { status: 200 }) })).toEqual({ kind: "unreachable" });
    expect(
      await fetchCredlyBadge(id("01"), {
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).toEqual({ kind: "unreachable" });
  });

  it("follows a redirect only to Credly's own hosts over https, at most twice", async () => {
    const to = (location: string) => new Response(null, { status: 301, headers: { location } });
    // To the API host: followed.
    let calls: string[] = [];
    const viaApi = async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? to("https://api.credly.com/v1/badges/x.json") : json({ ok: 1 });
    };
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: viaApi as typeof fetch })).toEqual({ kind: "ok", body: { ok: 1 } });
    expect(calls).toEqual([`https://www.credly.com/badges/${id("01")}.json`, "https://api.credly.com/v1/badges/x.json"]);

    // Anywhere else, or plain http: stopped before the second request.
    for (const location of ["https://evil.test/x.json", "http://www.credly.com/x.json", "//evil.test/x", "https://www.credly.com.evil.test/x"]) {
      calls = [];
      const away = async (url: string) => {
        calls.push(url);
        return calls.length === 1 ? to(location) : json({ stolen: true });
      };
      expect(await fetchCredlyBadge(id("01"), { fetchImpl: away as typeof fetch }), location).toEqual({ kind: "unreachable" });
      expect(calls, location).toHaveLength(1);
    }

    // A relative redirect stays on the same host.
    calls = [];
    const relative = async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? to("/badges/other.json") : json({ ok: 2 });
    };
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: relative as typeof fetch })).toEqual({ kind: "ok", body: { ok: 2 } });
    expect(calls[1]).toBe("https://www.credly.com/badges/other.json");

    // A loop gives up.
    calls = [];
    const loop = async (url: string) => {
      calls.push(url);
      return to("https://www.credly.com/again.json");
    };
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: loop as typeof fetch })).toEqual({ kind: "unreachable" });
    expect(calls).toHaveLength(3);
  });

  it("stops reading a reply over the size cap, whatever its headers say", async () => {
    const big = "x".repeat(2000);
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({ big }, 200), maxBytes: 1000 })).toEqual({ kind: "unreachable" });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => json({ a: 1 }, 200, { "content-length": "999999" }), maxBytes: 1000 })).toEqual({
      kind: "unreachable",
    });
    // A stream that never ends is cut off at the cap.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(512).fill(32));
      },
    });
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: async () => new Response(endless, { status: 200 }), maxBytes: 4096 })).toEqual({ kind: "unreachable" });
    expect(pulled).toBeLessThan(20);
  });

  it("gives up after the timeout", async () => {
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));
    const started = Date.now();
    expect(await fetchCredlyBadge(id("01"), { fetchImpl: hang as typeof fetch, timeoutMs: 50 })).toEqual({ kind: "unreachable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("compareBadge", () => {
  const badge = (n: string) => {
    const f = credlyFixtures[id(n)];
    if (!f || f.status !== 200) throw new Error(`no fixture ${n}`);
    return f.body;
  };

  it("matches a badge for the same certificate, from the same issuer, in the person's name", () => {
    expect(compareBadge(badge("01"), ctx)).toBeNull();
    // Names in any order, and Microsoft's badge name without the exam code.
    expect(compareBadge(badge("09"), { ...ctx, cert: cert("azure-fundamentals") })).toBeNull();
    // The Linux Foundation for "CNCF / Linux Foundation", and a badge name that holds ours.
    expect(compareBadge(badge("0a"), { ...ctx, cert: cert("cka") })).toBeNull();
    // (ISC)² for ISC2.
    expect(compareBadge(badge("0b"), { ...ctx, cert: cert("isc2-cc") })).toBeNull();
  });

  it("names what doesn't match", () => {
    expect(compareBadge(badge("03"), { ...ctx, accountName: "Asha Rao" })).toBe("badge_name");
    expect(compareBadge(badge("04"), ctx)).toBe("not_public");
    expect(compareBadge(badge("05"), ctx)).toBe("issuer");
    expect(compareBadge(badge("06"), ctx)).toBe("expired");
    expect(compareBadge(badge("07"), ctx)).toBe("earner_name");
    expect(compareBadge(badge("08"), ctx)).toBe("not_public");
    expect(compareBadge(badge("01"), { ...ctx, accountName: null })).toBe("no_name");
    // The right badge for a different certificate on our list.
    expect(compareBadge(badge("01"), { ...ctx, cert: cert("aws-developer-associate") })).toBe("badge_name");
    // A one-word account name doesn't match a two-word earner.
    expect(compareBadge(badge("01"), { ...ctx, accountName: "Sharma" })).toBe("earner_name");
  });

  it("says expired only for a badge that is otherwise the person's own, so another name is never just expired", () => {
    // Fixture 06 is Priya's and expired: for someone else it is a name mismatch first.
    expect(compareBadge(badge("06"), { ...ctx, accountName: "Amit Verma" })).toBe("earner_name");
    expect(compareBadge(badge("06"), { ...ctx, cert: cert("aws-developer-associate") })).toBe("badge_name");
  });

  it("doesn't take a short alias or a word inside another word as a match", () => {
    const b = badge("01");
    const named = (name: string) => ({ ...b, data: { ...b.data, badge_template: { ...b.data.badge_template, name } } });
    expect(compareBadge(named("AWS Certified Cloud Practitioner – Foundational"), ctx)).toBeNull();
    expect(compareBadge(named("AWS Certified Cloud Practitioner (CLF-C02)"), ctx)).toBeNull();
    // A training badge that only mentions the certificate isn't the certificate.
    expect(compareBadge(named("AWS Certified Cloud Practitioner Essentials Learning Plan"), ctx)).toBe("badge_name");
    expect(compareBadge(named("AWS Cloud"), ctx)).toBe("badge_name");
    expect(compareBadge(named("CLF-C02 study group"), ctx)).toBe("badge_name");
    expect(compareBadge(named("clf-c02"), ctx)).toBeNull();
    const issuer = (name: string) => ({ ...b, data: { ...b.data, issuer: { entities: [{ entity: { name } }] }, badge_template: { name: b.data.badge_template.name } } });
    expect(compareBadge(issuer("Not Amazon Web Services Fans"), ctx)).toBeNull(); // whole words: still names the issuer
    expect(compareBadge(issuer("AmazonWebServicesFans"), ctx)).toBe("issuer");
  });
});

describe("checkCredlyBadge", () => {
  const check = (n: string, over: Partial<typeof ctx> = {}) => checkCredlyBadge(id(n), { ...ctx, ...over, fetcher: credlyFixtureFetcher });

  it("verifies a matching badge, and gives a reason for everything else", async () => {
    expect(await check("01")).toBeNull();
    expect(await check("02")).toBe("earner_name");
    expect(await check("02", { accountName: "Asha Rao" })).toBeNull();
    expect(await check("ff")).toBe("not_found");
    expect(await check("f0")).toBe("unreachable");
    // A reply in a shape we don't know can't be read, so it counts as not reached, never as verified.
    expect(await check("f1")).toBe("unreachable");
  });

  it("refuses a reply about a different badge", async () => {
    const other = async () => ({ kind: "ok" as const, body: credlyFixtures[id("02")].body });
    expect(await checkCredlyBadge(id("01"), { ...ctx, fetcher: other })).toBe("not_found");
  });
});
