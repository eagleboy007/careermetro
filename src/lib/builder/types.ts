import type { BuilderAnswers, BuilderReword } from "@/lib/schemas";
import type { BuilderLines } from "./profile";

/** What /builder's screens are given (FR-36, handoff 12k). */
export type BuilderData = {
  answers: BuilderAnswers;
  /** The account's name, shown locked on the Role section as everywhere since the name lock. */
  name: string;
  roles: { slug: string; title: string }[];
  /** Each role's skills by taxonomy name, for the Tools chips. */
  roleTools: Record<string, string[]>;
};

export type BuilderReview = { resumeId: string; lines: BuilderLines; suggestions: BuilderReword["suggestions"]; plain: boolean };

export type BuilderActions = {
  save: (answers: BuilderAnswers) => Promise<string | null>;
  review: (answers: BuilderAnswers) => Promise<BuilderReview | { error: string }>;
  gaps: (resumeId: string, truthful: boolean) => Promise<string | null>;
};
