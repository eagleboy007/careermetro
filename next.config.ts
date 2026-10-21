import type { NextConfig } from "next";
import { ENFORCED_CSP, REPORTING_ENDPOINTS } from "./src/lib/csp";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Prompts are read from disk at runtime (src/lib/ai/prompts.ts), so ship them with every server function. The resume
  // download embeds the Geist fonts (src/lib/resume/export/pdf.ts).
  outputFileTracingIncludes: { "/**": ["./prompts/**/*.md"], "/api/resume/[id]/export": ["./assets/fonts/*.ttf"] },
  partialPrefetching: true,
  // Hardening for every page and API route (T25). No other site may frame CareerMetro. The camera is off until the
  // on-camera skill check is built, which will allow it for its own page. The microphone is allowed for CareerMetro's
  // own pages only, for the mock interview's spoken answers (/mock, components/mock/speech.ts; T78). No form-action rule: the
  // Google sign-in form is redirected off-site, which that rule would block before the page has loaded its script.
  // HSTS includes subdomains: the app is served only on *.vercel.app hosts, whose subdomains are all Vercel's HTTPS, and
  // careermetro.com (the public site, hosted apart) never gets this header. Revisit before serving the app on the apex
  // careermetro.com. No preload: a vercel.app subdomain can't be preloaded. COOP same-origin-allow-popups: a cross-origin
  // page that opens ours can't reach it, while popups we open keep window.opener. The Vercel Toolbar's sign-in popup on
  // preview deployments needs that; our own Google sign-in is a full-page redirect (src/app/sign-in/actions.ts).
  // The script-src policy is report-only for now (src/lib/csp.ts, docs/dev/security-sweep-2026-10-20.md): browsers send
  // what it would block to /api/csp-report and block nothing. The enforced CSP above it is unchanged. The report-only
  // header is set per request in src/proxy.ts, not here (T118): headers here are fixed at build time, so a preview build
  // promoted to production kept the Vercel Toolbar's hosts. Reporting-Endpoints, the same everywhere, stays here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: ENFORCED_CSP },
          { key: "Reporting-Endpoints", value: REPORTING_ENDPOINTS },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
  // The icon is src/app/icon.svg. While a server action's refresh briefly re-renders the head, a browser can fall back
  // to /favicon.ico; answer it with the same icon instead of a 404.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
