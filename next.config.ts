import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Prompts are read from disk at runtime (src/lib/ai/prompts.ts), so ship them with every server function.
  outputFileTracingIncludes: { "/**": ["./prompts/**/*.md"] },
  partialPrefetching: true,
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
