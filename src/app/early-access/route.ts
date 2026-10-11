import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";

const TITLE = "careermetro · Your next role, one pitstop at a time";
const DESCRIPTION =
  "Upload your resume, pick a role, see your skill gaps with evidence, and get a short free path to close them. Free during beta.";

/**
 * The holding page for careermetro.com (design thread, 2026-10-11), served as one self-contained page. Its body lives
 * in src/site/holding.html, as the design thread wrote it; this adds the document wrapper, link preview and icons.
 * The proxy shows it at / on the public domain (see HOLDING_HOSTS in src/proxy.ts). The page carries its own copy of the
 * colour tokens and loads its fonts from Google, so a CSP with script-src, style-src or font-src would break it, and a
 * token change in globals.css needs copying there.
 */
export async function GET() {
  return new Response(await holdingPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Built once per deploy: the page only changes with a new deploy.
async function holdingPage() {
  "use cache";
  cacheLife("max");
  const body = await readFile(path.join(process.cwd(), "src/site/holding.html"), "utf8");
  // Built once, so the link-preview image uses the production address, as the app's own pages do (src/app/layout.tsx).
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="${origin}/opengraph-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Geist:wght@400..600&family=Geist+Mono:wght@400;500&display=swap">
</head>
<body>
${body}
</body>
</html>
`;
  return html;
}
