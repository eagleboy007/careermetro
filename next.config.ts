import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Prompts are read from disk at runtime (src/lib/ai/prompts.ts), so ship them with every server function.
  outputFileTracingIncludes: { "/**": ["./prompts/**/*.md"] },
  partialPrefetching: true,
  // Hardening for every page and API route (T25). No other site may frame CareerMetro. Camera and microphone are
  // off until the on-camera skill check is built, which will allow them for its own page. No form-action rule: the
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
    ];
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
