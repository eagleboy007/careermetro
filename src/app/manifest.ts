import type { MetadataRoute } from "next";

/** The share sheet's target (C21): Android posts the shared title, text and link to /share as a form. */
type ShareTarget = {
  share_target: {
    action: string;
    method: "POST";
    enctype: "application/x-www-form-urlencoded";
    params: { title: string; text: string; url: string };
  };
};

/**
 * The web app manifest (docs/plans/application-tracker-plan.md section 5). It makes CareerMetro installable ("Add to
 * Home screen"), and once installed on Android it is in the share sheet: a shared job opens "Add a job you found" filled
 * in. POST, never GET, so the job text never sits in an address. No service worker: none is needed to install or to
 * receive a share that goes to the server. Colours are the light tokens' values (src/app/globals.css).
 */
export default function manifest(): MetadataRoute.Manifest & ShareTarget {
  return {
    name: "CareerMetro",
    short_name: "CareerMetro",
    description: "Your resume and target role in, your skill gaps and a short path out.",
    id: "/today",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f8",
    theme_color: "#f4f5f8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
