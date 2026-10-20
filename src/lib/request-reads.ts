import "server-only";
import { cache } from "react";
import { eliteOn } from "@/lib/elite/store";
import { jobSearchFor } from "@/lib/job-search/store";

/*
 * Reads the signed-in layout and a page both make for the same person in one request (docs/plans/perf-pass.md),
 * memoised for that request with React `cache`, like `currentAccount`. Only for rendering: server actions and stores
 * keep calling the store functions directly, so a write is never answered from a read made before it.
 */

/** The job search switch and notice period (`jobSearchFor`), read once per request. */
export const jobSearchForRequest = cache((userId: string) => jobSearchFor(userId));

/** Whether the person has Elite (`eliteOn`), read once per request. */
export const eliteOnRequest = cache((userId: string) => eliteOn(userId));
