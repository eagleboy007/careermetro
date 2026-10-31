import type { BuilderAnswers, BuilderReword } from "@/lib/schemas";
import type { BuilderIssues } from "./rules";
import type { ProfileLink } from "./links";
import type { BuilderLines } from "./profile";

/** What /builder's screens are given (FR-36, handoff 12k). */
export type BuilderData = {
  answers: BuilderAnswers;
  /** The account's name, shown locked on the Role section as everywhere since the name lock. */
  name: string;
  roles: { slug: string; title: string }[];
  /** Each role's skills by taxonomy name, for the Tools chips. */
  roleTools: Record<string, string[]>;
  /** Each role's profile links in the order to ask for them (T182). A role missing here, or no role, puts LinkedIn first. */
  roleLinks?: Record<string, ProfileLink[]>;
};

export type BuilderReview = { resumeId: string; lines: BuilderLines; suggestions: BuilderReword["suggestions"]; plain: boolean };

/** A save or review that didn't go through: the words to show, and the fields to mark by path ("education.0.start"). */
export type BuilderFailure = { error: string; issues?: BuilderIssues };

export type BuilderActions = {
  /** Null once saved. */
  save: (answers: BuilderAnswers) => Promise<BuilderFailure | null>;
  review: (answers: BuilderAnswers) => Promise<BuilderReview | BuilderFailure>;
  gaps: (resumeId: string, truthful: boolean) => Promise<string | null>;
};
