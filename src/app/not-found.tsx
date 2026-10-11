import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

export const metadata: Metadata = { title: "Page not found · CareerMetro" };

/** Shown for any address that leads nowhere, and when a page calls notFound() (such as someone else's resume). */
export default function NotFound() {
  return (
    <PageNotice title="We can't find that page" text="The link may be old, or the page may belong to someone else.">
      <ButtonLink href="/">Go to the home page</ButtonLink>
    </PageNotice>
  );
}
