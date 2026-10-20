import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Prompts are read from disk at runtime (src/lib/ai/prompts.ts), so ship them with every server function. The resume
  // download embeds the Geist fonts (src/lib/resume/export/pdf.ts). The Market reads its openings feed from disk once
  // switched on (src/content/market/index.ts); until then the file doesn't exist and the pattern matches nothing.
  outputFileTracingIncludes: { "/**": ["./prompts/**/*.md", "./src/content/market/feed-rows.csv"], "/api/resume/[id]/export": ["./assets/fonts/*.ttf"] },
  partialPrefetching: true,
  // Hardening for every page and API route (T25). No other site may frame CareerMetro. The camera is off until the
  // on-camera skill check is built, which will allow it for its own page. The microphone is allowed for CareerMetro's
  // own pages only, for the mock interview's spoken answers (/mock, components/mock/speech.ts; T78). No form-action rule: the
  // Google sign-in form is redirected off-site, which that rule would block before the page has loaded its script.
  // HSTS covers this host only, so a subdomain served over plain HTTP is never locked out.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
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
