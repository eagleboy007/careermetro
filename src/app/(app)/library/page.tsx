import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { LibraryView, type LibraryActions } from "@/components/library/library-view";
import { currentAccount } from "@/lib/auth/server";
import { exampleEliteShelf, exampleLibrary, exampleLibraryNoResume } from "@/lib/library/fixtures";
import { eliteShelfFor, libraryFor } from "@/lib/library/store";
import { errorFields, logEvent } from "@/lib/log";
import type { EliteShelfView, LibraryView as View } from "@/lib/schemas";
import { LIBRARY_TABS } from "@/lib/schemas/constants";
import { libraryMarkAction, reportResourceAction, suggestResourceAction } from "./actions";

export const metadata: Metadata = { title: "Library · CareerMetro", robots: { index: false } };

/** Save, finish, ride, report and suggest, kept on the server (docs/plans/library-part-2-plan.md). */
const LIBRARY_ACTIONS: LibraryActions = { mark: libraryMarkAction, report: reportResourceAction, suggest: suggestResourceAction };

/**
 * The Library (FR-51, handoff 12a). Signed in only: the signed-in layout and the proxy send everyone else away, and
 * with no sign-in on this deployment the page shows example data, where the marks change on the screen only. Free links
 * to the source sites, grouped by the person's own goals, read by their user id; Save, "I finished this", Add to my
 * rides, Report a broken link and Suggest a free resource write through the actions. `?tab=elite` opens the Elite shelf (Elite part 5), which eliteOn opens.
 */
async function LibraryScreen({ searchParams }: PageProps<"/library">) {
  const { state, tab: askedTab } = await searchParams;
  const tab = LIBRARY_TABS.find((t) => t === askedTab) ?? "goals";
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Your own goals appear here once you add your resume.</Banner>
        <LibraryView view={state === "no_resume" ? exampleLibraryNoResume : exampleLibrary} shelf={exampleEliteShelf(false)} tab={tab} />
      </div>
    );
  }
  let view: View;
  let shelf: EliteShelfView;
  try {
    view = await libraryFor(account.id);
    shelf = await eliteShelfFor(account.id, view);
  } catch (error) {
    unstable_rethrow(error);
    // Database and schema errors can carry values; errorFields keeps only the name and code.
    logEvent("error", "library_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t load your Library just now. Please reload the page in a minute.
      </p>
    );
  }
  return <LibraryView view={view} shelf={shelf} tab={tab} actions={LIBRARY_ACTIONS} />;
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function LibraryPage(props: PageProps<"/library">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <LibraryScreen {...props} />
    </Suspense>
  );
}
