// The scale check's stand-in for Resend (docs/scale-check.md): preloaded into `next start` with
// NODE_OPTIONS="--import <this file>" in .github/workflows/scale.yml only, so the weekly email and the events digest
// crons run their whole send path at scale without sending anything. Every POST to Resend's API is answered here as
// Resend answers a send, after SCALE_RESEND_DELAY_MS (150 ms by default, about a real call from Mumbai). Any other
// request goes out as usual. Nothing about the message is read, kept or logged. Refuses to load in production.
if (process.env.VERCEL_ENV === "production" || process.env.VERCEL) throw new Error("the Resend stand-in is for the CI scale check only");

const delay = Number(process.env.SCALE_RESEND_DELAY_MS ?? 150);
const realFetch = globalThis.fetch;
let sent = 0;

globalThis.fetch = async function scaleFetch(input, init) {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (typeof target === "string" && target.startsWith("https://api.resend.com/")) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    sent += 1;
    return new Response(JSON.stringify({ id: `scale-stub-${sent}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch.call(this, input, init);
};
