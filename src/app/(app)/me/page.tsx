import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MePlanCard } from "@/components/elite/me-plan-card";
import { JobSearchProvider, JobSearchStatus, MeSearchSwitches } from "@/components/job-search/job-search";
import { PinnedPosts } from "@/components/junction/profile";
import { MeView } from "@/components/me/me-view";
import { junctionPostsShownFor, pinnedForProfile } from "@/lib/junction/feed";
import { junctionEnabled } from "@/lib/preview";
import { profileActions } from "../junction/wire";
import { readAccountSettings } from "@/lib/account/settings-store";
import { currentAccount } from "@/lib/auth/server";
import { planFor } from "@/lib/elite/store";
import { jobSearchOn } from "@/lib/job-search/store";
import { showOnMapFor } from "@/lib/map/riders";
import { exampleMe } from "@/lib/me/fixtures";
import { publicProfile, whoSeesFor } from "@/lib/me/public";
import { jobCheckOpen } from "@/lib/me/job-email-check";
import { storyGoalOptions } from "@/lib/me/edit-store";
import { meFor } from "@/lib/me/store";
import { errorFields, logEvent } from "@/lib/log";
import { exampleTrends } from "@/lib/practice/fixtures";
import { practiceTrendsFor } from "@/lib/practice/store";
import { DEFAULT_SETTINGS, type MeProfile, type PlanView } from "@/lib/schemas";
import { switchEliteBadge } from "../elite/actions";
import { switchJobSearch } from "../settings/job-search-actions";
import { switchShowOnMap } from "../settings/map-share-actions";
import {
  addInterestAction,
  checkCertificateOnCredly,
  confirmJobCheckCode,
  deleteMeEducationAction,
  deleteMeRoleAction,
  deleteStoryAction,
  removeInterestAction,
  saveMeEducationAction,
  saveMeRoleAction,
  saveStoryAction,
  sendJobCheckCode,
} from "./actions";

export const metadata: Metadata = { title: "Your profile · CareerMetro", robots: { index: false } };

const FREE: PlanView = { elite: false, badgeShown: false, since: null };

/** "Working at …" while job search is off: the latest current role on the resume. */
const currentEmployer = (me: MeProfile): string | null => me.experience.find((e) => e.current)?.employer ?? null;

async function MeScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
          Preview with example data. Your own profile appears here once you sign in and add your resume.
        </p>
        <JobSearchProvider initialOn>
          <MeView
            me={exampleMe}
            others={publicProfile(exampleMe, DEFAULT_SETTINGS)}
            practice={exampleTrends}
            planCard={<MePlanCard plan={FREE} />}
            status={<JobSearchStatus employer={currentEmployer(exampleMe)} />}
            searchSwitches={<MeSearchSwitches />}
          />
        </JobSearchProvider>
      </div>
    );
  }
  const now = new Date();
  const [me, saved, practice, plan, searching, storyGoals, onMap] = await Promise.all([
    meFor(account.id, now),
    readAccountSettings(account.id, now),
    // Practice confidence is a side section: if it can't be read, the rest of the profile still shows.
    practiceTrendsFor(account.id).catch((error: unknown) => {
      logEvent("error", "practice_trend_failed", errorFields(error));
      return undefined;
    }),
    // So is the plan card: if the plan can't be read, it shows Free and the rest of the profile still shows.
    planFor(account.id).catch((error: unknown): PlanView => {
      logEvent("error", "elite_plan_failed", errorFields(error));
      return FREE;
    }),
    // The status line and the switch are side parts too: if job search can't be read, it shows as on.
    jobSearchOn(account.id).catch((error: unknown) => {
      logEvent("error", "job_search_read_failed", errorFields(error));
      return true;
    }),
    // "From a goal" on the story form: if the goals can't be read, a story can still be saved without one.
    storyGoalOptions(account.id).catch((error: unknown) => {
      logEvent("error", "story_goals_read_failed", errorFields(error));
      return [];
    }),
    // "Show my pitstop on the map" (On your line): if it can't be read, it shows off, which is also the default.
    showOnMapFor(account.id).catch((error: unknown) => {
      logEvent("error", "map_share_read_failed", errorFields(error));
      return false;
    }),
  ]);
  // "On Junction" (FR-61, part 4): your pinned posts and the "Junction posts" switch, only while Junction is on. A side
  // section: if it can't be read, it is left out and the rest of the profile still shows.
  const junction = junctionEnabled()
    ? await Promise.all([pinnedForProfile(account.id, account.id, { own: true, now }), junctionPostsShownFor(account.id)]).catch((error: unknown) => {
        logEvent("error", "junction_pins_read_failed", errorFields(error));
        return null;
      })
    : null;
  const settings = saved?.settings ?? DEFAULT_SETTINGS;
  const hidden = settings.visibility === "only_me" || !saved?.username;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        {hidden
          ? "Only you can see this page. Pick a username and who can open your profile in Account settings."
          : "Others see only the parts you choose in Account settings. Your resume lines never show. Interests show to anyone who can open your profile."}
      </p>
      {me && (
        <JobSearchProvider initialOn={searching} action={switchJobSearch}>
          <MeView
            me={me}
            others={publicProfile(me, settings)}
            whoSees={whoSeesFor(settings, saved?.username ?? null)}
            practice={practice}
            onCheckCertificate={checkCertificateOnCredly}
            jobCheck={{ open: jobCheckOpen(), actions: { startJoin: sendJobCheckCode, finishJoin: confirmJobCheckCode } }}
            eliteBadge={plan.badgeShown}
            planCard={<MePlanCard plan={plan} onBadge={switchEliteBadge} />}
            status={<JobSearchStatus employer={currentEmployer(me)} />}
            searchSwitches={<MeSearchSwitches showOnMap={onMap} onMapShare={switchShowOnMap} />}
            edits={{
              saveRole: saveMeRoleAction,
              deleteRole: deleteMeRoleAction,
              saveEducation: saveMeEducationAction,
              deleteEducation: deleteMeEducationAction,
              saveStory: saveStoryAction,
              deleteStory: deleteStoryAction,
              addInterest: addInterestAction,
              removeInterest: removeInterestAction,
            }}
            storyGoals={storyGoals}
          />
        </JobSearchProvider>
      )}
      {junction?.[0] && (
        <PinnedPosts name={me?.name ?? "You"} posts={junction[0].posts} total={junction[0].total} now={now.toISOString()} own shown={junction[1]} actions={profileActions} />
      )}
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MeScreen />
    </Suspense>
  );
}
