"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAccount } from "@/lib/auth/server";
import { BUILDER_ERROR_TEXT, readyForGaps, reviewDraft, saveDraft } from "@/lib/builder/store";
import type { BuilderActions } from "@/lib/builder/types";

/*
 * Build your resume's server actions (FR-36). The answers travel only in the request body; nothing here logs them.
 * Each returns the words to show on failure, and the save and the review also the fields to mark.
 */

const SIGN_IN = "Please sign in again.";

export const saveBuilderDraft: BuilderActions["save"] = async (answers) => {
  const account = await currentAccount();
  if (!account) return { error: SIGN_IN };
  const saved = await saveDraft(account.id, answers);
  return saved.ok ? null : { error: BUILDER_ERROR_TEXT[saved.error], issues: saved.issues };
};

export const reviewBuiltResume: BuilderActions["review"] = async (answers) => {
  const account = await currentAccount();
  if (!account) return { error: SIGN_IN };
  // The latest answers are saved first, so the review always matches what is on screen. The review has its own limit,
  // so saves made while typing never stop it.
  const built = await reviewDraft(account.id, answers);
  if (!built.ok) return { error: BUILDER_ERROR_TEXT[built.error], issues: "issues" in built ? built.issues : undefined };
  return { resumeId: built.resumeId, lines: built.lines, suggestions: built.suggestions, plain: built.plain };
};

export const checkMyGaps: BuilderActions["gaps"] = async (resumeId, truthful) => {
  if (!z.uuid().safeParse(resumeId).success) return BUILDER_ERROR_TEXT.not_ready;
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const ready = await readyForGaps(account.id, resumeId, truthful === true);
  if (!ready.ok) return BUILDER_ERROR_TEXT[ready.error];
  // The same confirm step and gap match as an upload.
  redirect(`/resume/${resumeId}`);
};
