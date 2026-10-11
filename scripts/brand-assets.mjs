// Makes the app's icon files and link-preview image from the brand files in /brand. To change the logo, replace
// brand/favicon.svg, brand/app-icon.svg and brand/social-card.svg (and the mark in src/components/ui/logo.tsx), then
// run: npm run brand. Needs Playwright's Chromium (npm install --no-save playwright; CHROMIUM_PATH if preinstalled).
import { copyFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const svg = (name) => readFileSync(`${root}brand/${name}`, "utf8");

// The favicon stays a vector: browsers scale it, and it is the smallest file.
copyFileSync(`${root}brand/favicon.svg`, `${root}src/app/icon.svg`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const render = async (source, width, height, out) => {
  const page = await browser.newPage({ viewport: { width, height } });
  const sized = source.replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 width="${width}" height="${height}"`);
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
  await page.screenshot({ path: `${root}${out}`, omitBackground: true });
  await page.close();
};
// Home-screen icon for iPhone and iPad, and the image shown when a link is shared.
await render(svg("app-icon.svg"), 180, 180, "src/app/apple-icon.png");
await render(svg("social-card.svg"), 1200, 630, "src/app/opengraph-image.png");
await browser.close();
console.log("brand assets written: src/app/icon.svg, apple-icon.png, opengraph-image.png");
